import { Router, type NextFunction, type Request, type Response } from "express";
import {
  BusinessLine,
  CalendarBlockType,
  CalendarRecurrence,
  FeaturePermission,
  RecordStatus,
  UserRole,
} from "@prisma/client";
import { z } from "zod";
import {
  assertPermission,
  hashPassword,
  hasPermission,
  isSupplierUser,
} from "./auth.js";
import { prisma } from "./database.js";
import {
  enumerateShanghaiDates,
  fixedBreakEvents,
  shanghaiDateAt,
  shanghaiParts,
} from "./interviewerCalendarService.js";

const router = Router();
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
const success = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data, requestId: res.locals.requestId });
const isPlatformAdmin = (req: Request) => req.auth?.role === UserRole.PLATFORM_ADMIN;
const isInternal = (req: Request) =>
  Boolean(
    req.auth &&
      !req.auth.simulation &&
      !isSupplierUser(req) &&
      req.auth.role !== UserRole.INTERVIEWER,
  );

function assertCalendarView(req: Request) {
  if (req.auth?.role === UserRole.INTERVIEWER || isInternal(req)) return;
  assertPermission(req, FeaturePermission.INTERVIEW_VIEW);
}

function assertPlatformAdmin(req: Request) {
  if (!isPlatformAdmin(req)) throw new Error("WORKFLOW_ACTION_FORBIDDEN");
}

const minuteSchema = z.number().int().min(0).max(24 * 60);
const interviewerBusinessLineSchema = z.enum([BusinessLine.VIDEO, BusinessLine.AUDIO]);
const profileBody = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
  department: z.string().trim().max(100).optional().nullable(),
  kimUserId: z.string().trim().min(1).max(200).optional().nullable(),
  businessLines: z.array(interviewerBusinessLineSchema).min(1).max(2),
  positionIds: z.array(z.string()).default([]),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  workStartMinute: minuteSchema.default(540),
  workEndMinute: minuteSchema.default(1260),
});

router.get("/calendar/interviewers", wrap(async (req, res) => {
  assertCalendarView(req);
  const requestedLine = req.query.businessLine
    ? interviewerBusinessLineSchema.parse(String(req.query.businessLine).toUpperCase())
    : undefined;
  const allowedLines = req.auth!.simulation?.businessLines.length
    ? req.auth!.simulation.businessLines
    : req.auth!.businessLines;
  if (requestedLine && allowedLines.length && !allowedLines.includes(requestedLine))
    throw new Error("BUSINESS_LINE_CAP_EXCEEDED");
  const profiles = await prisma.interviewerProfile.findMany({
    where: {
      status: RecordStatus.ACTIVE,
      ...(req.auth!.role === UserRole.INTERVIEWER
        ? { id: req.auth!.interviewerProfileId || "" }
        : {}),
      ...(requestedLine ? { businessLines: { has: requestedLine } } : {}),
      ...(!isInternal(req) && allowedLines.length && !requestedLine
        ? { businessLines: { hasSome: allowedLines } }
        : {}),
    },
    include: { user: { select: { id: true, name: true, email: true, kimUserId: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return success(res, profiles.map((profile) => ({
    ...profile,
    user: isPlatformAdmin(req) && !req.auth!.simulation
      ? profile.user
      : { id: profile.user.id, name: profile.user.name },
  })));
}));

router.post("/calendar/interviewers", wrap(async (req, res) => {
  assertPlatformAdmin(req);
  const body = profileBody.parse(req.body);
  if (body.workEndMinute <= body.workStartMinute) throw new Error("INTERVIEWER_WORKING_TIME_INVALID");
  const profile = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: body.email.toLowerCase(),
        name: body.name,
        passwordHash: hashPassword(body.password),
        role: UserRole.INTERVIEWER,
        permissions: [
          FeaturePermission.INTERVIEW_VIEW,
          FeaturePermission.FEEDBACK_VIEW,
          FeaturePermission.FEEDBACK_SUBMIT,
        ],
        businessLines: body.businessLines,
        kimUserId: body.kimUserId,
      },
    });
    const created = await tx.interviewerProfile.create({
      data: {
        userId: user.id,
        department: body.department,
        businessLines: body.businessLines,
        positionIds: body.positionIds,
        workingDays: [...new Set(body.workingDays)],
        workStartMinute: body.workStartMinute,
        workEndMinute: body.workEndMinute,
      },
      include: { user: true },
    });
    await tx.auditLog.create({
      data: {
        userId: req.auth!.id,
        action: "INTERVIEWER_CREATED",
        resourceType: "InterviewerProfile",
        resourceId: created.id,
        effectiveScope: {
          businessLines: body.businessLines,
          workingDays: body.workingDays,
          workStartMinute: body.workStartMinute,
          workEndMinute: body.workEndMinute,
        },
        result: "SUCCESS",
        requestId: String(res.locals.requestId || ""),
      },
    });
    return created;
  });
  return success(res, profile, 201);
}));

