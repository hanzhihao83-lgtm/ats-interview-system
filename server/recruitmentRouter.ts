// @ts-nocheck Prisma's generated input unions are narrowed at runtime by Zod in this route module.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import multer from "multer";
import XLSX from "xlsx";
import { z } from "zod";
import {
  DuplicateLevel,
  HandlingAction,
  ImportRowStatus,
  ImportTaskStatus,
  Prisma,
  ValidationStatus,
} from "@prisma/client";
import { prisma } from "./database.js";
import { assertSupplierIdentity, isSupplierUser, supplierIdFor, supplierNameFor } from "./auth.js";

const router = Router();
const maxFileMb = Math.max(1, Number(process.env.MAX_IMPORT_FILE_MB || 15));
const maxRows = Math.max(1, Number(process.env.MAX_IMPORT_ROWS || 5000));
const batchSize = Math.max(1, Number(process.env.IMPORT_BATCH_SIZE || 100));
const uploadRoot = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR || "uploads/imports",
);
fs.mkdirSync(uploadRoot, { recursive: true, mode: 0o700 });
const acceptedExtensions = new Set([".xlsx", ".xls", ".csv"]);
const acceptedMime = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "text/plain",
  "application/octet-stream",
]);
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) =>
    cb(
      null,
      `${Date.now()}-${randomBytes(12).toString("hex")}${path.extname(file.originalname).toLowerCase()}`,
    ),
});
const uploader = multer({
  storage,
  limits: { fileSize: maxFileMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      acceptedExtensions.has(path.extname(file.originalname).toLowerCase()) &&
      acceptedMime.has(file.mimetype);
    cb(ok ? null : new Error("IMPORT_FILE_INVALID"), ok);
  },
});

const aliases: Record<string, string[]> = {
  name: ["候选人姓名", "姓名", "名字", "candidate_name", "name"],
  phone: ["手机号", "手机号码", "联系电话", "电话", "phone", "mobile"],
  email: ["邮箱", "电子邮箱", "email"],
  supplier: ["供应商", "供应商名称", "外包公司", "vendor"],
  position: ["应聘岗位", "岗位", "职位", "position"],
  projectName: ["所属项目", "项目", "项目名称", "project"],
  university: ["大学", "学校", "毕业院校", "院校", "university"],
  major: ["专业", "所学专业", "major"],
  highestEducation: ["学历", "最高学历", "education"],
  graduationYear: ["毕业年份", "毕业年", "graduation_year"],
  resumeSubmitDate: ["提交日期", "简历提交日期", "投递日期"],
  currentStatus: ["当前状态", "招聘状态", "人员状态"],
  expectedEntryDate: ["预计入职日期", "预计到岗日期"],
  actualEntryDate: ["实际入职日期", "实际到岗日期"],
  leaveDate: ["离职日期"],
  remark: ["备注", "说明"],
};
const statusAliases: Record<string, string> = {
  待约面: "待安排面试",
  约面中: "待面试",
  通过待入职: "待入职",
  已到岗: "培训中",
  在项目: "项目中",
};
const statuses = new Set([
  "简历待筛选",
  "简历未通过",
  "待安排面试",
  "待面试",
  "面试待反馈",
  "面试未通过",
  "面试通过",
  "待确认入职",
  "待入职",
  "培训中",
  "培训未通过",
  "项目中",
  "候选人放弃",
  "已离职",
  "异常",
]);
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : [];
const clean = (value: unknown) => {
  const text = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[ \t]+/g, " ");
  return text || null;
};
const normalizeName = (value: unknown) =>
  clean(value)?.replace(/\s+/g, "").toLocaleLowerCase("zh-CN") || null;
const normalizePhone = (value: unknown) =>
  clean(value)
    ?.replace(/[^\d+]/g, "")
    .replace(/^\+?86/, "") || null;
const maskPhone = (value: string | null) =>
  value && value.length >= 7
    ? `${value.slice(0, 3)}****${value.slice(-4)}`
    : value
      ? "***"
      : null;
