import { randomBytes } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { BusinessLine, FeaturePermission, Prisma, RecordStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import XLSX from "xlsx";
import { prisma } from "./database.js";
import { createTencentMeetingClient } from "./tencentMeetingClient.js";
import { assertPermission, hasPermission, isSupplierUser } from "./auth.js";
import {
  ScopeForbiddenError,
  applicationScopeWhere,
  buildDataScope,
  parseBusinessLine,
  scopedOrThrow,
  type DataScope,
} from "./dataScopeService.js";

const router = Router();
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
const success = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data, requestId: res.locals.requestId });
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? null));
const date = (value?: string | null) => value ? new Date(value) : null;
const lineName = (line: BusinessLine) => line === BusinessLine.VIDEO ? "视频" : line === BusinessLine.AUDIO ? "音频" : "待归类";
const requested = (req: Request) => ({
  supplierId: req.query.supplierId ? String(req.query.supplierId) : undefined,
  businessLine: parseBusinessLine(req.query.businessLine),
});
const scopeFor = (req: Request, body?: { supplierId?: string | null; businessLine?: unknown }) =>
  buildDataScope(
    req.auth!,
    body?.supplierId || (req.query.supplierId ? String(req.query.supplierId) : undefined),
    parseBusinessLine(body?.businessLine ?? req.query.businessLine),
  );
const pagination = (req: Request) => ({
  page: Math.max(1, Number(req.query.page || 1)),
  pageSize: Math.min(100, Math.max(1, Number(req.query.pageSize || 20))),
});

function applicationWhere(req: Request, scope: DataScope): Prisma.CandidateApplicationWhereInput {
  const where: Prisma.CandidateApplicationWhereInput = applicationScopeWhere(scope);
  if (req.query.status) where.currentStatus = String(req.query.status);
  if (req.query.positionId) where.positionId = String(req.query.positionId);
  if (req.query.keyword) {
    const word = String(req.query.keyword);
    where.OR = [
      { applicationNo: { contains: word, mode: "insensitive" } },
      { candidate: { name: { contains: word, mode: "insensitive" } } },
      { candidate: { phoneNormalized: { endsWith: word.replace(/\D/g, "").slice(-4) } } },
    ];
  }
  if (req.query.dateFrom || req.query.dateTo) where.createdAt = {
    ...(req.query.dateFrom ? { gte: new Date(String(req.query.dateFrom)) } : {}),
    ...(req.query.dateTo ? { lte: new Date(String(req.query.dateTo)) } : {}),
  };
  return where;
}

const applicationInclude = {
  candidate: { select: { id: true, candidateNo: true, name: true, phone: true, phoneMasked: true, email: true, emailMasked: true, university: true, major: true, highestEducation: true } },
  supplier: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, name: true } },
  interviews: { orderBy: { scheduledStartTime: "desc" as const }, take: 3 },
  owner: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CandidateApplicationInclude;

function applicationPayload(req: Request, row: any) {
  const contactsVisible = hasPermission(req, FeaturePermission.CANDIDATE_CONTACT_VIEW);
  return {
    ...row,
    candidate: {
      ...row.candidate,
      phone: contactsVisible ? row.candidate.phone : row.candidate.phoneMasked,
      email: contactsVisible ? row.candidate.email : row.candidate.emailMasked,
    },
  };
}