router.put("/calendar/interviewers/:id", wrap(async (req, res) => {
  assertPlatformAdmin(req);
  const body = profileBody
    .omit({ email: true, password: true })
    .extend({
      password: z.string().min(8).max(200).optional(),
      status: z.nativeEnum(RecordStatus).optional(),
    })
    .partial()
    .parse(req.body);
  const profile = await prisma.interviewerProfile.findUnique({
    where: { id: String(req.params.id) },
    include: { user: true },
  });
  if (!profile) throw new Error("INTERVIEWER_NOT_FOUND");
  const workStartMinute = body.workStartMinute ?? profile.workStartMinute;
  const workEndMinute = body.workEndMinute ?? profile.workEndMinute;
  if (workEndMinute <= workStartMinute) throw new Error("INTERVIEWER_WORKING_TIME_INVALID");
  const updated = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: profile.userId },
      data: {
        name: body.name,
        passwordHash: body.password ? hashPassword(body.password) : undefined,
        kimUserId: body.kimUserId,
        businessLines: body.businessLines,
        status: body.status,
      },
    });
    if (body.password || body.status === RecordStatus.INACTIVE)
      await tx.authSession.deleteMany({ where: { userId: profile.userId } });
    const row = await tx.interviewerProfile.update({
      where: { id: profile.id },
      data: {
        department: body.department,
        businessLines: body.businessLines,
        positionIds: body.positionIds,
        workingDays: body.workingDays ? [...new Set(body.workingDays)] : undefined,
        workStartMinute: body.workStartMinute,
        workEndMinute: body.workEndMinute,
        status: body.status,
      },
      include: { user: true },
    });
    await tx.auditLog.create({
      data: {
        userId: req.auth!.id,
        action: "INTERVIEWER_UPDATED",
        resourceType: "InterviewerProfile",
        resourceId: profile.id,
        requestedScope: JSON.parse(JSON.stringify(body)),
        result: "SUCCESS",
        requestId: String(res.locals.requestId || ""),
      },
    });
    return row;
  });
  return success(res, updated);
}));

const blockBody = z.discriminatedUnion("recurrence", [
  z.object({
    recurrence: z.literal(CalendarRecurrence.SINGLE),
    type: z.nativeEnum(CalendarBlockType),
    title: z.string().trim().min(1).max(100),
    reason: z.string().trim().max(500).optional().nullable(),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
  }),
  z.object({
    recurrence: z.literal(CalendarRecurrence.WEEKLY),
    type: z.nativeEnum(CalendarBlockType),
    title: z.string().trim().min(1).max(100),
    reason: z.string().trim().max(500).optional().nullable(),
    weekday: z.number().int().min(0).max(6),
    startMinute: minuteSchema,
    endMinute: minuteSchema,
    effectiveFrom: z.string().datetime({ offset: true }).optional().nullable(),
    effectiveTo: z.string().datetime({ offset: true }).optional().nullable(),
  }),
]);