const maskEmail = (value: string | null) => {
  if (!value?.includes("@")) return null;
  const [left, domain] = value.split("@");
  return `${left.slice(0, 1)}***@${domain}`;
};
export function parseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return d
      ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`
      : null;
  }
  const normalized = String(value)
    .trim()
    .replace(/[年/.]/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
}
const asDate = (value: unknown) => {
  const parsed = parseDate(value);
  return parsed ? new Date(`${parsed}T00:00:00.000Z`) : null;
};
export function normalizeRow(source: Record<string, unknown>) {
  const rawStatus = clean(source.currentStatus);
  const currentStatus = rawStatus
    ? statusAliases[rawStatus] || rawStatus
    : "简历待筛选";
  const email = clean(source.email)?.toLowerCase() || null;
  const phone = normalizePhone(source.phone);
  return {
    name: clean(source.name),
    normalizedName: normalizeName(source.name),
    phone,
    phoneNormalized: phone,
    phoneMasked: maskPhone(phone),
    email,
    emailNormalized: email,
    emailMasked: maskEmail(email),
    supplier: clean(source.supplier),
    position: clean(source.position),
    projectName: clean(source.projectName),
    university: clean(source.university),
    normalizedUniversity: normalizeName(source.university),
    major: clean(source.major),
    highestEducation: clean(source.highestEducation),
    graduationYear:
      source.graduationYear === null ||
      source.graduationYear === undefined ||
      source.graduationYear === ""
        ? null
        : Number(source.graduationYear),
    resumeSubmitDate: parseDate(source.resumeSubmitDate),
    currentStatus,
    expectedEntryDate: parseDate(source.expectedEntryDate),
    actualEntryDate: parseDate(source.actualEntryDate),
    leaveDate: parseDate(source.leaveDate),
    remark: clean(source.remark),
  };
}
export function validateRow(row: ReturnType<typeof normalizeRow>) {
  const errors: string[] = [],
    warnings: string[] = [];
  if (!row.name) errors.push("姓名不能为空");
  if (!row.supplier) errors.push("供应商不能为空");
  if (!row.position) errors.push("岗位不能为空");
  if (row.phone && !/^1[3-9]\d{9}$/.test(row.phone))
    errors.push("手机号格式不合法");
  if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email))
    errors.push("邮箱格式不合法");
  if (
    row.graduationYear !== null &&
    (!Number.isInteger(row.graduationYear) ||
      row.graduationYear < 1980 ||
      row.graduationYear > new Date().getFullYear() + 10)
  )
    errors.push("毕业年份不合理");
  if (
    row.actualEntryDate &&
    row.resumeSubmitDate &&
    row.actualEntryDate < row.resumeSubmitDate
  )
    errors.push("实际入职日期不能早于简历提交日期");
  if (row.currentStatus && !statuses.has(row.currentStatus))
    errors.push(`无法识别状态：${row.currentStatus}`);
  if (row.currentStatus === "项目中" && !row.actualEntryDate)
    warnings.push("项目中状态建议填写实际入职日期");
  if (row.currentStatus === "待入职" && !row.expectedEntryDate)
    warnings.push("待入职状态建议填写预计入职日期");
  if (row.currentStatus === "已离职" && !row.leaveDate)
    warnings.push("已离职状态建议填写离职日期");
  return {
    errors,
    warnings,
    status: errors.length
      ? ValidationStatus.INVALID
      : warnings.length
        ? ValidationStatus.WARNING
        : ValidationStatus.VALID,
  };
}
function autoMapping(headers: string[]) {
  const mapping: Record<string, string> = {};
  for (const [field, names] of Object.entries(aliases)) {
    const header = headers.find((item) =>
      names.some((name) => name.toLowerCase() === item.trim().toLowerCase()),
    );
    if (header) mapping[field] = header;
  }
  return mapping;
}
export function classifyDuplicate(
  data: ReturnType<typeof normalizeRow>,
  matches: Array<{
    id?: string;
    phoneNormalized?: string | null;
    emailNormalized?: string | null;
    normalizedUniversity?: string | null;
    major?: string | null;
    graduationYear?: number | null;
  }>,
  batchMatches: Array<ReturnType<typeof normalizeRow>> = [],
) {
  const exact = matches.filter((item) =>
    Boolean(
      (data.phoneNormalized && item.phoneNormalized === data.phoneNormalized) ||
      (data.emailNormalized && item.emailNormalized === data.emailNormalized),
    ),
  );
  if (
    exact.length ||
    batchMatches.some((item) =>
      Boolean(
        (data.phoneNormalized &&
          item.phoneNormalized === data.phoneNormalized) ||
        (data.emailNormalized && item.emailNormalized === data.emailNormalized),
      ),
    )
  )
    return {
      level: DuplicateLevel.EXACT,
      reasons: ["姓名与完整手机号或邮箱一致"],
      ids: exact.map((item) => item.id).filter(Boolean) as string[],
    };
  if (
    matches.some(
      (item) =>
        data.normalizedUniversity &&
        item.normalizedUniversity === data.normalizedUniversity &&
        data.major &&
        item.major === data.major &&
        data.graduationYear === item.graduationYear &&
        data.phoneNormalized?.slice(-4) === item.phoneNormalized?.slice(-4),
    )
  )
    return {
      level: DuplicateLevel.HIGH_SUSPECT,
      reasons: ["姓名、大学、专业、毕业年份及手机号后四位一致"],
      ids: matches.map((item) => item.id).filter(Boolean) as string[],
    };
  if (
    matches.some(
      (item) =>
        data.normalizedUniversity &&
        item.normalizedUniversity &&
        data.normalizedUniversity !== item.normalizedUniversity,
    )
  )
    return {
      level: DuplicateLevel.SAME_NAME_DIFFERENT_PERSON,
      reasons: ["姓名相同但大学不同"],
      ids: matches.map((item) => item.id).filter(Boolean) as string[],
    };
  if (matches.length || batchMatches.length)
    return {
      level: DuplicateLevel.MANUAL_REVIEW,
      reasons: ["姓名相同但身份信息不足"],
      ids: matches.map((item) => item.id).filter(Boolean) as string[],
    };
  return {
    level: DuplicateLevel.NONE,
    reasons: [] as string[],
    ids: [] as string[],
  };
}
function safeFile(task: { storedFileName: string }) {
  const resolved = path.resolve(uploadRoot, path.basename(task.storedFileName));
  if (!resolved.startsWith(`${uploadRoot}${path.sep}`))
    throw new Error("IMPORT_FILE_INVALID");
  return resolved;
}
function readWorkbook(filePath: string) {
  return XLSX.readFile(filePath, {
    cellDates: false,
    cellFormula: false,
    cellNF: false,
    cellText: true,
    bookVBA: false,
  });
}
const nonEmptySheets = (book: XLSX.WorkBook) =>
  book.SheetNames.filter((name) =>
    (
      XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], {
        header: 1,
        defval: "",
        raw: true,
      }) || []
    ).some((row) => row.some((cell) => String(cell ?? "").trim())),
  );
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
const success = (res: Response, data: unknown, status = 200) =>
  res
    .status(status)
    .json({ success: true, data, requestId: res.locals.requestId });

const taskAccessWhere = (req: Request, id?: string) => ({
  ...(id ? { id } : {}),
  ...(isSupplierUser(req) ? { supplierId: req.auth!.supplierId! } : {}),
});
async function assertTaskAccess(req: Request) {
  const task = await prisma.candidateImportTask.findFirst({ where: taskAccessWhere(req, req.params.taskId) });
  if (!task) throw new Error("IMPORT_TASK_NOT_FOUND");
  return task;
}
const candidateScope = (req: Request) => isSupplierUser(req) ? { supplierId: req.auth!.supplierId! } : {};

export async function cleanupExpiredImportFiles(retentionDays = 7) {
  const before = new Date(Date.now() - retentionDays * 86_400_000);
  const records = await prisma.importFileRecord.findMany({
    where: {
      cleanedAt: null,
      createdAt: { lt: before },
      task: {
        status: {
          in: [
            ImportTaskStatus.COMPLETED,
            ImportTaskStatus.PARTIAL_FAILED,
            ImportTaskStatus.FAILED,
          ],
        },
      },
    },
    include: { task: { select: { storedFileName: true } } },
  });
  for (const record of records) {
    try {
      await fs.promises.unlink(safeFile(record.task));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
    }
    await prisma.importFileRecord.update({
      where: { id: record.id },
      data: { cleanedAt: new Date() },
    });
  }
  return records.length;
}

async function persistSheet(
  taskId: string,
  sheetName: string,
  mappingOverride?: Record<string, string>,
) {
  const task = await prisma.candidateImportTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { fileRecord: true, supplier: true },
  });
  const book = readWorkbook(safeFile(task));
  const sheet = book.Sheets[sheetName];
  if (!sheet) throw new Error("IMPORT_SHEET_NOT_FOUND");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
    blankrows: false,
  });
  const headerIndex = matrix.findIndex((row) =>
    row.some((cell) => String(cell ?? "").trim()),
  );
  if (headerIndex < 0) throw new Error("IMPORT_MAPPING_INVALID");
  const headers = matrix[headerIndex].map((item) => String(item ?? "").trim());
  const sourceRows = matrix
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim()));
  if (sourceRows.length > maxRows) throw new Error("IMPORT_ROW_LIMIT_EXCEEDED");
  const mapping = mappingOverride || autoMapping(headers);
  if (!mapping.name || !mapping.supplier || !mapping.position)
    await prisma.candidateImportTask.update({
      where: { id: taskId },
      data: {
        sheetName,
        fieldMapping: json(mapping),
        status: ImportTaskStatus.WAITING_MAPPING,
      },
    });
  const used = Object.values(mapping);
  if (new Set(used).size !== used.length)
    throw new Error("IMPORT_MAPPING_INVALID");
  const normalized = sourceRows.map((cells, index) => {
    const raw = Object.fromEntries(
      headers.map((header, i) => [
        header || `column_${i + 1}`,
        cells[i] ?? null,
      ]),
    );
    const mapped = Object.fromEntries(
      Object.entries(mapping).map(([field, header]) => [field, raw[header]]),
    );
    if (task.supplier) mapped.supplier = task.supplier.name;
    return {
      rowNumber: headerIndex + index + 2,
      raw,
      data: normalizeRow(mapped),
    };
  });
  const names = [
    ...new Set(
      normalized.map((row) => row.data.normalizedName).filter(Boolean),
    ),
  ] as string[];
  const existing = await prisma.candidate.findMany({
    where: { deletedAt: null, normalizedName: { in: names }, ...(task.supplierId ? { supplierId: task.supplierId } : {}) },
    select: {
      id: true,
      normalizedName: true,
      phoneNormalized: true,
      emailNormalized: true,
      normalizedUniversity: true,
      major: true,
      graduationYear: true,
    },
  });
  const byName = new Map<string, typeof existing>();
  existing.forEach((candidate) =>
    byName.set(candidate.normalizedName, [
      ...(byName.get(candidate.normalizedName) || []),
      candidate,
    ]),
  );
  const seen = new Map<string, number[]>();
  const prepared = normalized.map(({ rowNumber, raw, data }) => {
    const validation = validateRow(data);
    const matches = byName.get(data.normalizedName || "") || [];
    const sameBatch = seen.get(data.normalizedName || "") || [];
    if (data.normalizedName)
      seen.set(data.normalizedName, [...sameBatch, rowNumber]);
    const duplicate = classifyDuplicate(
      data,
      matches,
      sameBatch.flatMap((number) => {
        const found = normalized.find((item) => item.rowNumber === number);
        return found ? [found.data] : [];
      }),
    );
    const { level, reasons, ids } = duplicate;
    return {
      rowNumber,
      raw,
      data,
      validation,
      level,
      reasons,
      ids,
      action:
        level === DuplicateLevel.EXACT
          ? HandlingAction.SKIP
          : level === DuplicateLevel.MANUAL_REVIEW
            ? HandlingAction.MANUAL_REVIEW
            : HandlingAction.CREATE,
    };
  });
  await prisma.$transaction(async (tx) => {
    await tx.candidateImportRow.deleteMany({ where: { taskId } });
    for (let offset = 0; offset < prepared.length; offset += 500)
      await tx.candidateImportRow.createMany({
        data: prepared.slice(offset, offset + 500).map((row) => ({
          taskId,
          rowNumber: row.rowNumber,
          rawData: json(row.raw),
          normalizedData: json(row.data),
          name: row.data.name,
          phoneMasked: row.data.phoneMasked,
          supplierName: row.data.supplier,
          positionName: row.data.position,
          university: row.data.university,
          validationStatus: row.validation.status,
          errors: json(row.validation.errors),
          warnings: json(row.validation.warnings),
          duplicateLevel: row.level,
          duplicateReasons: json(row.reasons),
          matchedCandidateIds: json(row.ids),
          handlingAction: row.action,
        })),
      });
    await tx.candidateImportTask.update({
      where: { id: taskId },
      data: {
        sheetName,
        totalRows: prepared.length,
        validRows: prepared.filter(
          (row) => row.validation.status === ValidationStatus.VALID,
        ).length,
        warningRows: prepared.filter(
          (row) => row.validation.status === ValidationStatus.WARNING,
        ).length,
        invalidRows: prepared.filter(
          (row) => row.validation.status === ValidationStatus.INVALID,
        ).length,
        duplicateRows: prepared.filter(
          (row) =>
            row.level !== DuplicateLevel.NONE &&
            row.level !== DuplicateLevel.SAME_NAME_DIFFERENT_PERSON,
        ).length,
        fieldMapping: json(mapping),
        status:
          mapping.name && mapping.supplier && mapping.position
            ? ImportTaskStatus.WAITING_CONFIRMATION
            : ImportTaskStatus.WAITING_MAPPING,
      },
    });
  });
  return { headers, mapping, rows: prepared.length };
}

router.post(
  "/imports/candidates/upload",
  uploader.single("file"),
  wrap(async (req, res) => {
    assertSupplierIdentity(req);
    if (!req.file) throw new Error("IMPORT_FILE_INVALID");
    const bytes = fs.readFileSync(req.file.path);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const prior = await prisma.candidateImportTask.findFirst({
      where: { fileHash: hash, ...taskAccessWhere(req) },
      orderBy: { uploadedAt: "desc" },
      select: { id: true, taskNo: true, status: true, uploadedAt: true },
    });
    const task = await prisma.candidateImportTask.create({
      data: {
        taskNo: `IMP-${Date.now()}-${randomBytes(3).toString("hex")}`,
        originalFileName: path.basename(req.file.originalname),
        storedFileName: path.basename(req.file.filename),
        fileHash: hash,
        fileSize: req.file.size,
        uploadedBy: req.auth!.name,
        supplierId: supplierIdFor(req, clean(req.body.supplierId)) || null,
        defaultSupplierId: supplierIdFor(req, clean(req.body.supplierId)) || null,
        defaultPositionId: clean(req.body.defaultPositionId),
        fileRecord: {
          create: {
            fileHash: hash,
            contentType: req.file.mimetype,
            storagePath: path.basename(req.file.filename),
          },
        },
        logs: {
          create: {
            module: "候选人导入",
            action: "上传 Excel",
            operator: req.auth!.name,
            newValue: json({
              fileName: path.basename(req.file.originalname),
              fileSize: req.file.size,
              fileHash: hash,
            }),
          },
        },
      },
    });
    return success(
      res,
      {
        taskId: task.id,
        status: task.status,
        fileName: task.originalFileName,
        duplicateFile: prior || null,
      },
      201,
    );
  }),
);
router.post(
  "/imports/candidates/:taskId/parse",
  wrap(async (req, res) => {
    const task = await assertTaskAccess(req);
    await prisma.candidateImportTask.update({
      where: { id: task.id },
      data: { status: ImportTaskStatus.PARSING },
    });
    const sheets = nonEmptySheets(readWorkbook(safeFile(task)));
    if (!sheets.length) throw new Error("IMPORT_SHEET_NOT_FOUND");
    if (sheets.length > 1 && !req.body?.sheetName)
      return success(res, {
        taskId: task.id,
        status: ImportTaskStatus.PARSING,
        sheets,
        requiresSelection: true,
      });
    const sheetName = req.body?.sheetName || sheets[0];
    return success(res, {
      taskId: task.id,
      sheets,
      ...(await persistSheet(task.id, sheetName)),
    });
  }),
);
router.post(
  "/imports/candidates/:taskId/select-sheet",
  wrap(async (req, res) => {
    await assertTaskAccess(req);
    const sheetName = z.string().min(1).parse(req.body.sheetName);
    const data = await persistSheet(req.params.taskId, sheetName);
    await prisma.operationLog.create({
      data: {
        module: "候选人导入",
        action: "选择工作表",
        importTaskId: req.params.taskId,
        newValue: json({ sheetName }),
      },
    });
    return success(res, data);
  }),
);
router.get(
  "/imports/candidates/:taskId/mapping",
  wrap(async (req, res) => {
    const task = await prisma.candidateImportTask.findFirst({
      where: taskAccessWhere(req, req.params.taskId),
      select: { id: true, sheetName: true, fieldMapping: true, status: true },
    });
    if (!task) throw new Error("IMPORT_TASK_NOT_FOUND");
    return success(res, { task, aliases });
  }),
);
router.put(
  "/imports/candidates/:taskId/mapping",
  wrap(async (req, res) => {
    const mapping = z.record(z.string(), z.string()).parse(req.body.mapping);
    const used = Object.values(mapping);
    if (
      new Set(used).size !== used.length ||
      !mapping.name ||
      !mapping.supplier ||
      !mapping.position
    )
      throw new Error("IMPORT_MAPPING_INVALID");
    const task = await assertTaskAccess(req);
    if (!task?.sheetName) throw new Error("IMPORT_TASK_NOT_FOUND");
    const data = await persistSheet(task.id, task.sheetName, mapping);
    await prisma.operationLog.create({
      data: {
        module: "候选人导入",
        action: "修改字段映射",
        importTaskId: task.id,
        newValue: json(mapping),
      },
    });
    return success(res, data);
  }),
);
router.get(
  "/imports/candidates/:taskId/preview",
  wrap(async (req, res) => {
    await assertTaskAccess(req);
    const page = Math.max(1, Number(req.query.page || 1)),
      pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
    const where: Prisma.CandidateImportRowWhereInput = {
      taskId: req.params.taskId,
    };
    if (req.query.validationStatus)
      where.validationStatus = String(
        req.query.validationStatus,
      ) as ValidationStatus;
    if (req.query.duplicateLevel)
      where.duplicateLevel = String(req.query.duplicateLevel) as DuplicateLevel;
    if (req.query.supplier)
      where.supplierName = {
        contains: String(req.query.supplier),
        mode: "insensitive",
      };
    if (req.query.position)
      where.positionName = {
        contains: String(req.query.position),
        mode: "insensitive",
      };
    if (req.query.keyword)
      where.OR = [
        { name: { contains: String(req.query.keyword), mode: "insensitive" } },
        {
          supplierName: {
            contains: String(req.query.keyword),
            mode: "insensitive",
          },
        },
        {
          positionName: {
            contains: String(req.query.keyword),
            mode: "insensitive",
          },
        },
      ];
    const [task, rows, total] = await prisma.$transaction([
      prisma.candidateImportTask.findUnique({
        where: { id: req.params.taskId },
      }),
      prisma.candidateImportRow.findMany({
        where,
        orderBy: { rowNumber: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.candidateImportRow.count({ where }),
    ]);
    if (!task) throw new Error("IMPORT_TASK_NOT_FOUND");
    return success(res, {
      task,
      summary: {
        total: task.totalRows,
        valid: task.validRows,
        warning: task.warningRows,
        invalid: task.invalidRows,
        duplicate: task.duplicateRows,
      },
      rows,
      pagination: { page, pageSize, total },
    });
  }),
);
router.put(
  "/imports/candidates/:taskId/rows/:rowNumber",
  wrap(async (req, res) => {
    const taskAccess = await assertTaskAccess(req);
    const row = await prisma.candidateImportRow.findUnique({
      where: {
        taskId_rowNumber: {
          taskId: req.params.taskId,
          rowNumber: Number(req.params.rowNumber),
        },
      },
    });
    if (!row) throw new Error("IMPORT_TASK_NOT_FOUND");
    const oldData = row.normalizedData as Record<string, unknown>;
    const allowed = [
      "name",
      "phone",
      "email",
      "supplier",
      "projectName",
      "position",
      "university",
      "major",
      "highestEducation",
      "graduationYear",
      "resumeSubmitDate",
      "currentStatus",
      "expectedEntryDate",
      "actualEntryDate",
      "leaveDate",
      "remark",
    ];
    const patch = Object.fromEntries(
      allowed
        .filter((key) => key in req.body)
        .map((key) => [key, req.body[key]]),
    );
    const data = normalizeRow({ ...oldData, ...patch });
    if (taskAccess.supplierId) data.supplier = req.auth!.supplierName;
    const validation = validateRow(data);
    const [databaseMatches, importMatches] = await Promise.all([
      prisma.candidate.findMany({
        where: { deletedAt: null, normalizedName: data.normalizedName || "", ...(taskAccess.supplierId ? { supplierId: taskAccess.supplierId } : {}) },
        select: {
          id: true,
          phoneNormalized: true,
          emailNormalized: true,
          normalizedUniversity: true,
          major: true,
          graduationYear: true,
        },
      }),
      prisma.candidateImportRow.findMany({
        where: { taskId: row.taskId, id: { not: row.id }, name: data.name },
        select: { normalizedData: true },
      }),
    ]);
    const duplicate = classifyDuplicate(
      data,
      databaseMatches,
      importMatches.map(
        (item) => item.normalizedData as ReturnType<typeof normalizeRow>,
      ),
    );
    const action = req.body.handlingAction
      ? z.nativeEnum(HandlingAction).parse(req.body.handlingAction)
      : row.handlingAction;
    const updated = await prisma.candidateImportRow.update({
      where: { id: row.id },
      data: {
        normalizedData: json(data),
        name: data.name,
        phoneMasked: data.phoneMasked,
        supplierName: data.supplier,
        positionName: data.position,
        university: data.university,
        validationStatus: validation.status,
        errors: json(validation.errors),
        warnings: json(validation.warnings),
        duplicateLevel: duplicate.level,
        duplicateReasons: json(duplicate.reasons),
        matchedCandidateIds: json(duplicate.ids),
        handlingAction: action,
      },
    });
    const counts = await prisma.candidateImportRow.groupBy({
      by: ["validationStatus"],
      where: { taskId: row.taskId },
      _count: { _all: true },
    });
    const count = (status: ValidationStatus) =>
      counts.find((item) => item.validationStatus === status)?._count._all || 0;
    const duplicateRows = await prisma.candidateImportRow.count({
      where: {
        taskId: row.taskId,
        duplicateLevel: {
          in: [
            DuplicateLevel.EXACT,
            DuplicateLevel.HIGH_SUSPECT,
            DuplicateLevel.MANUAL_REVIEW,
          ],
        },
      },
    });
    await prisma.candidateImportTask.update({
      where: { id: row.taskId },
      data: {
        validRows: count(ValidationStatus.VALID),
        warningRows: count(ValidationStatus.WARNING),
        invalidRows: count(ValidationStatus.INVALID),
        duplicateRows,
      },
    });
    await prisma.operationLog.create({
      data: {
        module: "候选人导入",
        action:
          req.body.handlingAction && !Object.keys(patch).length
            ? "选择重复处理方式"
            : "编辑预览数据",
        importTaskId: row.taskId,
        oldValue: json(oldData),
        newValue: json(data),
        operator: clean(req.body.operator),
      },
    });
    return success(res, updated);
  }),
);

async function candidateNumber(tx: Prisma.TransactionClient) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`candidate-no-${day}`}))`;
  const count = await tx.candidate.count({
    where: { candidateNo: { startsWith: `C${day}` } },
  });
  return `C${day}${String(count + 1).padStart(4, "0")}`;
}
router.post(
  "/imports/candidates/:taskId/confirm",
  wrap(async (req, res) => {
    const body = z
      .object({
        operator: z.string().min(1),
        allowWarnings: z.boolean().default(false),
      })
      .parse(req.body);
    const accessTask = await assertTaskAccess(req);
    const locked = await prisma.candidateImportTask.updateMany({
      where: {
        id: req.params.taskId,
        ...(accessTask.supplierId ? { supplierId: accessTask.supplierId } : {}),
        status: ImportTaskStatus.WAITING_CONFIRMATION,
      },
      data: { status: ImportTaskStatus.IMPORTING, confirmedAt: new Date() },
    });
    if (!locked.count) {
      const exists = await prisma.candidateImportTask.findFirst({ where: taskAccessWhere(req, req.params.taskId) });
      if (!exists) throw new Error("IMPORT_TASK_NOT_FOUND");
      throw new Error("IMPORT_TASK_ALREADY_CONFIRMED");
    }
    const rows = await prisma.candidateImportRow.findMany({
      where: { taskId: req.params.taskId },
      orderBy: { rowNumber: "asc" },
    });
    let imported = 0,
      skipped = 0,
      failed = 0;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const group = rows.slice(offset, offset + batchSize);
      for (const row of group) {
        try {
          if (
            row.validationStatus === ValidationStatus.INVALID ||
            (row.validationStatus === ValidationStatus.WARNING &&
              !body.allowWarnings)
          ) {
            skipped++;
            await prisma.candidateImportRow.update({
              where: { id: row.id },
              data: {
                importStatus: ImportRowStatus.SKIPPED,
                failureReason: "校验未通过或未允许警告行",
              },
            });
            continue;
          }
          if (
            row.handlingAction === HandlingAction.SKIP ||
            row.handlingAction === HandlingAction.MANUAL_REVIEW
          ) {
            skipped++;
            await prisma.$transaction([
              prisma.candidateImportRow.update({
                where: { id: row.id },
                data: {
                  importStatus:
                    row.handlingAction === HandlingAction.SKIP
                      ? ImportRowStatus.SKIPPED
                      : ImportRowStatus.MANUAL_REVIEW,
                },
              }),
              prisma.operationLog.create({
                data: {
                  module: "候选人导入",
                  action:
                    row.handlingAction === HandlingAction.SKIP
                      ? "跳过重复数据"
                      : "标记人工复核",
                  importTaskId: row.taskId,
                  operator: body.operator,
                  newValue: json({
                    rowNumber: row.rowNumber,
                    duplicateLevel: row.duplicateLevel,
                  }),
                },
              }),
            ]);
            continue;
          }
          const data = row.normalizedData as Record<string, any>;
          if (isSupplierUser(req)) data.supplier = req.auth!.supplierName;
          await prisma.$transaction(async (tx) => {
            const supplier = isSupplierUser(req) ? await tx.supplier.findUniqueOrThrow({ where: { id: req.auth!.supplierId! } }) : await tx.supplier.upsert({
              where: {
                code: `AUTO-${createHash("sha1").update(data.supplier).digest("hex").slice(0, 12)}`,
              },
              update: { name: data.supplier },
              create: {
                code: `AUTO-${createHash("sha1").update(data.supplier).digest("hex").slice(0, 12)}`,
                name: data.supplier,
              },
            });
            let position = await tx.jobPosition.findFirst({
              where: { name: data.position },
            });
            position ||= await tx.jobPosition.create({
              data: { name: data.position, projectName: data.projectName },
            });
            const matchedIds = strings(row.matchedCandidateIds);
            if (
              [HandlingAction.UPDATE, HandlingAction.MERGE].includes(
                row.handlingAction,
              ) &&
              !matchedIds[0]
            )
              throw new Error("IMPORT_DUPLICATE_UNRESOLVED");
            let candidate;
            if (
              [HandlingAction.UPDATE, HandlingAction.MERGE].includes(
                row.handlingAction,
              ) &&
              matchedIds[0]
            ) {
              const existing = await tx.candidate.findFirstOrThrow({ where: { id: matchedIds[0], ...(isSupplierUser(req) ? { supplierId: req.auth!.supplierId! } : {}) } });
              const values = {
                name: data.name,
                normalizedName: data.normalizedName,
                phone: data.phone,
                phoneNormalized: data.phoneNormalized,
                phoneMasked: data.phoneMasked,
                email: data.email,
                emailNormalized: data.emailNormalized,
                emailMasked: data.emailMasked,
                supplierId: supplier.id,
                positionId: position.id,
                projectName: data.projectName,
                university: data.university,
                normalizedUniversity: data.normalizedUniversity,
                major: data.major,
                highestEducation: data.highestEducation,
                graduationYear: data.graduationYear,
                resumeSubmitDate: asDate(data.resumeSubmitDate),
                currentStatus: data.currentStatus,
                expectedEntryDate: asDate(data.expectedEntryDate),
                actualEntryDate: asDate(data.actualEntryDate),
                leaveDate: asDate(data.leaveDate),
                remark: data.remark,
                updatedBy: body.operator,
              };
              const update =
                row.handlingAction === HandlingAction.MERGE
                  ? Object.fromEntries(
                      Object.entries(values).filter(
                        ([, value]) =>
                          value !== null && value !== undefined && value !== "",
                      ),
                    )
                  : values;
              candidate = await tx.candidate.update({
                where: { id: existing.id },
                data: update,
              });
            } else {
              let retries = 0;
              while (true) {
                try {
                  candidate = await tx.candidate.create({
                    data: {
                      candidateNo: await candidateNumber(tx),
                      name: data.name,
                      normalizedName: data.normalizedName,
                      phone: data.phone,
                      phoneNormalized: data.phoneNormalized,
                      phoneMasked: data.phoneMasked,
                      email: data.email,
                      emailNormalized: data.emailNormalized,
                      emailMasked: data.emailMasked,
                      supplierId: supplier.id,
                      positionId: position.id,
                      projectName: data.projectName,
                      university: data.university,
                      normalizedUniversity: data.normalizedUniversity,
                      major: data.major,
                      highestEducation: data.highestEducation,
                      graduationYear: data.graduationYear,
                      resumeSubmitDate: asDate(data.resumeSubmitDate),
                      currentStatus: data.currentStatus,
                      expectedEntryDate: asDate(data.expectedEntryDate),
                      actualEntryDate: asDate(data.actualEntryDate),
                      leaveDate: asDate(data.leaveDate),
                      remark: data.remark,
                      source: "EXCEL_IMPORT",
                      createdBy: body.operator,
                      updatedBy: body.operator,
                    },
                  });
                  break;
                } catch (error) {
                  if (
                    ++retries >= 3 ||
                    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
                    error.code !== "P2002"
                  )
                    throw error;
                }
              }
            }
            await tx.candidateStatusEvent.create({
              data: {
                candidateId: candidate!.id,
                status: candidate!.currentStatus,
                effectiveAt: new Date(),
                operator: body.operator,
                remark: "Excel 批量导入",
              },
            });
            await tx.operationLog.create({
              data: {
                module: "候选人",
                action:
                  row.handlingAction === HandlingAction.CREATE
                    ? "创建候选人"
                    : row.handlingAction === HandlingAction.MERGE
                      ? "合并候选人"
                      : "更新候选人",
                candidateId: candidate!.id,
                importTaskId: row.taskId,
                operator: body.operator,
                newValue: json({
                  candidateNo: candidate!.candidateNo,
                  rowNumber: row.rowNumber,
                }),
              },
            });
            await tx.candidateImportRow.update({
              where: { id: row.id },
              data: {
                importStatus: ImportRowStatus.IMPORTED,
                importedCandidateId: candidate!.id,
              },
            });
          });
          imported++;
        } catch (error) {
          failed++;
          const failureReason =
            error instanceof Error ? error.message.slice(0, 500) : "导入失败";
          await prisma.$transaction([
            prisma.candidateImportRow.update({
              where: { id: row.id },
              data: { importStatus: ImportRowStatus.FAILED, failureReason },
            }),
            prisma.operationLog.create({
              data: {
                module: "候选人导入",
                action: "导入失败",
                importTaskId: row.taskId,
                operator: body.operator,
                reason: failureReason,
                newValue: json({ rowNumber: row.rowNumber }),
              },
            }),
          ]);
        }
      }
    }
    const status = failed
      ? ImportTaskStatus.PARTIAL_FAILED
      : ImportTaskStatus.COMPLETED;
    const task = await prisma.candidateImportTask.update({
      where: { id: req.params.taskId },
      data: {
        status,
        importedRows: imported,
        skippedRows: skipped,
        failedRows: failed,
        completedAt: new Date(),
        logs: {
          create: {
            module: "候选人导入",
            action: "确认导入",
            operator: body.operator,
            newValue: json({ imported, skipped, failed }),
          },
        },
      },
    });
    return success(res, task);
  }),
);