router.get("/applications", wrap(async (req, res) => scopedOrThrow(req, "CandidateApplication", undefined, requested(req), async (scope) => {
  assertPermission(req, FeaturePermission.CANDIDATE_VIEW);
  const { page, pageSize } = pagination(req), where = applicationWhere(req, scope);
  const [rows, total] = await prisma.$transaction([
    prisma.candidateApplication.findMany({ where, include: applicationInclude, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.candidateApplication.count({ where }),
  ]);
  return success(res, { rows: rows.map((row) => applicationPayload(req, row)), pagination: { page, pageSize, total }, scope });
})));

router.get("/applications/:id", wrap(async (req, res) => scopedOrThrow(req, "CandidateApplication", String(req.params.id), requested(req), async (scope) => {
  assertPermission(req, FeaturePermission.CANDIDATE_VIEW);
  const row = await prisma.candidateApplication.findFirst({ where: { id: String(req.params.id), ...applicationScopeWhere(scope) }, include: applicationInclude });
  if (!row) throw new Error("APPLICATION_NOT_FOUND");
  return success(res, applicationPayload(req, row));
})));

const applicationBody = z.object({
  candidateId: z.string().optional(),
  name: z.string().trim().min(1).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  university: z.string().optional().nullable(),
  major: z.string().optional().nullable(),
  highestEducation: z.string().optional().nullable(),
  supplierId: z.string().min(1),
  businessLine: z.nativeEnum(BusinessLine),
  positionId: z.string().optional().nullable(),
  projectName: z.string().optional().nullable(),
  currentStatus: z.string().default("简历待筛选"),
  resumeResult: z.string().optional().nullable(),
  interviewResult: z.string().optional().nullable(),
  expectedEntryDate: z.string().optional().nullable(),
  actualEntryDate: z.string().optional().nullable(),
  businessData: z.record(z.string(), z.unknown()).optional().nullable(),
  ownerId: z.string().optional().nullable(),
});

router.post("/applications", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.CANDIDATE_CREATE);
  const body = applicationBody.parse(req.body), scope = scopeFor(req, body);
  if (body.currentStatus !== "简历待筛选") throw new Error("APPLICATION_STATUS_INITIAL_INVALID");
  const supplierId = scope.supplierId || body.supplierId;
  if (!supplierId || (scope.businessLine && scope.businessLine !== body.businessLine)) throw new ScopeForbiddenError("应聘记录超出当前数据范围");
  const result = await prisma.$transaction(async (tx) => {
    const ownerId = isSupplierUser(req) && !req.auth!.isSupplierManager
      ? req.auth!.id
      : body.ownerId || (isSupplierUser(req) ? req.auth!.id : null);
    if (ownerId) {
      const owner = await tx.user.findFirst({
        where: {
          id: ownerId,
          supplierId,
          status: RecordStatus.ACTIVE,
          businessLines: { has: body.businessLine },
        },
      });
      if (!owner) throw new Error("APPLICATION_OWNER_INVALID");
    }
    let candidate = body.candidateId ? await tx.candidate.findFirst({ where: { id: body.candidateId, deletedAt: null } }) : null;
    if (!candidate && (body.phone || body.email)) candidate = await tx.candidate.findFirst({ where: { deletedAt: null, OR: [
      ...(body.phone ? [{ phoneNormalized: body.phone.replace(/\D/g, "").replace(/^86/, "") }] : []),
      ...(body.email ? [{ emailNormalized: body.email.toLowerCase() }] : []),
    ] } });
    if (!candidate) {
      if (!body.name || !body.positionId) throw new Error("APPLICATION_CANDIDATE_REQUIRED");
      const phone = body.phone?.replace(/\D/g, "").replace(/^86/, "") || null;
      candidate = await tx.candidate.create({ data: {
        candidateNo: `C${Date.now()}${randomBytes(2).toString("hex")}`,
        name: body.name,
        normalizedName: body.name.replace(/\s/g, "").toLowerCase(),
        phone, phoneNormalized: phone, phoneMasked: phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : null,
        email: body.email?.toLowerCase() || null, emailNormalized: body.email?.toLowerCase() || null,
        emailMasked: body.email ? `${body.email.slice(0, 1)}***@${body.email.split("@")[1]}` : null,
        supplierId, positionId: body.positionId, projectName: body.projectName,
        university: body.university, major: body.major, highestEducation: body.highestEducation,
        currentStatus: body.currentStatus, expectedEntryDate: date(body.expectedEntryDate), actualEntryDate: date(body.actualEntryDate),
        source: "APPLICATION", createdBy: req.auth!.name,
      } });
    }
    const application = await tx.candidateApplication.create({ data: {
      applicationNo: `APP-${body.businessLine}-${Date.now()}-${randomBytes(2).toString("hex")}`,
      candidateId: candidate.id, supplierId, businessLine: body.businessLine, positionId: body.positionId,
      projectName: body.projectName, currentStatus: body.currentStatus, resumeResult: body.resumeResult,
      interviewResult: body.interviewResult, expectedEntryDate: date(body.expectedEntryDate), actualEntryDate: date(body.actualEntryDate),
      businessData: body.businessData ? json(body.businessData) : undefined, createdById: req.auth!.id, ownerId,
    } });
    await tx.applicationStatusEvent.create({ data: {
      applicationId: application.id,
      toStatus: application.currentStatus,
      operatorId: req.auth!.id,
      operatorName: req.auth!.name,
      reason: "创建应聘记录",
    } });
    await tx.operationLog.create({ data: { module: "应聘记录", action: "创建应聘记录", candidateId: candidate.id, applicationId: application.id, supplierId, businessLine: body.businessLine, operatorId: req.auth!.id, operator: req.auth!.name } });
    return application;
  });
  return success(res, applicationPayload(req, await prisma.candidateApplication.findUniqueOrThrow({ where: { id: result.id }, include: applicationInclude })), 201);
}));