router.get("/calendar/interviewers/:id/blocks", wrap(async (req, res) => {
  assertCalendarView(req);
  const interviewerId = String(req.params.id);
  if (
    req.auth!.role === UserRole.INTERVIEWER &&
    req.auth!.interviewerProfileId !== interviewerId
  )
    throw new Error("INTERVIEWER_SCOPE_FORBIDDEN");
  const rows = await prisma.interviewerCalendarBlock.findMany({
    where: { interviewerId, status: RecordStatus.ACTIVE },
    orderBy: [{ startAt: "asc" }, { weekday: "asc" }, { startMinute: "asc" }],
  });
  const detailsVisible = isInternal(req) || req.auth!.interviewerProfileId === interviewerId;
  return success(res, detailsVisible ? rows : rows.map((row) => ({
    ...row,
    title: "不可预约",
    reason: null,
    createdById: undefined,
    createdByName: undefined,
  })));
}));

router.post("/calendar/interviewers/:id/blocks", wrap(async (req, res) => {
  assertPlatformAdmin(req);
  const interviewerId = String(req.params.id);
  const profile = await prisma.interviewerProfile.findUnique({ where: { id: interviewerId } });
  if (!profile) throw new Error("INTERVIEWER_NOT_FOUND");
  const body = blockBody.parse(req.body);
  if (body.recurrence === CalendarRecurrence.SINGLE) {
    if (new Date(body.endAt) <= new Date(body.startAt)) throw new Error("CALENDAR_BLOCK_TIME_INVALID");
  } else if (body.endMinute <= body.startMinute) throw new Error("CALENDAR_BLOCK_TIME_INVALID");
  const block = await prisma.$transaction(async (tx) => {
    const row = await tx.interviewerCalendarBlock.create({
      data:
        body.recurrence === CalendarRecurrence.SINGLE
          ? {
              interviewerId,
              recurrence: body.recurrence,
              type: body.type,
              title: body.title,
              reason: body.reason,
              startAt: new Date(body.startAt),
              endAt: new Date(body.endAt),
              createdById: req.auth!.id,
              createdByName: req.auth!.name,
            }
          : {
              interviewerId,
              recurrence: body.recurrence,
              type: body.type,
              title: body.title,
              reason: body.reason,
              weekday: body.weekday,
              startMinute: body.startMinute,
              endMinute: body.endMinute,
              effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : null,
              effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
              createdById: req.auth!.id,
              createdByName: req.auth!.name,
            },
    });
    await tx.auditLog.create({
      data: {
        userId: req.auth!.id,
        action: "INTERVIEWER_BLOCK_CREATED",
        resourceType: "InterviewerCalendarBlock",
        resourceId: row.id,
        requestedScope: JSON.parse(JSON.stringify(body)),
        result: "SUCCESS",
        requestId: String(res.locals.requestId || ""),
      },
    });
    return row;
  });
  return success(res, block, 201);
}));

router.put("/calendar/blocks/:id", wrap(async (req, res) => {
  assertPlatformAdmin(req);
  const existing = await prisma.interviewerCalendarBlock.findUnique({
    where: { id: String(req.params.id) },
  });
  if (!existing) throw new Error("CALENDAR_BLOCK_NOT_FOUND");
  const body = blockBody.parse(req.body);
  if (body.recurrence === CalendarRecurrence.SINGLE) {
    if (new Date(body.endAt) <= new Date(body.startAt)) throw new Error("CALENDAR_BLOCK_TIME_INVALID");
  } else if (body.endMinute <= body.startMinute) throw new Error("CALENDAR_BLOCK_TIME_INVALID");
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.interviewerCalendarBlock.update({
      where: { id: existing.id },
      data: body.recurrence === CalendarRecurrence.SINGLE
        ? {
            recurrence: body.recurrence,
            type: body.type,
            title: body.title,
            reason: body.reason,
            startAt: new Date(body.startAt),
            endAt: new Date(body.endAt),
            weekday: null,
            startMinute: null,
            endMinute: null,
            effectiveFrom: null,
            effectiveTo: null,
          }
        : {
            recurrence: body.recurrence,
            type: body.type,
            title: body.title,
            reason: body.reason,
            startAt: null,
            endAt: null,
            weekday: body.weekday,
            startMinute: body.startMinute,
            endMinute: body.endMinute,
            effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : null,
            effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
          },
    });
    await tx.auditLog.create({
      data: {
        userId: req.auth!.id,
        action: "INTERVIEWER_BLOCK_UPDATED",
        resourceType: "InterviewerCalendarBlock",
        resourceId: row.id,
        requestedScope: JSON.parse(JSON.stringify(body)),
        result: "SUCCESS",
        requestId: String(res.locals.requestId || ""),
      },
    });
    return row;
  });
  return success(res, updated);
}));

