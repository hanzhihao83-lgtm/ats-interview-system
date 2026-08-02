// @ts-nocheck Prisma client types are generated after the accompanying migration.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import XLSX from "xlsx";
import { z } from "zod";
import { prisma } from "./database.js";
import { parseWorkbook } from "./autoDashboardParser.js";

const router = Router();
const uploadRoot = path.resolve(process.cwd(), process.env.AUTO_DASHBOARD_UPLOAD_DIR || "uploads/auto-dashboards");
fs.mkdirSync(uploadRoot, { recursive: true, mode: 0o700 });
const allowed = new Set([".xlsx", ".xls", ".csv"]);
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomBytes(16).toString("hex")}${path.extname(file.originalname).toLowerCase()}`),
});
const uploader = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = allowed.has(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error("AUTO_DASHBOARD_FILE_INVALID"), ok);
  },
});
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
const success = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data, requestId: res.locals.requestId });
const safeName = (value: string) => path.basename(value).replace(/[\u0000-\u001f]/g, "");
const dashboardConfig = { title: "招聘结果看板", version: 1, modules: ["overview", "funnel", "businessComparison", "suppliers", "levels", "interviewResults", "entryStatus", "interviews", "candidates"] };

router.post("/upload", uploader.single("file"), wrap(async (req, res) => {
  if (!req.file) throw new Error("AUTO_DASHBOARD_FILE_INVALID");
  const body = z.object({ uploadedBy: z.string().trim().max(100).optional() }).parse(req.body);
  const bytes = await fs.promises.readFile(req.file.path);
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const originalFileName = safeName(req.file.originalname);
  const dataset = await prisma.importedDataset.create({ data: {
    name: originalFileName.replace(/\.(xlsx|xls|csv)$/i, ""), originalFileName,
    storedFileName: safeName(req.file.filename), fileHash, status: "READING_SHEETS", progress: 15,
    statusMessage: "正在读取工作表", createdBy: body.uploadedBy || "匿名用户",
  }});
  try {
    const isCsv = path.extname(originalFileName).toLowerCase() === ".csv";
    const workbook = XLSX.read(isCsv ? bytes.toString("utf8") : bytes, { type: isCsv ? "string" : "buffer", raw: isCsv, cellDates: false, cellFormula: false, cellNF: false, cellText: true, bookVBA: false });
    await prisma.importedDataset.update({ where: { id: dataset.id }, data: { totalSheets: workbook.SheetNames.length, status: "PARSING_INTERVIEWS", progress: 35, statusMessage: "正在识别面试数据" } });
    const parsed = parseWorkbook(workbook, 10_000);
    if (!parsed.processedSheets.length) throw new Error("AUTO_DASHBOARD_NO_RECOGNIZED_SHEETS");
    if (!parsed.candidates.length && !parsed.suppliers.length) throw new Error("AUTO_DASHBOARD_NO_DATA");
    await prisma.importedDataset.update({ where: { id: dataset.id }, data: { status: "SAVING_DATA", progress: 68, statusMessage: "正在保存数据" } });
    const dashboard = await prisma.$transaction(async (tx) => {
      if (parsed.candidates.length) await tx.importedCandidate.createMany({ data: parsed.candidates.map((row) => ({ ...row, datasetId: dataset.id })) });
      if (parsed.suppliers.length) await tx.importedSupplierSummary.createMany({ data: parsed.suppliers.map((row) => ({ ...row, datasetId: dataset.id })) });
      const generated = await tx.generatedDashboard.create({ data: { datasetId: dataset.id, name: "招聘结果看板", config: dashboardConfig } });
      const suppliers = new Set([...parsed.candidates.map((row) => row.supplier), ...parsed.suppliers.map((row) => row.supplier)].filter(Boolean));
      await tx.importedDataset.update({ where: { id: dataset.id }, data: { dashboardId: generated.id, status: "COMPLETED", progress: 100, statusMessage: "文件处理完成，已生成招聘结果看板。", processedSheets: parsed.processedSheets.length, candidateCount: parsed.candidates.length, supplierCount: suppliers.size, warningCount: parsed.warningCount } });
      return generated;
    });
    return success(res, { datasetId: dataset.id, dashboardId: dashboard.id, processedSheets: parsed.processedSheets.length, candidateCount: parsed.candidates.length, supplierCount: new Set([...parsed.candidates.map((r) => r.supplier), ...parsed.suppliers.map((r) => r.supplier)]).size, warningCount: parsed.warningCount, redirectUrl: `/dashboards/${dashboard.id}` }, 201);
  } catch (error) {
    await prisma.importedDataset.update({ where: { id: dataset.id }, data: { status: "FAILED", statusMessage: "文件处理失败" } }).catch(() => undefined);
    throw error;
  }
}));

router.get("/tasks/:datasetId/status", wrap(async (req, res) => {
  const data = await prisma.importedDataset.findUnique({ where: { id: req.params.datasetId }, select: { status: true, progress: true, statusMessage: true, warningCount: true, dashboardId: true } });
  if (!data) throw new Error("AUTO_DASHBOARD_NOT_FOUND");
  return success(res, { status: data.status, progress: data.progress, message: data.statusMessage, warningCount: data.warningCount, dashboardId: data.dashboardId });
}));

async function getDashboard(id: string) {
  const dashboard = await prisma.generatedDashboard.findUnique({ where: { id }, include: { dataset: true } });
  if (!dashboard) throw new Error("AUTO_DASHBOARD_NOT_FOUND");
  return dashboard;
}
const nullableCount = (available: boolean, count: number) => available ? count : null;

async function overviewForDataset(datasetId: string) {
  const [rows, summaries] = await Promise.all([
    prisma.importedCandidate.findMany({ where: { datasetId }, select: { businessType: true, interviewResult: true, entryStatus: true } }),
    prisma.importedSupplierSummary.findMany({ where: { datasetId } }),
  ]);
  const c = (field: string, value: string) => rows.filter((r) => r[field] === value).length;
  const sum = (field: string) => summaries.reduce((total, row) => total + (row[field] || 0), 0);
  const interviewKnown = rows.some((r) => r.interviewResult && r.interviewResult !== "未知");
  const entryKnown = rows.some((r) => r.entryStatus && r.entryStatus !== "未知");
  const summaryCandidates = sum("videoResumeCount") + sum("audioResumeCount");
  return {
    candidateTotal: rows.length || summaryCandidates,
    videoCandidates: nullableCount(rows.some((r) => r.businessType === "视频") || sum("videoResumeCount") > 0, c("businessType", "视频") || sum("videoResumeCount")),
    audioCandidates: nullableCount(rows.some((r) => r.businessType === "音频") || sum("audioResumeCount") > 0, c("businessType", "音频") || sum("audioResumeCount")),
    interviewPassed: nullableCount(interviewKnown || sum("videoInterviewPassed") + sum("audioInterviewPassed") > 0, interviewKnown ? c("interviewResult", "通过") : sum("videoInterviewPassed") + sum("audioInterviewPassed")),
    interviewFailed: nullableCount(interviewKnown, c("interviewResult", "不通过")),
    interviewPending: nullableCount(interviewKnown, c("interviewResult", "待反馈")),
    joined: nullableCount(entryKnown || sum("videoActualEntry") + sum("audioActualEntry") > 0, entryKnown ? c("entryStatus", "已入职") : sum("videoActualEntry") + sum("audioActualEntry")),
    pendingEntry: nullableCount(entryKnown || sum("videoConfirmedEntry") + sum("audioConfirmedEntry") > 0, entryKnown ? c("entryStatus", "待入职") : Math.max(0, sum("videoConfirmedEntry") + sum("audioConfirmedEntry") - sum("videoActualEntry") - sum("audioActualEntry"))),
    abandoned: nullableCount(entryKnown, c("entryStatus", "已放弃")),
    left: nullableCount(entryKnown, c("entryStatus", "已离职")),
  };
}

router.get("/:dashboardId", wrap(async (req, res) => {
  const dashboard = await getDashboard(req.params.dashboardId);
  return success(res, { dashboard: { id: dashboard.id, name: dashboard.name, config: dashboard.config, updatedAt: dashboard.updatedAt }, dataset: dashboard.dataset, overview: await overviewForDataset(dashboard.datasetId) });
}));

router.get("/:dashboardId/overview", wrap(async (req, res) => {
  const dashboard = await getDashboard(req.params.dashboardId);
  return success(res, await overviewForDataset(dashboard.datasetId));
}));

router.get("/:dashboardId/funnel", wrap(async (req, res) => {
  const { datasetId } = await getDashboard(req.params.dashboardId);
  const [rows, summaries] = await Promise.all([prisma.importedCandidate.findMany({ where: { datasetId }, select: { interviewTimeRaw: true, interviewResult: true, entryStatus: true } }), prisma.importedSupplierSummary.findMany({ where: { datasetId } })]);
  const sum = (field: string) => summaries.reduce((n, r) => n + (r[field] || 0), 0), summaryPassed = sum("videoInterviewPassed") + sum("audioInterviewPassed"), summaryConfirmed = sum("videoConfirmedEntry") + sum("audioConfirmedEntry"), summaryJoined = sum("videoActualEntry") + sum("audioActualEntry"), summaryCandidates = sum("videoResumeCount") + sum("audioResumeCount");
  const counts = [rows.length || summaryCandidates, rows.filter((r) => r.interviewTimeRaw).length, rows.some((r) => r.interviewResult !== "未知") ? rows.filter((r) => r.interviewResult === "通过").length : summaryPassed, rows.some((r) => r.entryStatus !== "未知") ? rows.filter((r) => ["待入职", "已入职", "已离职"].includes(r.entryStatus || "")).length : summaryConfirmed, rows.some((r) => r.entryStatus !== "未知") ? rows.filter((r) => r.entryStatus === "已入职").length : summaryJoined];
  return success(res, ["候选人", "已安排面试", "面试通过", "确认入职", "已入职"].map((name, i) => ({ name, count: counts[i], previousRate: i === 0 || !counts[i - 1] ? null : counts[i] / counts[i - 1], cumulativeRate: i === 0 || !counts[0] ? (i === 0 ? 1 : null) : counts[i] / counts[0] })));
}));

router.get("/:dashboardId/business-comparison", wrap(async (req, res) => {
  const { datasetId } = await getDashboard(req.params.dashboardId);
  const [rows, summaries] = await Promise.all([prisma.importedCandidate.findMany({ where: { datasetId }, select: { businessType: true, interviewResult: true, entryStatus: true } }), prisma.importedSupplierSummary.findMany({ where: { datasetId } })]);
  const sum = (field: string) => summaries.reduce((n, r) => n + (r[field] || 0), 0);
  return success(res, ["视频", "音频"].map((businessType) => { const own = rows.filter((r) => r.businessType === businessType), prefix = businessType === "视频" ? "video" : "audio"; return { businessType, candidates: own.length || sum(`${prefix}ResumeCount`), passed: own.some((r) => r.interviewResult !== "未知") ? own.filter((r) => r.interviewResult === "通过").length : sum(`${prefix}InterviewPassed`), joined: own.some((r) => r.entryStatus !== "未知") ? own.filter((r) => r.entryStatus === "已入职").length : sum(`${prefix}ActualEntry`) }; }));
}));

router.get("/:dashboardId/suppliers", wrap(async (req, res) => {
  const { datasetId } = await getDashboard(req.params.dashboardId);
  const [rows, summaries] = await Promise.all([prisma.importedCandidate.findMany({ where: { datasetId }, select: { supplier: true, businessType: true, interviewResult: true, entryStatus: true } }), prisma.importedSupplierSummary.findMany({ where: { datasetId } })]);
  const names = [...new Set([...rows.map((r) => r.supplier || "未知供应商"), ...summaries.map((r) => r.supplier)])];
  return success(res, names.map((supplier) => { const own = rows.filter((r) => (r.supplier || "未知供应商") === supplier), sum = summaries.filter((r) => r.supplier === supplier); const total = (field: string) => sum.reduce((n, r) => n + (r[field] || 0), 0); return { supplier, candidates: own.length, passed: own.filter((r) => r.interviewResult === "通过").length || total("videoInterviewPassed") + total("audioInterviewPassed"), failed: own.filter((r) => r.interviewResult === "不通过").length, joined: own.filter((r) => r.entryStatus === "已入职").length || total("videoActualEntry") + total("audioActualEntry"), abandoned: own.filter((r) => r.entryStatus === "已放弃").length, videoPassed: own.filter((r) => r.businessType === "视频" && r.interviewResult === "通过").length || total("videoInterviewPassed"), audioPassed: own.filter((r) => r.businessType === "音频" && r.interviewResult === "通过").length || total("audioInterviewPassed") }; }));
}));

async function distribution(dashboardId: string, field: string, values: string[]) { const { datasetId } = await getDashboard(dashboardId); const rows = await prisma.importedCandidate.groupBy({ by: [field], where: { datasetId }, _count: { _all: true } }); return values.map((name) => ({ name, value: rows.find((r) => (r[field] || "未知") === name)?._count._all || 0 })); }
router.get("/:dashboardId/levels", wrap(async (req, res) => { const { datasetId } = await getDashboard(req.params.dashboardId); const rows = await prisma.importedCandidate.findMany({ where: { datasetId }, select: { level: true } }); return success(res, ["L1", "L2", "其他定级", "未定级"].map((name) => ({ name, value: rows.filter((r) => name === "其他定级" ? !["L1", "L2", "未定级", null].includes(r.level) : (r.level || "未定级").toUpperCase() === name).length }))); }));
router.get("/:dashboardId/interview-results", wrap(async (req, res) => success(res, await distribution(req.params.dashboardId, "interviewResult", ["通过", "不通过", "待反馈", "取消", "未知"]))));
router.get("/:dashboardId/entry-status", wrap(async (req, res) => success(res, await distribution(req.params.dashboardId, "entryStatus", ["已入职", "待入职", "已放弃", "已离职", "未知"]))));

router.get("/:dashboardId/interviews", wrap(async (req, res) => {
  const { datasetId } = await getDashboard(req.params.dashboardId);
  return success(res, await prisma.importedCandidate.findMany({ where: { datasetId, interviewTimeRaw: { not: null } }, orderBy: [{ interviewStartTime: "desc" }, { sourceRow: "desc" }], take: 20 }));
}));

router.get("/:dashboardId/candidates", wrap(async (req, res) => {
  const { datasetId } = await getDashboard(req.params.dashboardId);
  const where: any = { datasetId };
  if (req.query.keyword) where.name = { contains: String(req.query.keyword), mode: "insensitive" };
  if (req.query.supplier) where.supplier = String(req.query.supplier);
  if (req.query.businessType) where.businessType = String(req.query.businessType);
  if (req.query.interviewResult) where.interviewResult = String(req.query.interviewResult);
  if (req.query.entryStatus) where.entryStatus = String(req.query.entryStatus);
  if (req.query.export === "xlsx") {
    const rows = await prisma.importedCandidate.findMany({ where, orderBy: { sourceRow: "asc" }, take: 10_000 });
    const sheet = XLSX.utils.json_to_sheet(rows.map((r) => ({ 候选人: r.name, 供应商: r.supplier, 业务方向: r.businessType, 面试时间: r.interviewTimeRaw, 腾讯会议: r.meetingUrl || r.meetingCode, 面试结果: r.interviewResult, 定级: r.level, 面试官: r.interviewer, 面评: r.interviewComment, 入职日期: r.entryDate?.toISOString().slice(0, 10), 入职状态: r.entryStatus, 来源工作表: r.sourceSheet })));
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "候选人明细"); const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); res.setHeader("Content-Disposition", "attachment; filename=recruitment-candidates.xlsx"); return res.send(buffer);
  }
  const page = Math.max(1, Number(req.query.page || 1)), pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const [rows, total] = await prisma.$transaction([prisma.importedCandidate.findMany({ where, orderBy: [{ interviewStartTime: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }), prisma.importedCandidate.count({ where })]);
  return success(res, { rows, pagination: { page, pageSize, total } });
}));

export default router;