router.put("/applications/:id", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.CANDIDATE_EDIT);
  const body = applicationBody.partial().omit({ candidateId: true, supplierId: true, businessLine: true }).parse(req.body), scope = scopeFor(req);
  if (body.currentStatus !== undefined || body.interviewResult !== undefined || body.expectedEntryDate !== undefined || body.actualEntryDate !== undefined)
    throw new Error("APPLICATION_ACTION_REQUIRED");
  const existing = await prisma.candidateApplication.findFirst({ where: { id: String(req.params.id), ...applicationScopeWhere(scope) } });
  if (!existing) throw new Error("APPLICATION_NOT_FOUND");
  const updated = await prisma.candidateApplication.update({ where: { id: existing.id }, data: {
    positionId: body.positionId, projectName: body.projectName, currentStatus: body.currentStatus,
    resumeResult: body.resumeResult, interviewResult: body.interviewResult,
    expectedEntryDate: body.expectedEntryDate === undefined ? undefined : date(body.expectedEntryDate),
    actualEntryDate: body.actualEntryDate === undefined ? undefined : date(body.actualEntryDate),
    businessData: body.businessData === undefined ? undefined : body.businessData ? json(body.businessData) : Prisma.JsonNull,
  } });
  await prisma.operationLog.create({ data: { module: "应聘记录", action: "更新应聘记录", candidateId: existing.candidateId, applicationId: existing.id, supplierId: existing.supplierId, businessLine: existing.businessLine, oldValue: json({ currentStatus: existing.currentStatus }), newValue: json({ currentStatus: updated.currentStatus }), operatorId: req.auth!.id, operator: req.auth!.name } });
  return success(res, updated);
}));

router.put("/applications/:id/owner", wrap(async (req, res) => {
  if (req.auth!.role !== UserRole.PLATFORM_ADMIN && !req.auth!.isSupplierManager)
    throw new Error("APPLICATION_OWNER_ASSIGN_FORBIDDEN");
  const body = z.object({ ownerId: z.string().min(1), reason: z.string().trim().min(2) }).parse(req.body);
  const scope = scopeFor(req);
  const application = await prisma.candidateApplication.findFirst({
    where: { id: String(req.params.id), ...applicationScopeWhere(scope) },
  });
  if (!application) throw new Error("APPLICATION_NOT_FOUND");
  const owner = await prisma.user.findFirst({
    where: {
      id: body.ownerId,
      supplierId: application.supplierId,
      status: RecordStatus.ACTIVE,
      businessLines: { has: application.businessLine },
    },
  });
  if (!owner) throw new Error("APPLICATION_OWNER_INVALID");
  await prisma.$transaction([
    prisma.candidateApplication.update({
      where: { id: application.id },
      data: { ownerId: owner.id },
    }),
    prisma.operationLog.create({
      data: {
        module: "应聘记录",
        action: "重新分配负责人",
        candidateId: application.candidateId,
        applicationId: application.id,
        supplierId: application.supplierId,
        businessLine: application.businessLine,
        oldValue: json({ ownerId: application.ownerId }),
        newValue: json({ ownerId: owner.id, ownerName: owner.name }),
        operatorId: req.auth!.id,
        operator: req.auth!.name,
        reason: body.reason,
      },
    }),
  ]);
  const updated = await prisma.candidateApplication.findUniqueOrThrow({
    where: { id: application.id },
    include: applicationInclude,
  });
  return success(res, applicationPayload(req, updated));
}));