router.delete("/calendar/blocks/:id", wrap(async (req, res) => {
  assertPlatformAdmin(req);
  const block = await prisma.interviewerCalendarBlock.findUnique({
    where: { id: String(req.params.id) },
  });
  if (!block) throw new Error("CALENDAR_BLOCK_NOT_FOUND");
  await prisma.$transaction([
    prisma.interviewerCalendarBlock.update({
      where: { id: block.id },
      data: { status: RecordStatus.INACTIVE },
    }),
    prisma.auditLog.create({
      data: {
        userId: req.auth!.id,
        action: "INTERVIEWER_BLOCK_CANCELLED",
        resourceType: "InterviewerCalendarBlock",
        resourceId: block.id,
        result: "SUCCESS",
        requestId: String(res.locals.requestId || ""),
      },
    }),
  ]);
  return success(res, { id: block.id, cancelled: true });
}));

function fullInterviewDetailsVisible(req: Request, interview: any) {
  if (isInternal(req)) return true;
  if (req.auth!.role === UserRole.INTERVIEWER)
    return interview.interviewerProfileId === req.auth!.interviewerProfileId;
  const supplierId = req.auth!.simulation?.supplierId || req.auth!.supplierId;
  if (interview.application?.supplierId !== supplierId) return false;
  if (req.auth!.simulation || req.auth!.isSupplierManager) return true;
  return interview.application?.ownerId === req.auth!.id;
}