router.get(
  "/imports/candidates",
  wrap(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1)),
      pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
    const [rows, total] = await prisma.$transaction([
      prisma.candidateImportTask.findMany({
        where: taskAccessWhere(req),
        orderBy: { uploadedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          taskNo: true,
          originalFileName: true,
          uploadedBy: true,
          uploadedAt: true,
          totalRows: true,
          validRows: true,
          warningRows: true,
          invalidRows: true,
          duplicateRows: true,
          importedRows: true,
          skippedRows: true,
          failedRows: true,
          status: true,
        },
      }),
      prisma.candidateImportTask.count({ where: taskAccessWhere(req) }),
    ]);
    return success(res, { rows, pagination: { page, pageSize, total } });
  }),
);
router.get(
  "/imports/candidates/:taskId/errors/export",
  wrap(async (req, res) => {
    await assertTaskAccess(req);
    const rows = await prisma.candidateImportRow.findMany({
      where: {
        taskId: req.params.taskId,
        OR: [
          { validationStatus: ValidationStatus.INVALID },
          { importStatus: ImportRowStatus.FAILED },
        ],
      },
      orderBy: { rowNumber: "asc" },
    });
    const escape = (value: unknown) => {
      const text = Array.isArray(value)
        ? value.join("；")
        : String(value ?? "");
      return /^[=+\-@]/.test(text) ? `'${text}` : text;
    };
    const sheet = XLSX.utils.json_to_sheet(
      rows.map((row) => ({
        Excel行号: row.rowNumber,
        姓名: escape(row.name),
        供应商: escape(row.supplierName),
        岗位: escape(row.positionName),
        数据状态: row.validationStatus,
        重复风险: row.duplicateLevel,
        错误原因: escape(strings(row.errors)),
        警告: escape(strings(row.warnings)),
        处理结果: row.importStatus,
        建议操作: row.failureReason || "修正后重新导入",
      })),
    );
    const buffer = XLSX.write(
      { SheetNames: ["失败明细"], Sheets: { 失败明细: sheet } },
      { type: "buffer", bookType: "xlsx" },
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent("导入失败明细.xlsx")}`,
    );
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(buffer);
  }),
);
router.delete(
  "/imports/candidates/:taskId/file",
  wrap(async (req, res) => {
    const task = await prisma.candidateImportTask.findFirst({
      where: taskAccessWhere(req, req.params.taskId),
      include: { fileRecord: true },
    });
    if (!task?.fileRecord) throw new Error("IMPORT_TASK_NOT_FOUND");
    try {
      await fs.promises.unlink(safeFile(task));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await prisma.$transaction([
      prisma.importFileRecord.update({
        where: { id: task.fileRecord.id },
        data: { cleanedAt: new Date() },
      }),
      prisma.operationLog.create({
        data: {
          module: "候选人导入",
          action: "清理临时文件",
          importTaskId: task.id,
          operator: clean(req.body?.operator),
        },
      }),
    ]);
    return success(res, { taskId: task.id, cleaned: true });
  }),
);

const candidateSelect = {
  id: true,
  candidateNo: true,
  name: true,
  phoneMasked: true,
  emailMasked: true,
  projectName: true,
  university: true,
  major: true,
  highestEducation: true,
  graduationYear: true,
  resumeSubmitDate: true,
  resumeResult: true,
  currentStatus: true,
  expectedEntryDate: true,
  actualEntryDate: true,
  leaveDate: true,
  remark: true,
  createdAt: true,
  updatedAt: true,
  supplier: { select: { id: true, name: true } },
  position: { select: { id: true, name: true } },
} satisfies Prisma.CandidateSelect;
router.get(
  "/candidates",
  wrap(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1)),
      pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
    const where: Prisma.CandidateWhereInput = { deletedAt: null, ...candidateScope(req) };
    const scopedSupplierId = supplierIdFor(req, req.query.supplierId ? String(req.query.supplierId) : null);
    const scopedSupplierName = supplierNameFor(req, req.query.supplier ? String(req.query.supplier) : null);
    if (scopedSupplierId) where.supplierId = scopedSupplierId;
    else if (scopedSupplierName) where.supplier = { name: scopedSupplierName };
    if (req.query.positionId) where.positionId = String(req.query.positionId);
    if (req.query.position)
      where.position = { name: String(req.query.position) };
    if (req.query.projectName)
      where.projectName = String(req.query.projectName);
    if (req.query.currentStatus)
      where.currentStatus = String(req.query.currentStatus);
    if (req.query.university)
      where.university = {
        contains: String(req.query.university),
        mode: "insensitive",
      };
    if (req.query.keyword) {
      const word = String(req.query.keyword);
      where.OR = [
        { name: { contains: word, mode: "insensitive" } },
        { candidateNo: { contains: word, mode: "insensitive" } },
        { phoneNormalized: { endsWith: word.replace(/\D/g, "").slice(-4) } },
      ];
    }
    const sortable = new Set([
      "createdAt",
      "updatedAt",
      "resumeSubmitDate",
      "name",
      "candidateNo",
      "currentStatus",
    ]);
    const sortField = sortable.has(String(req.query.sortField))
      ? String(req.query.sortField)
      : "updatedAt";
    const sortOrder = req.query.sortOrder === "ascend" ? "asc" : "desc";
    const [rows, total] = await prisma.$transaction([
      prisma.candidate.findMany({
        where,
        select: candidateSelect,
        orderBy: { [sortField]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.candidate.count({ where }),
    ]);
    return success(res, { rows, pagination: { page, pageSize, total } });
  }),
);
router.get(
  "/candidates/:id",
  wrap(async (req, res) => {
    const candidate = await prisma.candidate.findFirst({
      where: { id: req.params.id, deletedAt: null, ...candidateScope(req) },
      select: {
        ...candidateSelect,
        statusEvents: { orderBy: { effectiveAt: "desc" } },
        interviews: true,
      },
    });
    if (!candidate) throw new Error("CANDIDATE_NOT_FOUND");
    return success(res, candidate);
  }),
);
const candidateBody = z.object({
  name: z.string().trim().min(1),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  supplierId: z.string().min(1).optional(),
  supplierName: z.string().min(1).optional(),
  positionId: z.string().min(1).optional(),
  positionName: z.string().min(1).optional(),
  projectName: z.string().optional().nullable(),
  university: z.string().optional().nullable(),
  major: z.string().optional().nullable(),
  currentStatus: z.string().default("简历待筛选"),
  resumeSubmitDate: z.string().optional().nullable(),
  expectedEntryDate: z.string().optional().nullable(),
  actualEntryDate: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
  operator: z.string().default("招聘专员"),
});
router.post(
  "/candidates",
  wrap(async (req, res) => {
    const body = candidateBody.parse(req.body);
    assertSupplierIdentity(req);
    const phone = normalizePhone(body.phone),
      email = clean(body.email)?.toLowerCase() || null;
    const candidate = await prisma.$transaction(async (tx) => {
      const forcedSupplierId = supplierIdFor(req, body.supplierId);
      const forcedSupplierName = supplierNameFor(req, body.supplierName);
      const supplier = forcedSupplierId
        ? await tx.supplier.findUniqueOrThrow({
            where: { id: forcedSupplierId },
          })
        : await tx.supplier.upsert({
            where: {
              code: `AUTO-${createHash("sha1")
                .update(forcedSupplierName || "待补充")
                .digest("hex")
                .slice(0, 12)}`,
            },
            update: { name: forcedSupplierName || "待补充" },
            create: {
              code: `AUTO-${createHash("sha1")
                .update(forcedSupplierName || "待补充")
                .digest("hex")
                .slice(0, 12)}`,
              name: forcedSupplierName || "待补充",
            },
          });
      let position = body.positionId
        ? await tx.jobPosition.findUniqueOrThrow({
            where: { id: body.positionId },
          })
        : await tx.jobPosition.findFirst({
            where: { name: body.positionName || "待补充岗位" },
          });
      position ||= await tx.jobPosition.create({
        data: { name: body.positionName || "待补充岗位" },
      });
      const created = await tx.candidate.create({
        data: {
          candidateNo: await candidateNumber(tx),
          name: body.name,
          normalizedName: normalizeName(body.name)!,
          phone,
          phoneNormalized: phone,
          phoneMasked: maskPhone(phone),
          email,
          emailNormalized: email,
          emailMasked: maskEmail(email),
          supplierId: supplier.id,
          positionId: position.id,
          projectName: body.projectName,
          university: body.university,
          normalizedUniversity: normalizeName(body.university),
          major: body.major,
          currentStatus: body.currentStatus,
          resumeSubmitDate: asDate(body.resumeSubmitDate),
          expectedEntryDate: asDate(body.expectedEntryDate),
          actualEntryDate: asDate(body.actualEntryDate),
          remark: body.remark,
          source: "MANUAL",
          createdBy: body.operator,
          updatedBy: body.operator,
        },
      });
      await tx.candidateStatusEvent.create({
        data: {
          candidateId: created.id,
          status: created.currentStatus,
          effectiveAt: new Date(),
          operator: body.operator,
          remark: "手工创建",
        },
      });
      return created;
    });
    return success(
      res,
      await prisma.candidate.findUnique({
        where: { id: candidate.id },
        select: candidateSelect,
      }),
      201,
    );
  }),
);
router.put(
  "/candidates/:id",
  wrap(async (req, res) => {
    const old = await prisma.candidate.findFirst({
      where: { id: req.params.id, deletedAt: null, ...candidateScope(req) },
    });
    if (!old) throw new Error("CANDIDATE_NOT_FOUND");
    const body = candidateBody.partial().parse(req.body);
    const {
      operator,
      supplierName: _supplierName,
      positionName: _positionName,
      ...candidatePatch
    } = body;
    const phone = "phone" in body ? normalizePhone(body.phone) : undefined,
      email =
        "email" in body ? clean(body.email)?.toLowerCase() || null : undefined;
    const updated = await prisma.$transaction(async (tx) => {
      const candidate = await tx.candidate.update({
        where: { id: old.id },
        data: {
          ...candidatePatch,
          supplierId: isSupplierUser(req) ? req.auth!.supplierId! : candidatePatch.supplierId,
          normalizedName: body.name ? normalizeName(body.name)! : undefined,
          phone,
          phoneNormalized: phone,
          phoneMasked: phone === undefined ? undefined : maskPhone(phone),
          email,
          emailNormalized: email,
          emailMasked: email === undefined ? undefined : maskEmail(email),
          normalizedUniversity:
            body.university === undefined
              ? undefined
              : normalizeName(body.university),
          resumeSubmitDate:
            body.resumeSubmitDate === undefined
              ? undefined
              : asDate(body.resumeSubmitDate),
          expectedEntryDate:
            body.expectedEntryDate === undefined
              ? undefined
              : asDate(body.expectedEntryDate),
          actualEntryDate:
            body.actualEntryDate === undefined
              ? undefined
              : asDate(body.actualEntryDate),
          updatedBy: operator,
        },
      });
      if (body.currentStatus && body.currentStatus !== old.currentStatus)
        await tx.candidateStatusEvent.create({
          data: {
            candidateId: old.id,
            status: body.currentStatus,
            effectiveAt: new Date(),
            operator: body.operator || "招聘专员",
            remark: body.remark || "修改候选人状态",
          },
        });
      await tx.operationLog.create({
        data: {
          module: "候选人",
          action:
            body.currentStatus !== old.currentStatus
              ? "修改候选人状态"
              : "更新候选人",
          candidateId: old.id,
          oldValue: json({ currentStatus: old.currentStatus }),
          newValue: json({ currentStatus: candidate.currentStatus }),
          operator: body.operator,
        },
      });
      return candidate;
    });
    return success(
      res,
      await prisma.candidate.findUnique({
        where: { id: updated.id },
        select: candidateSelect,
      }),
    );
  }),
);
router.delete(
  "/candidates/:id",
  wrap(async (req, res) => {
    const updated = await prisma.candidate.updateMany({
      where: { id: req.params.id, deletedAt: null, ...candidateScope(req) },
      data: {
        deletedAt: new Date(),
        updatedBy: clean(req.body?.operator) || "招聘专员",
      },
    });
    if (!updated.count) throw new Error("CANDIDATE_NOT_FOUND");
    await prisma.operationLog.create({
      data: {
        module: "候选人",
        action: "删除候选人",
        candidateId: req.params.id,
        operator: clean(req.body?.operator),
      },
    });
    return success(res, { id: req.params.id });
  }),
);

function dashboardWhere(req: Request): Prisma.CandidateWhereInput {
  const query = req.query;
  const scopedSupplierId = supplierIdFor(req, query.supplierId ? String(query.supplierId) : null);
  const scopedSupplierName = supplierNameFor(req, query.supplier ? String(query.supplier) : null);
  return {
    deletedAt: null,
    ...(scopedSupplierId ? { supplierId: scopedSupplierId } : {}),
    ...(!scopedSupplierId && scopedSupplierName ? { supplier: { name: scopedSupplierName } } : {}),
    ...(query.positionId ? { positionId: String(query.positionId) } : {}),
    ...(query.position ? { position: { name: String(query.position) } } : {}),
    ...(query.projectName ? { projectName: String(query.projectName) } : {}),
  };
}
router.get(
  "/dashboard/overview",
  wrap(async (req, res) => {
    const selected = String(
        req.query.selectedDate || new Date().toISOString().slice(0, 10),
      ),
      start = new Date(`${selected}T00:00:00.000Z`),
      end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    const where = dashboardWhere(req);
    const candidatesAtDate = await prisma.candidate.findMany({
      where: { ...where, createdAt: { lt: end } },
      select: { id: true, currentStatus: true },
    });
    const events = await prisma.candidateStatusEvent.findMany({
      where: {
        candidateId: { in: candidatesAtDate.map((candidate) => candidate.id) },
        effectiveAt: { lt: end },
      },
      orderBy: { effectiveAt: "desc" },
    });
    const latestStatus = new Map<string, string>();
    events.forEach((event) => {
      if (!latestStatus.has(event.candidateId))
        latestStatus.set(event.candidateId, event.status);
    });
    const statusCount = (status: string) =>
      candidatesAtDate.filter(
        (candidate) =>
          (latestStatus.get(candidate.id) || candidate.currentStatus) ===
          status,
      ).length;
    const project = statusCount("项目中"),
      training = statusCount("培训中"),
      pending = statusCount("待入职"),
      abnormal = statusCount("异常");
    const [submitted, interviewPassed, joined] = await prisma.$transaction([
      prisma.candidate.count({
        where: { ...where, resumeSubmitDate: { gte: start, lt: end } },
      }),
      prisma.interview.count({
        where: {
          result: "通过",
          updatedAt: { gte: start, lt: end },
          candidate: where,
        },
      }),
      prisma.candidate.count({
        where: { ...where, actualEntryDate: { gte: start, lt: end } },
      }),
    ]);
    return success(res, {
      project,
      training,
      pending,
      submitted,
      interviewPassed,
      joined,
      abnormal,
    });
  }),
);
router.get(
  "/dashboard/funnel",
  wrap(async (req, res) => {
    const where = dashboardWhere(req);
    const [submitted, screened, interviewed, passed, pending, joined] =
      await prisma.$transaction([
        prisma.candidate.count({ where }),
        prisma.candidate.count({ where: { ...where, resumeResult: "通过" } }),
        prisma.candidate.count({
          where: { ...where, interviews: { some: {} } },
        }),
        prisma.candidate.count({
          where: { ...where, interviews: { some: { result: "通过" } } },
        }),
        prisma.candidate.count({
          where: {
            ...where,
            currentStatus: { in: ["待确认入职", "待入职", "培训中", "项目中"] },
          },
        }),
        prisma.candidate.count({
          where: { ...where, actualEntryDate: { not: null } },
        }),
      ]);
    return success(res, {
      submitted,
      screened,
      interviewed,
      passed,
      pending,
      joined,
    });
  }),
);
router.get(
  "/dashboard/vendors",
  wrap(async (req, res) => {
    const where = dashboardWhere(req);
    const rows = await prisma.candidate.groupBy({
      by: ["supplierId"],
      where,
      _count: { _all: true },
    });
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: rows.map((row) => row.supplierId) } },
    });
    const maxCount = Math.max(0, ...rows.map((row) => row._count._all));
    const details = await Promise.all(
      rows.map(async (row) => {
        const [resumePassed, interviewPassed, offersAccepted] =
          await prisma.$transaction([
            prisma.candidate.count({
              where: {
                ...where,
                supplierId: row.supplierId,
                resumeResult: "通过",
              },
            }),
            prisma.candidate.count({
              where: {
                ...where,
                supplierId: row.supplierId,
                interviews: { some: { result: "通过" } },
              },
            }),
            prisma.candidate.count({
              where: {
                ...where,
                supplierId: row.supplierId,
                currentStatus: { in: ["待入职", "培训中", "项目中"] },
              },
            }),
          ]);
        const resumePassRate = row._count._all
          ? Math.round((resumePassed / row._count._all) * 100)
          : null;
        const offerAcceptanceRate = interviewPassed
          ? Math.round((offersAccepted / interviewPassed) * 100)
          : null;
        const resumeVolumeScore = maxCount
          ? Math.round((row._count._all / maxCount) * 100)
          : 0;
        const totalScore = Math.round(
          resumeVolumeScore * 0.5 +
            (resumePassRate || 0) * 0.4 +
            (offerAcceptanceRate || 0) * 0.1,
        );
        return {
          supplierId: row.supplierId,
          vendor:
            suppliers.find((supplier) => supplier.id === row.supplierId)
              ?.name || "未知供应商",
          resumeVolumeScore,
          resumeQualityScore: resumePassRate || 0,
          offerAcceptanceScore: offerAcceptanceRate || 0,
          totalScore,
          level:
            totalScore >= 85
              ? "优秀"
              : totalScore >= 70
                ? "良好"
                : totalScore >= 60
                  ? "需关注"
                  : "高风险",
          metrics: {
            resumeCount: row._count._all,
            resumePassRate,
            offerAcceptanceRate,
          },
        };
      }),
    );
    return success(res, details);
  }),
);
router.get(
  "/dashboard/risks",
  wrap(async (req, res) => {
    const where = dashboardWhere(req);
    const [abnormal, feedback, overdue] = await prisma.$transaction([
      prisma.candidate.count({ where: { ...where, currentStatus: "异常" } }),
      prisma.candidate.count({
        where: { ...where, currentStatus: "面试待反馈" },
      }),
      prisma.candidate.count({
        where: {
          ...where,
          currentStatus: "待入职",
          expectedEntryDate: { lt: new Date() },
        },
      }),
    ]);
    return success(res, {
      abnormal,
      feedback,
      overdue,
      total: abnormal + feedback + overdue,
    });
  }),
);

export default router;