router.get("/candidates", wrap(async (req, res) => scopedOrThrow(req, "Candidate", undefined, requested(req), async (scope) => {
  assertPermission(req, FeaturePermission.CANDIDATE_VIEW);
  const { page, pageSize } = pagination(req), appWhere = applicationWhere(req, scope);
  const where: Prisma.CandidateWhereInput = { deletedAt: null, applications: { some: appWhere } };
  if (req.query.keyword) where.name = { contains: String(req.query.keyword), mode: "insensitive" };
  const [rows, total] = await prisma.$transaction([
    prisma.candidate.findMany({ where, select: { id: true, candidateNo: true, name: true, phone: true, phoneMasked: true, email: true, emailMasked: true, university: true, major: true, highestEducation: true, createdAt: true, updatedAt: true, applications: { where: appWhere, include: { supplier: true, position: true, owner: { select: { id: true, name: true } }, interviews: { orderBy: { scheduledStartTime: "desc" }, take: 1 } } } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.candidate.count({ where }),
  ]);
  const contactsVisible = hasPermission(req, FeaturePermission.CANDIDATE_CONTACT_VIEW);
  const compatibleRows = rows.map((row) => { const application = row.applications[0]; return { ...row, phone: contactsVisible ? row.phone : row.phoneMasked, email: contactsVisible ? row.email : row.emailMasked, supplier: application?.supplier || null, position: application?.position || null, owner: application?.owner || null, projectName: application?.projectName || null, currentStatus: application?.currentStatus || "待归类", resumeResult: application?.resumeResult || null, expectedEntryDate: application?.expectedEntryDate || null, actualEntryDate: application?.actualEntryDate || null }; });
  return success(res, { rows: compatibleRows, pagination: { page, pageSize, total }, scope });
})));

router.get("/candidates/:id", wrap(async (req, res) => scopedOrThrow(req, "Candidate", String(req.params.id), requested(req), async (scope) => {
  assertPermission(req, FeaturePermission.CANDIDATE_VIEW);
  const appWhere = applicationScopeWhere(scope);
  const candidate = await prisma.candidate.findFirst({ where: { id: String(req.params.id), deletedAt: null, applications: { some: appWhere } }, select: { id: true, candidateNo: true, name: true, phone: true, phoneMasked: true, email: true, emailMasked: true, university: true, major: true, highestEducation: true, applications: { where: appWhere, include: applicationInclude } } });
  if (!candidate) throw new Error("CANDIDATE_NOT_FOUND");
  const contactsVisible = hasPermission(req, FeaturePermission.CANDIDATE_CONTACT_VIEW);
  return success(res, { ...candidate, phone: contactsVisible ? candidate.phone : candidate.phoneMasked, email: contactsVisible ? candidate.email : candidate.emailMasked, applications: candidate.applications.map((row) => applicationPayload(req, row)) });
})));

router.get("/interviews", wrap(async (req, res) => scopedOrThrow(req, "Interview", undefined, requested(req), async (scope) => {
  assertPermission(req, FeaturePermission.INTERVIEW_VIEW);
  const { page, pageSize } = pagination(req), where: Prisma.InterviewWhereInput = {
    ...(req.auth!.role === UserRole.INTERVIEWER
      ? { interviewerProfileId: req.auth!.interviewerProfileId || "" }
      : { application: applicationScopeWhere(scope) }),
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    ...(req.query.dateFrom || req.query.dateTo ? { scheduledStartTime: { ...(req.query.dateFrom ? { gte: new Date(String(req.query.dateFrom)) } : {}), ...(req.query.dateTo ? { lte: new Date(String(req.query.dateTo)) } : {}) } } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.interview.findMany({ where, include: { candidate: { select: { id: true, name: true } }, application: { include: { supplier: true, position: true } } }, orderBy: { scheduledStartTime: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.interview.count({ where }),
  ]);
  return success(res, { rows, pagination: { page, pageSize, total }, scope });
})));

router.get("/interviews/:id", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.INTERVIEW_VIEW);
  const scope = scopeFor(req), row = await prisma.interview.findFirst({ where: {
    id: String(req.params.id),
    ...(req.auth!.role === UserRole.INTERVIEWER
      ? { interviewerProfileId: req.auth!.interviewerProfileId || "" }
      : { application: applicationScopeWhere(scope) }),
  }, include: { candidate: true, application: { include: { supplier: true, position: true } }, meetingRecords: true } });
  if (!row) throw new Error("INTERVIEW_NOT_FOUND");
  const contactsVisible = hasPermission(req, FeaturePermission.CANDIDATE_CONTACT_VIEW);
  return success(res, {
    ...row,
    candidate: {
      ...row.candidate,
      phone: contactsVisible ? row.candidate.phone : row.candidate.phoneMasked,
      email: contactsVisible ? row.candidate.email : row.candidate.emailMasked,
    },
  });
}));

router.post("/interviews", (_req, _res, next) => next(new Error("INTERVIEW_ACTION_REQUIRED")));

router.post("/interviews/:id/create-meeting", (req, _res, next) => String(req.params.id).startsWith("INT-") ? next("router") : next());
router.post("/interviews/:id/create-meeting", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.INTERVIEW_SCHEDULE);
  const scope = scopeFor(req), interview = await prisma.interview.findFirst({ where: { id: String(req.params.id), application: applicationScopeWhere(scope) }, include: { candidate: true, application: { include: { position: true } } } });
  if (!interview?.applicationId || !interview.application || !interview.supplierId || !interview.businessLine) throw new Error("INTERVIEW_NOT_FOUND");
  const end = interview.scheduledEndTime || new Date(interview.scheduledStartTime.getTime() + 60 * 60_000);
  const meeting = await createTencentMeetingClient().createMeeting({ subject: `【${lineName(interview.businessLine)}面试】${interview.candidate.name}-${interview.application.position?.name || "招聘面试"}`, startTime: interview.scheduledStartTime.toISOString(), endTime: end.toISOString() });
  const [record] = await prisma.$transaction([
    prisma.tencentMeetingRecord.create({ data: { applicationId: interview.applicationId, interviewId: interview.id, supplierId: interview.supplierId, businessLine: interview.businessLine, meetingCode: meeting.meetingCode, meetingUrl: meeting.joinUrl, providerId: meeting.meetingId, status: meeting.status, interviewer: interview.interviewer, scheduledAt: interview.scheduledStartTime } }),
    prisma.interview.update({ where: { id: interview.id }, data: { meetingProvider: "TENCENT", meetingId: meeting.meetingId, meetingUrl: meeting.joinUrl } }),
  ]);
  return success(res, record, 201);
}));