router.get("/calendar/board", wrap(async (req, res) => {
  assertCalendarView(req);
  const from = new Date(String(req.query.from || ""));
  const to = new Date(String(req.query.to || ""));
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from)
    throw new Error("CALENDAR_RANGE_INVALID");
  if (to.getTime() - from.getTime() > 14 * 24 * 60 * 60_000)
    throw new Error("CALENDAR_RANGE_TOO_LARGE");
  const requestedLine = req.query.businessLine
    ? interviewerBusinessLineSchema.parse(String(req.query.businessLine).toUpperCase())
    : undefined;
  const selectedIds = req.query.interviewerIds
    ? String(req.query.interviewerIds).split(",").filter(Boolean)
    : [];
  const allowedLines = req.auth!.simulation?.businessLines.length
    ? req.auth!.simulation.businessLines
    : req.auth!.businessLines;
  if (requestedLine && allowedLines.length && !allowedLines.includes(requestedLine))
    throw new Error("BUSINESS_LINE_CAP_EXCEEDED");
  const profiles = await prisma.interviewerProfile.findMany({
    where: {
      status: RecordStatus.ACTIVE,
      ...(req.auth!.role === UserRole.INTERVIEWER
        ? { id: req.auth!.interviewerProfileId || "" }
        : selectedIds.length
          ? { id: { in: selectedIds } }
          : {}),
      ...(requestedLine ? { businessLines: { has: requestedLine } } : {}),
      ...(!isInternal(req) && allowedLines.length && !requestedLine
        ? { businessLines: { hasSome: allowedLines } }
        : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      calendarBlocks: { where: { status: RecordStatus.ACTIVE } },
    },
    orderBy: { user: { name: "asc" } },
  });
  const profileIds = profiles.map((profile) => profile.id);
  const interviews = await prisma.interview.findMany({
    where: {
      interviewerProfileId: { in: profileIds },
      status: { notIn: ["已取消", "取消", "候选人拒绝"] },
      scheduledStartTime: { lt: to },
      OR: [
        { scheduledEndTime: { gt: from } },
        { scheduledEndTime: null, scheduledStartTime: { gte: from } },
      ],
    },
    include: {
      application: {
        include: {
          candidate: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          position: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { scheduledStartTime: "asc" },
  });
  const dates = enumerateShanghaiDates(from, to);
  const events: any[] = [];
  for (const profile of profiles) {
    events.push(...fixedBreakEvents(profile.id, dates, profile.workingDays));
    for (const block of profile.calendarBlocks) {
      const detailsVisible = isInternal(req) || req.auth!.interviewerProfileId === profile.id;
      if (block.recurrence === CalendarRecurrence.SINGLE && block.startAt && block.endAt) {
        if (block.startAt < to && block.endAt > from)
          events.push({
            id: block.id,
            interviewerId: profile.id,
            kind: "UNAVAILABLE",
            title: detailsVisible ? block.title : "不可预约",
            reason: detailsVisible ? block.reason : undefined,
            start: block.startAt.toISOString(),
            end: block.endAt.toISOString(),
            occupied: true,
            detailsVisible,
          });
      } else if (
        block.recurrence === CalendarRecurrence.WEEKLY &&
        block.weekday !== null &&
        block.startMinute !== null &&
        block.endMinute !== null
      ) {
        for (const dateKey of dates) {
          const day = shanghaiDateAt(dateKey, 0);
          if (shanghaiParts(day).weekday !== block.weekday) continue;
          if (block.effectiveFrom && block.effectiveFrom >= shanghaiDateAt(dateKey, 24 * 60)) continue;
          if (block.effectiveTo && block.effectiveTo < day) continue;
          events.push({
            id: `${block.id}-${dateKey}`,
            sourceId: block.id,
            interviewerId: profile.id,
            kind: "UNAVAILABLE",
            title: detailsVisible ? block.title : "不可预约",
            reason: detailsVisible ? block.reason : undefined,
            start: shanghaiDateAt(dateKey, block.startMinute).toISOString(),
            end: shanghaiDateAt(dateKey, block.endMinute).toISOString(),
            occupied: true,
            detailsVisible,
          });
        }
      }
    }
  }
  for (const interview of interviews) {
    const detailsVisible = fullInterviewDetailsVisible(req, interview);
    events.push({
      id: interview.id,
      interviewerId: interview.interviewerProfileId,
      kind: "INTERVIEW",
      title: detailsVisible
        ? `${interview.application?.candidate.name || "候选人"} · ${interview.roundName || `第${interview.round}轮`}`
        : "已占用",
      start: interview.scheduledStartTime.toISOString(),
      end: (interview.scheduledEndTime || new Date(interview.scheduledStartTime.getTime() + 30 * 60_000)).toISOString(),
      occupied: true,
      detailsVisible,
      ...(detailsVisible
        ? {
            status: interview.status,
            applicationId: interview.applicationId,
            supplierName: interview.application?.supplier.name,
            candidateName: interview.application?.candidate.name,
            positionName: interview.application?.position?.name,
            ownerName: interview.application?.owner?.name,
            roundName: interview.roundName,
          }
        : {}),
    });
  }
  return success(res, {
    timezone: "Asia/Shanghai",
    dates,
    profiles: profiles.map(({ calendarBlocks: _blocks, ...profile }) => ({
      ...profile,
      user: isPlatformAdmin(req) && !req.auth!.simulation
        ? profile.user
        : { id: profile.user.id, name: profile.user.name },
    })),
    events,
  });
}));

router.get("/notifications", wrap(async (req, res) => {
  const rows = await prisma.siteNotification.findMany({
    where: { userId: req.auth!.id },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, Number(req.query.limit || 30))),
  });
  const unread = await prisma.siteNotification.count({
    where: { userId: req.auth!.id, readAt: null },
  });
  return success(res, { rows, unread });
}));

router.put("/notifications/:id/read", wrap(async (req, res) => {
  const updated = await prisma.siteNotification.updateMany({
    where: { id: String(req.params.id), userId: req.auth!.id, readAt: null },
    data: { readAt: new Date() },
  });
  if (!updated.count) throw new Error("NOTIFICATION_NOT_FOUND");
  return success(res, { id: req.params.id, read: true });
}));

router.post("/notifications/read-all", wrap(async (req, res) => {
  const updated = await prisma.siteNotification.updateMany({
    where: { userId: req.auth!.id, readAt: null },
    data: { readAt: new Date() },
  });
  return success(res, { updated: updated.count });
}));

export default router;