router.put("/interviews/:id", (_req, _res, next) => next(new Error("INTERVIEW_ACTION_REQUIRED")));

async function dashboardCounts(scope: DataScope) {
  const where = applicationScopeWhere(scope);
  const statuses = await prisma.candidateApplication.groupBy({ by: ["currentStatus"], where, _count: { _all: true } });
  const count = (...names: string[]) => statuses.filter((row) => names.includes(row.currentStatus)).reduce((n, row) => n + row._count._all, 0);
  const [total, video, audio, resumePassed, interviewPassed, scheduled] = await prisma.$transaction([
    prisma.candidateApplication.count({ where }),
    prisma.candidateApplication.count({ where: { ...where, businessLine: BusinessLine.VIDEO } }),
    prisma.candidateApplication.count({ where: { ...where, businessLine: BusinessLine.AUDIO } }),
    prisma.candidateApplication.count({ where: { ...where, resumeResult: "通过" } }),
    prisma.candidateApplication.count({ where: { ...where, interviewResult: "通过" } }),
    prisma.candidateApplication.count({ where: { ...where, interviews: { some: {} } } }),
  ]);
  return { total, video, audio, resumePassed, interviewPassed, scheduled, pendingInterview: count("待安排面试", "待面试", "面试待反馈"), pendingEntry: count("待确认入职", "待入职"), joined: count("已入职", "培训中", "项目中"), actualEntry: count("已入职", "培训中", "项目中"), training: count("培训中"), project: count("项目中"), abnormal: count("异常"), abandoned: count("已放弃", "候选人放弃"), left: count("已离职") };
}

router.get("/dashboard/overview", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.CANDIDATE_VIEW);
  const scope = scopeFor(req), metrics = await dashboardCounts(scope);
  return success(res, { ...metrics, candidateTotal: metrics.total, videoCandidates: metrics.video, audioCandidates: metrics.audio, submitted: metrics.total, screened: metrics.resumePassed, passed: metrics.interviewPassed, pending: metrics.pendingEntry });
}));

router.get("/dashboard/funnel", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.CANDIDATE_VIEW);
  const scope = scopeFor(req), metrics = await dashboardCounts(scope);
  const stages = [{ key: "submitted", name: "简历提交", count: metrics.total }, { key: "resumePassed", name: "简历通过", count: metrics.resumePassed }, { key: "scheduled", name: "已安排面试", count: metrics.scheduled }, { key: "interviewPassed", name: "面试通过", count: metrics.interviewPassed }, { key: "pendingEntry", name: "确认入职", count: metrics.pendingEntry + metrics.actualEntry }, { key: "actualEntry", name: "实际入职", count: metrics.actualEntry }];
  return success(res, { submitted: metrics.total, screened: metrics.resumePassed, interviewed: metrics.scheduled, passed: metrics.interviewPassed, pending: metrics.pendingEntry, joined: metrics.actualEntry, stages: stages.map((row, index) => ({ ...row, previousRate: index === 0 || stages[index - 1].count === 0 ? null : row.count / stages[index - 1].count, cumulativeRate: metrics.total === 0 ? null : row.count / metrics.total })) });
}));

async function supplierStats(scope: DataScope) {
  const where = applicationScopeWhere(scope), groups = await prisma.candidateApplication.groupBy({ by: ["supplierId"], where, _count: { _all: true } });
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: groups.map((g) => g.supplierId) } } });
  return Promise.all(groups.map(async (group) => {
    const own = { ...where, supplierId: group.supplierId };
    const [video, audio, passed, joined, abnormal] = await prisma.$transaction([
      prisma.candidateApplication.count({ where: { ...own, businessLine: BusinessLine.VIDEO } }), prisma.candidateApplication.count({ where: { ...own, businessLine: BusinessLine.AUDIO } }), prisma.candidateApplication.count({ where: { ...own, interviewResult: "通过" } }), prisma.candidateApplication.count({ where: { ...own, actualEntryDate: { not: null } } }), prisma.candidateApplication.count({ where: { ...own, currentStatus: "异常" } }),
    ]);
    return { supplierId: group.supplierId, supplier: suppliers.find((s) => s.id === group.supplierId)?.name || "未知供应商", vendor: suppliers.find((s) => s.id === group.supplierId)?.name || "未知供应商", candidates: group._count._all, video, audio, passed, joined, abnormal, totalScore: group._count._all ? Math.round((passed / group._count._all) * 100) : 0, level: passed ? "正常" : "待提升", metrics: { resumeCount: group._count._all, resumePassRate: group._count._all ? Math.round((passed / group._count._all) * 100) : null, offerAcceptanceRate: passed ? Math.round((joined / passed) * 100) : null } };
  }));
}
router.get(["/dashboard/suppliers", "/dashboard/vendors"], wrap(async (req, res) => { assertPermission(req, FeaturePermission.CANDIDATE_VIEW); return success(res, await supplierStats(scopeFor(req))); }));

router.get("/dashboard/trends", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.CANDIDATE_VIEW);
  const scope = scopeFor(req), days = Math.min(30, Math.max(7, Number(req.query.days || 30))), start = new Date(); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - days + 1);
  const rows = await prisma.candidateApplication.findMany({ where: { ...applicationScopeWhere(scope), createdAt: { gte: start } }, select: { createdAt: true, businessLine: true, interviewResult: true, actualEntryDate: true } });
  return success(res, Array.from({ length: days }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); const key = d.toISOString().slice(0, 10), own = rows.filter((r) => r.createdAt.toISOString().slice(0, 10) === key); return { date: key, video: own.filter((r) => r.businessLine === BusinessLine.VIDEO).length, audio: own.filter((r) => r.businessLine === BusinessLine.AUDIO).length, passed: own.filter((r) => r.interviewResult === "通过").length, joined: own.filter((r) => r.actualEntryDate).length }; }));
}));

router.get("/dashboard/duplicate-risks", wrap(async (req, res) => {
  if (req.auth!.role !== UserRole.PLATFORM_ADMIN || req.auth!.simulation)
    throw new Error("WORKFLOW_ACTION_FORBIDDEN");
  const rows = await prisma.$queryRaw<Array<{
    kind: "PHONE" | "EMAIL";
    key: string;
    supplierCount: number;
    candidateCount: number;
    suppliers: string[];
    candidates: string[];
  }>>(Prisma.sql`
    SELECT 'PHONE' AS kind,
           candidate."phoneNormalized" AS key,
           COUNT(DISTINCT candidate."supplierId")::int AS "supplierCount",
           COUNT(*)::int AS "candidateCount",
           ARRAY_AGG(DISTINCT supplier."name") AS suppliers,
           ARRAY_AGG(DISTINCT candidate."name") AS candidates
    FROM "Candidate" candidate
    JOIN "Supplier" supplier ON supplier."id" = candidate."supplierId"
    WHERE candidate."deletedAt" IS NULL AND candidate."phoneNormalized" IS NOT NULL
    GROUP BY candidate."phoneNormalized"
    HAVING COUNT(DISTINCT candidate."supplierId") > 1
    UNION ALL
    SELECT 'EMAIL' AS kind,
           candidate."emailNormalized" AS key,
           COUNT(DISTINCT candidate."supplierId")::int AS "supplierCount",
           COUNT(*)::int AS "candidateCount",
           ARRAY_AGG(DISTINCT supplier."name") AS suppliers,
           ARRAY_AGG(DISTINCT candidate."name") AS candidates
    FROM "Candidate" candidate
    JOIN "Supplier" supplier ON supplier."id" = candidate."supplierId"
    WHERE candidate."deletedAt" IS NULL AND candidate."emailNormalized" IS NOT NULL
    GROUP BY candidate."emailNormalized"
    HAVING COUNT(DISTINCT candidate."supplierId") > 1
    ORDER BY "supplierCount" DESC, "candidateCount" DESC
    LIMIT 100
  `);
  return success(res, { total: rows.length, rows });
}));

router.get("/dashboard/risks", wrap(async (req, res) => { assertPermission(req, FeaturePermission.CANDIDATE_VIEW); const metrics = await dashboardCounts(scopeFor(req)); return success(res, { abnormal: metrics.abnormal, feedback: metrics.pendingInterview, overdue: 0, total: metrics.abnormal + metrics.pendingInterview }); }));
router.get("/dashboard/candidates", wrap(async (req, res) => { assertPermission(req, FeaturePermission.CANDIDATE_VIEW); const scope = scopeFor(req), { page, pageSize } = pagination(req), where = applicationWhere(req, scope); const [rows, total] = await prisma.$transaction([prisma.candidateApplication.findMany({ where, include: applicationInclude, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.candidateApplication.count({ where })]); return success(res, { rows: rows.map((row) => applicationPayload(req, row)), pagination: { page, pageSize, total } }); }));

router.get("/imports", wrap(async (req, res) => { assertPermission(req, FeaturePermission.CANDIDATE_IMPORT); const scope = scopeFor(req); return success(res, await prisma.candidateImportTask.findMany({ where: { ...(scope.supplierId ? { supplierId: scope.supplierId } : {}), ...(scope.ownerId ? { createdById: scope.ownerId } : {}), ...(scope.businessLine ? { businessLine: scope.businessLine } : {}), ...(scope.businessLines ? { businessLine: { in: scope.businessLines } } : {}) }, orderBy: { uploadedAt: "desc" }, take: 100 })); }));

const screeningRules = {
  VIDEO: ["视频内容理解", "Caption经验", "视频标注", "视频评测", "GSB/SBS", "Badcase归因", "镜头语言", "美学理解", "Prompt理解"],
  AUDIO: ["普通话水平", "音频听辨", "ASR标注", "音频转写", "方言能力", "噪声识别", "音频质检", "语音数据处理"],
  UNCLASSIFIED: ["基础经历", "岗位匹配"],
} as const;
router.get("/ai-screening", wrap(async (req, res) => { assertPermission(req, FeaturePermission.SCREENING_SUBMIT); const scope = scopeFor(req); return success(res, await prisma.aIResumeScreeningResult.findMany({ where: { application: applicationScopeWhere(scope) }, include: { application: { include: { candidate: { select: { id: true, name: true, major: true } }, supplier: true, position: true, owner: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 })); }));
router.post("/ai-screening/:applicationId/run", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.SCREENING_SUBMIT);
  const scope = scopeFor(req), application = await prisma.candidateApplication.findFirst({ where: { id: String(req.params.applicationId), ...applicationScopeWhere(scope) }, include: { candidate: true, position: true } });
  if (!application) throw new Error("APPLICATION_NOT_FOUND");
  const text = JSON.stringify({ ...application.businessData as object, position: application.position?.name, major: application.candidate.major });
  const rules = screeningRules[application.businessLine], matched = rules.filter((r) => text.toLowerCase().includes(r.toLowerCase())), missing = rules.filter((r) => !matched.includes(r));
  const score = Math.round((matched.length / rules.length) * 100);
  const result = await prisma.aIResumeScreeningResult.create({ data: { candidateId: application.candidateId, applicationId: application.id, businessLine: application.businessLine, jobId: application.positionId, score, matchedPoints: json(matched), missingPoints: json(missing), riskPoints: json(missing.slice(0, 3)), interviewQuestions: json(missing.slice(0, 5).map((item) => `请举例说明你的${item}经验`)), recommendedLevel: score >= 80 ? "强烈推荐" : score >= 60 ? "建议面试" : "人工复核", confidence: 0.7, promptVersion: `${application.businessLine}-v1` } });
  return success(res, { ...result, note: "AI结果仅供辅助，不会自动淘汰候选人" }, 201);
}));

router.get("/tencent-meeting/records", wrap(async (req, res) => { assertPermission(req, FeaturePermission.INTERVIEW_VIEW); const scope = scopeFor(req); return success(res, await prisma.tencentMeetingRecord.findMany({ where: { ...(req.auth!.role === UserRole.INTERVIEWER ? { interview: { interviewerProfileId: req.auth!.interviewerProfileId || "" } } : { application: applicationScopeWhere(scope) }), ...(req.query.interviewer ? { interviewer: String(req.query.interviewer) } : {}) }, include: { application: { include: { candidate: { select: { id: true, name: true } }, supplier: true } }, interview: true }, orderBy: { scheduledAt: "desc" }, take: 200 })); }));

router.get("/exports/candidates", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.DATA_EXPORT);
  const scope = scopeFor(req), rows = await prisma.candidateApplication.findMany({ where: applicationWhere(req, scope), include: applicationInclude, orderBy: { updatedAt: "desc" }, take: 10_000 });
  const contactsVisible = hasPermission(req, FeaturePermission.CANDIDATE_CONTACT_VIEW);
  const sheet = XLSX.utils.json_to_sheet(rows.map((row) => ({ 业务部门: lineName(row.businessLine), 应聘记录编号: row.applicationNo, 候选人: row.candidate.name, 手机号: contactsVisible ? row.candidate.phone || "—" : row.candidate.phoneMasked || "—", 邮箱: contactsVisible ? row.candidate.email || "—" : row.candidate.emailMasked || "—", 供应商: row.supplier.name, 负责人: row.owner?.name || "—", 岗位: row.position?.name || "—", 当前状态: row.currentStatus, 简历结果: row.resumeResult || "—", 面试结果: row.interviewResult || "—", 预计入职: row.expectedEntryDate?.toISOString().slice(0, 10) || "—", 实际入职: row.actualEntryDate?.toISOString().slice(0, 10) || "—" })));
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "应聘记录");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); res.setHeader("Content-Disposition", `attachment; filename=${scope.businessLine || "combined"}-applications.xlsx`); return res.send(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}));

router.get("/operation-logs", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.CANDIDATE_VIEW);
  const scope = scopeFor(req);
  const ownedApplicationIds = scope.ownerId
    ? (await prisma.candidateApplication.findMany({ where: applicationScopeWhere(scope), select: { id: true } })).map((row) => row.id)
    : null;
  return success(res, await prisma.operationLog.findMany({ where: {
    ...(scope.supplierId ? { supplierId: scope.supplierId } : {}),
    ...(scope.businessLine ? { businessLine: scope.businessLine } : {}),
    ...(scope.businessLines ? { businessLine: { in: scope.businessLines } } : {}),
    ...(ownedApplicationIds ? { applicationId: { in: ownedApplicationIds } } : {}),
  }, orderBy: { operatedAt: "desc" }, take: 200 }));
}));

export default router;
