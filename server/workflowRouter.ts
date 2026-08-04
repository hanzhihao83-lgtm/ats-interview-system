import { Router, type NextFunction, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import {
  BusinessLine,
  FeaturePermission,
  InterviewFeedbackStatus,
  LevelAdjustmentStatus,
  OfferStatus,
  OnboardingResult,
  Prisma,
  ReceptionTaskStatus,
  SchedulingRequestStatus,
  UserRole,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "./database.js";
import { buildDataScope, applicationScopeWhere, parseBusinessLine, type DataScope } from "./dataScopeService.js";
import { createTencentMeetingClient } from "./tencentMeetingClient.js";
import { assertPermission, hasPermission } from "./auth.js";
import { assertInterviewerAvailable } from "./interviewerCalendarService.js";
// @ts-ignore JS 适配器在 Node 运行时加载
import { createKimClient } from "./kimClient.mjs";
import {
  assertFeedbackComplete,
  assertWorkflowTransition,
  feedbackTemplateConfig,
  feedbackDueAt,
} from "./workflowService.js";

const router = Router();
const meetingClient = createTencentMeetingClient();
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
const success = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data, requestId: res.locals.requestId });
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? null));
const actor = (req: Request) => ({ id: req.auth!.id, name: req.auth!.name });
const selfSchedulingEnabled = () =>
  String(process.env.CANDIDATE_SELF_SCHEDULING_ENABLED || "false").toLowerCase() === "true";
const assertSelfSchedulingEnabled = () => {
  if (!selfSchedulingEnabled()) throw new Error("SCHEDULING_FEATURE_DISABLED");
};
const requestedLine = (req: Request) => parseBusinessLine(req.query.businessLine);
const scopeFor = (req: Request): DataScope =>
  buildDataScope(
    req.auth!,
    req.query.supplierId ? String(req.query.supplierId) : undefined,
    requestedLine(req),
  );
const internalDecisionRoles = new Set<UserRole>([
  UserRole.PLATFORM_ADMIN,
  UserRole.DEPARTMENT_MANAGER,
  UserRole.INTERNAL_RECRUITER,
  UserRole.VIDEO_RECRUITER,
  UserRole.AUDIO_RECRUITER,
]);
const managerRoles = new Set<UserRole>([UserRole.PLATFORM_ADMIN, UserRole.DEPARTMENT_MANAGER]);
const assertInternalDecisionRole = (req: Request) => {
  if (!internalDecisionRoles.has(req.auth!.role)) throw new Error("WORKFLOW_ACTION_FORBIDDEN");
};
const assertManagerRole = (req: Request) => {
  if (!managerRoles.has(req.auth!.role)) throw new Error("WORKFLOW_ACTION_FORBIDDEN");
};

const workflowInclude = {
  candidate: {
    select: {
      id: true,
      candidateNo: true,
      name: true,
      phone: true,
      email: true,
      phoneMasked: true,
      emailMasked: true,
    },
  },
  supplier: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, name: true, feedbackTemplate: true } },
  interviews: {
    orderBy: { scheduledStartTime: "asc" as const },
    include: { feedbackRecord: true, meetingRecords: true },
  },
  statusEvents: { orderBy: { occurredAt: "asc" as const } },
  conclusion: true,
  offers: { orderBy: { createdAt: "desc" as const } },
  levelAdjustments: { orderBy: { createdAt: "desc" as const } },
  onboarding: true,
  receptionTask: { include: { checklist: { orderBy: { sortOrder: "asc" as const } } } },
  schedulingRequests: { orderBy: { createdAt: "desc" as const }, take: 5 },
  screeningResults: { orderBy: { createdAt: "desc" as const }, take: 10 },
  owner: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CandidateApplicationInclude;

async function findApplication(req: Request, id: string) {
  const scope = scopeFor(req);
  const application = await prisma.candidateApplication.findFirst({
    where: {
      id,
      ...(req.auth!.role === UserRole.INTERVIEWER
        ? { interviews: { some: { interviewerProfileId: req.auth!.interviewerProfileId || "" } } }
        : applicationScopeWhere(scope)),
    },
    include: workflowInclude,
  });
  if (!application) throw new Error("APPLICATION_NOT_FOUND");
  return application;
}

function workflowPayload(req: Request, application: Awaited<ReturnType<typeof findApplication>>) {
  const contactsVisible = hasPermission(req, FeaturePermission.CANDIDATE_CONTACT_VIEW);
  const interviewsVisible =
    hasPermission(req, FeaturePermission.INTERVIEW_VIEW) ||
    hasPermission(req, FeaturePermission.INTERVIEW_SCHEDULE);
  const feedbackVisible = hasPermission(req, FeaturePermission.FEEDBACK_VIEW);
  const interviewerOnly = req.auth!.role === UserRole.INTERVIEWER;
  return {
    ...application,
    candidate: {
      ...application.candidate,
      phone: contactsVisible ? application.candidate.phone : application.candidate.phoneMasked,
      email: contactsVisible ? application.candidate.email : application.candidate.emailMasked,
    },
    interviews: interviewsVisible
      ? application.interviews
        .filter((interview) => !interviewerOnly || interview.interviewerProfileId === req.auth!.interviewerProfileId)
        .map((interview) => ({
          ...interview,
          feedbackRecord: feedbackVisible ? interview.feedbackRecord : undefined,
        }))
      : [],
    conclusion: !interviewerOnly && feedbackVisible ? application.conclusion : undefined,
    offers: interviewerOnly ? [] : application.offers,
    levelAdjustments: interviewerOnly ? [] : application.levelAdjustments,
    onboarding: interviewerOnly ? undefined : application.onboarding,
    owner: interviewerOnly ? undefined : application.owner,
    businessData: interviewerOnly ? undefined : application.businessData,
    screeningResults: interviewerOnly ? [] : application.screeningResults,
    receptionTask: hasPermission(req, FeaturePermission.RECEPTION_VIEW)
      ? application.receptionTask
      : undefined,
  };
}

async function transitionApplication(
  tx: Prisma.TransactionClient,
  application: { id: string; candidateId: string; supplierId: string; businessLine: BusinessLine; currentStatus: string },
  targetStatus: string,
  req: Request,
  reason: string,
) {
  return transitionApplicationAs(tx, application, targetStatus, actor(req), reason);
}

async function transitionApplicationAs(
  tx: Prisma.TransactionClient,
  application: { id: string; candidateId: string; supplierId: string; businessLine: BusinessLine; currentStatus: string },
  targetStatus: string,
  currentActor: { id: string; name: string },
  reason: string,
) {
  assertWorkflowTransition(application.currentStatus, targetStatus);
  if (application.currentStatus === targetStatus) return application.currentStatus;
  const updated = await tx.candidateApplication.updateMany({
    where: { id: application.id, currentStatus: application.currentStatus },
    data: { currentStatus: targetStatus },
  });
  if (updated.count !== 1) throw new Error("APPLICATION_STATUS_TRANSITION_INVALID");
  await tx.applicationStatusEvent.create({ data: {
    applicationId: application.id,
    fromStatus: application.currentStatus,
    toStatus: targetStatus,
    operatorId: currentActor.id,
    operatorName: currentActor.name,
    reason,
  }});
  await tx.operationLog.create({ data: {
    module: "招聘流程",
    action: "变更应聘状态",
    candidateId: application.candidateId,
    applicationId: application.id,
    supplierId: application.supplierId,
    businessLine: application.businessLine,
    oldValue: json({ currentStatus: application.currentStatus }),
    newValue: json({ currentStatus: targetStatus }),
    operatorId: currentActor.id,
    operator: currentActor.name,
    reason,
  }});
  return targetStatus;
}

router.get("/workflow/applications/:id", wrap(async (req, res) =>
  (req.auth!.role === UserRole.INTERVIEWER || assertPermission(req, FeaturePermission.CANDIDATE_VIEW),
  success(res, workflowPayload(req, await findApplication(req, String(req.params.id))))),
));

router.post("/applications/:id/actions/transition", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.SCREENING_SUBMIT);
  const body = z.object({ targetStatus: z.string().min(1), reason: z.string().trim().min(2) }).parse(req.body);
  const application = await findApplication(req, String(req.params.id));
  const isScreeningDecision = application.currentStatus === "简历待筛选"
    && ["待安排面试", "简历未通过"].includes(body.targetStatus);
  if (!isScreeningDecision) throw new Error("APPLICATION_ACTION_REQUIRED");
  await prisma.$transaction(async (tx) => {
    await transitionApplication(tx, application, body.targetStatus, req, body.reason);
    await tx.candidateApplication.update({
      where: { id: application.id },
      data: { resumeResult: body.targetStatus === "待安排面试" ? "通过" : "不通过" },
    });
  });
  return success(res, workflowPayload(req, await findApplication(req, application.id)));
}));

const scheduleBody = z.object({
  scheduledStartTime: z.string().datetime({ offset: true }),
  scheduledEndTime: z.string().datetime({ offset: true }),
  round: z.number().int().positive().default(1),
  roundName: z.string().trim().min(1).default("第一轮"),
  interviewerId: z.string().trim().min(1),
});

async function createInterviewNotifications(
  tx: Prisma.TransactionClient,
  input: {
    type: "INTERVIEW_CREATED" | "INTERVIEW_RESCHEDULED" | "INTERVIEW_CANCELLED";
    title: string;
    content: string;
    application: { id: string; ownerId: string | null; supplierId: string; businessLine: BusinessLine };
    interviewId: string;
    interviewerUserId: string;
    idempotencySuffix?: string;
  },
) {
  const notificationKey = `${input.type}-${input.interviewId}${input.idempotencySuffix ? `-${input.idempotencySuffix}` : ""}`;
  const recipients = [...new Set([input.application.ownerId, input.interviewerUserId].filter(Boolean))] as string[];
  for (const userId of recipients)
    await tx.siteNotification.upsert({
      where: { idempotencyKey: `${notificationKey}-${userId}` },
      update: {},
      create: {
        userId,
        type: input.type,
        title: input.title,
        content: input.content,
        applicationId: input.application.id,
        interviewId: input.interviewId,
        idempotencyKey: `${notificationKey}-${userId}`,
      },
    });
  await tx.kimNotificationLog.upsert({
    where: { idempotencyKey: `${notificationKey}-kim` },
    update: {},
    create: {
      applicationId: input.application.id,
      interviewId: input.interviewId,
      supplierId: input.application.supplierId,
      businessLine: input.application.businessLine,
      recipientUserId: input.interviewerUserId,
      status: "PENDING",
      messageSummary: input.content,
      idempotencyKey: `${notificationKey}-kim`,
    },
  });
}

async function sendInterviewerKim(kimUserId: string | null, title: string, content: string) {
  const result = await createKimClient().sendMessage(
    {},
    {
      type: "markdown",
      title,
      content: `${kimUserId ? `@${kimUserId} ` : ""}${content}`,
    },
  );
  return result;
}

async function interviewHasConflict(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
  interviewer: string,
  start: Date,
  end: Date,
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Interview"
    WHERE "interviewer" = ${interviewer}
      AND "status" NOT IN ('已取消', '取消')
      AND "scheduledStartTime" < (${new Date(end.getTime() + 10 * 60_000)}::timestamptz AT TIME ZONE 'UTC')
      AND COALESCE("scheduledEndTime", "scheduledStartTime" + INTERVAL '60 minutes') > (${new Date(start.getTime() - 10 * 60_000)}::timestamptz AT TIME ZONE 'UTC')
    LIMIT 1
  `);
  return rows.length > 0;
}

async function lockAndAssertInterviewAvailable(
  tx: Prisma.TransactionClient,
  interviewer: string,
  start: Date,
  end: Date,
) {
  await tx.$queryRaw(Prisma.sql`SELECT true AS "locked" FROM pg_advisory_xact_lock(hashtext(${interviewer}))`);
  if (await interviewHasConflict(tx, interviewer, start, end))
    throw new Error("INTERVIEW_TIME_CONFLICT");
}

router.post("/applications/:id/interviews", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.INTERVIEW_SCHEDULE);
  const body = scheduleBody.parse(req.body);
  const application = await findApplication(req, String(req.params.id));
  if (!["待安排面试", "待面试", "面试待反馈"].includes(application.currentStatus))
    throw new Error("INTERVIEW_SCHEDULE_STATUS_INVALID");
  const start = new Date(body.scheduledStartTime), end = new Date(body.scheduledEndTime);
  if (end <= start) throw new Error("INTERVIEW_TIME_INVALID");
  if (start <= new Date()) throw new Error("INTERVIEW_TIME_PAST");

  const interviewerProfile = await prisma.interviewerProfile.findUnique({
    where: { id: body.interviewerId },
    include: { user: { select: { id: true, name: true, kimUserId: true } } },
  });
  if (!interviewerProfile) throw new Error("INTERVIEWER_NOT_FOUND");

  const currentActor = actor(req);
  const interview = await prisma.$transaction(async (tx) => {
    await assertInterviewerAvailable(tx, interviewerProfile, start, end, {
      businessLine: application.businessLine,
      positionId: application.positionId,
    });
    const created = await tx.interview.create({ data: {
      applicationId: application.id,
      candidateId: application.candidateId,
      supplierId: application.supplierId,
      businessLine: application.businessLine,
      scheduledStartTime: start,
      scheduledEndTime: end,
      feedbackDueAt: feedbackDueAt(end),
      round: body.round,
      roundName: body.roundName,
      interviewer: interviewerProfile.user.name,
      interviewerProfileId: interviewerProfile.id,
      status: "待面试",
    }});
    if (["待安排面试", "面试待反馈"].includes(application.currentStatus))
      await transitionApplication(tx, application, "待面试", req, `已安排${body.roundName}`);
    await createInterviewNotifications(tx, {
      type: "INTERVIEW_CREATED",
      title: "面试安排通知",
      content: `【面试安排】${application.candidate.name} ${body.roundName} ${start.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}，面试官：${interviewerProfile.user.name}`,
      application,
      interviewId: created.id,
      interviewerUserId: interviewerProfile.user.id,
    });
    await tx.operationLog.create({ data: {
      module: "面试",
      action: "安排面试",
      candidateId: application.candidateId,
      applicationId: application.id,
      supplierId: application.supplierId,
      businessLine: application.businessLine,
      newValue: json({ start, end, interviewerId: interviewerProfile.id, interviewer: interviewerProfile.user.name, round: body.round }),
      operatorId: currentActor.id,
      operator: currentActor.name,
    }});
    return created;
  });

  let meeting: unknown = null;
  try {
    const createdMeeting = await meetingClient.createMeeting({
      subject: `招聘面试｜${application.candidate.name}｜${application.position?.name || "招聘岗位"}｜${body.roundName}`,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });
    meeting = await prisma.$transaction(async (tx) => {
      const record = await tx.tencentMeetingRecord.create({ data: {
        applicationId: application.id,
        interviewId: interview.id,
        supplierId: application.supplierId,
        businessLine: application.businessLine,
        meetingCode: createdMeeting.meetingCode,
        meetingUrl: createdMeeting.joinUrl,
        providerId: createdMeeting.meetingId,
        status: createdMeeting.status,
        interviewer: interviewerProfile.user.name,
        scheduledAt: start,
      }});
      await tx.interview.update({ where: { id: interview.id }, data: {
        meetingProvider: "TENCENT",
        meetingId: createdMeeting.meetingId,
        meetingUrl: createdMeeting.joinUrl,
      }});
      return record;
    });
  } catch {
    await prisma.interview.update({ where: { id: interview.id }, data: { status: "会议创建失败" } });
  }
  const kimResult = await sendInterviewerKim(
    interviewerProfile.user.kimUserId,
    "面试安排通知",
    `${application.candidate.name} ${body.roundName}，时间：${start.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
  );
  await prisma.kimNotificationLog.updateMany({
    where: { idempotencyKey: `INTERVIEW_CREATED-${interview.id}-kim` },
    data: { status: kimResult.success ? "SUCCESS" : "FAILED", errorMessage: kimResult.success ? null : kimResult.message },
  });
  return success(res, { interview, meeting }, 201);
}));

async function findScopedInterview(req: Request, id: string) {
  const scope = scopeFor(req);
  const interview = await prisma.interview.findFirst({
    where: { id, application: applicationScopeWhere(scope) },
    include: {
      application: {
        include: {
          candidate: true,
          supplier: true,
          position: true,
          owner: true,
        },
      },
      interviewerProfile: { include: { user: true } },
    },
  });
  if (!interview?.application) throw new Error("INTERVIEW_NOT_FOUND");
  return interview;
}

router.put("/workflow/interviews/:id/schedule", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.INTERVIEW_SCHEDULE);
  const body = z.object({
    scheduledStartTime: z.string().datetime({ offset: true }),
    scheduledEndTime: z.string().datetime({ offset: true }),
    interviewerId: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(2),
  }).parse(req.body);
  const interview = await findScopedInterview(req, String(req.params.id));
  if (["已取消", "取消", "候选人拒绝"].includes(interview.status))
    throw new Error("INTERVIEW_SCHEDULE_STATUS_INVALID");
  const start = new Date(body.scheduledStartTime);
  const end = new Date(body.scheduledEndTime);
  if (start <= new Date()) throw new Error("INTERVIEW_TIME_PAST");
  const profileId = body.interviewerId || interview.interviewerProfileId;
  if (!profileId) throw new Error("INTERVIEWER_NOT_FOUND");
  const profile = await prisma.interviewerProfile.findUnique({
    where: { id: profileId },
    include: { user: true },
  });
  if (!profile) throw new Error("INTERVIEWER_NOT_FOUND");
  const suffix = start.toISOString().replace(/[^0-9]/g, "");
  await prisma.$transaction(async (tx) => {
    await assertInterviewerAvailable(tx, profile, start, end, {
      businessLine: interview.application!.businessLine,
      positionId: interview.application!.positionId,
      excludeInterviewId: interview.id,
    });
    const updated = await tx.interview.updateMany({
      where: { id: interview.id, updatedAt: interview.updatedAt },
      data: {
        scheduledStartTime: start,
        scheduledEndTime: end,
        feedbackDueAt: feedbackDueAt(end),
        interviewerProfileId: profile.id,
        interviewer: profile.user.name,
        status: "待面试",
      },
    });
    if (updated.count !== 1) throw new Error("INTERVIEW_CONCURRENT_UPDATE");
    await tx.tencentMeetingRecord.updateMany({
      where: { interviewId: interview.id },
      data: { scheduledAt: start, interviewer: profile.user.name, status: "RESCHEDULED" },
    });
    await createInterviewNotifications(tx, {
      type: "INTERVIEW_RESCHEDULED",
      title: "面试改期通知",
      content: `【面试改期】${interview.application!.candidate.name} 改至 ${start.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}，面试官：${profile.user.name}`,
      application: interview.application!,
      interviewId: interview.id,
      interviewerUserId: profile.user.id,
      idempotencySuffix: suffix,
    });
    await tx.operationLog.create({
      data: {
        module: "面试",
        action: "面试改期",
        candidateId: interview.candidateId,
        applicationId: interview.applicationId,
        supplierId: interview.supplierId,
        businessLine: interview.businessLine,
        oldValue: json({
          start: interview.scheduledStartTime,
          end: interview.scheduledEndTime,
          interviewerId: interview.interviewerProfileId,
        }),
        newValue: json({ start, end, interviewerId: profile.id }),
        operatorId: req.auth!.id,
        operator: req.auth!.name,
        reason: body.reason,
      },
    });
  });
  if (interview.meetingId) {
    try {
      await meetingClient.updateMeeting(interview.meetingId, {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      });
    } catch {
      await prisma.tencentMeetingRecord.updateMany({
        where: { interviewId: interview.id },
        data: { status: "RESCHEDULE_SYNC_FAILED" },
      });
    }
  }
  const kimResult = await sendInterviewerKim(
    profile.user.kimUserId,
    "面试改期通知",
    `${interview.application!.candidate.name} 改至 ${start.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
  );
  await prisma.kimNotificationLog.updateMany({
    where: { idempotencyKey: `INTERVIEW_RESCHEDULED-${interview.id}-${suffix}-kim` },
    data: { status: kimResult.success ? "SUCCESS" : "FAILED", errorMessage: kimResult.success ? null : kimResult.message },
  });
  return success(res, await findScopedInterview(req, interview.id));
}));

router.post("/workflow/interviews/:id/cancel", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.INTERVIEW_SCHEDULE);
  const body = z.object({ reason: z.string().trim().min(2) }).parse(req.body);
  const interview = await findScopedInterview(req, String(req.params.id));
  if (["已取消", "取消"].includes(interview.status)) return success(res, interview);
  if (!interview.interviewerProfile) throw new Error("INTERVIEWER_NOT_FOUND");
  const suffix = Date.now().toString();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.interview.updateMany({
      where: { id: interview.id, updatedAt: interview.updatedAt },
      data: { status: "已取消", result: "取消" },
    });
    if (updated.count !== 1) throw new Error("INTERVIEW_CONCURRENT_UPDATE");
    await tx.tencentMeetingRecord.updateMany({
      where: { interviewId: interview.id },
      data: { status: "CANCELLED" },
    });
    await createInterviewNotifications(tx, {
      type: "INTERVIEW_CANCELLED",
      title: "面试取消通知",
      content: `【面试取消】${interview.application!.candidate.name} 原定 ${interview.scheduledStartTime.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} 的面试已取消，原因：${body.reason}`,
      application: interview.application!,
      interviewId: interview.id,
      interviewerUserId: interview.interviewerProfile!.user.id,
      idempotencySuffix: suffix,
    });
    await tx.operationLog.create({
      data: {
        module: "面试",
        action: "取消面试",
        candidateId: interview.candidateId,
        applicationId: interview.applicationId,
        supplierId: interview.supplierId,
        businessLine: interview.businessLine,
        oldValue: json({ status: interview.status, start: interview.scheduledStartTime }),
        newValue: json({ status: "已取消" }),
        operatorId: req.auth!.id,
        operator: req.auth!.name,
        reason: body.reason,
      },
    });
  });
  if (interview.meetingId) {
    try {
      await meetingClient.cancelMeeting(interview.meetingId, body.reason);
    } catch {
      await prisma.tencentMeetingRecord.updateMany({
        where: { interviewId: interview.id },
        data: { status: "CANCEL_SYNC_FAILED" },
      });
    }
  }
  const kimResult = await sendInterviewerKim(
    interview.interviewerProfile.user.kimUserId,
    "面试取消通知",
    `${interview.application!.candidate.name} 的面试已取消，原因：${body.reason}`,
  );
  await prisma.kimNotificationLog.updateMany({
    where: { idempotencyKey: `INTERVIEW_CANCELLED-${interview.id}-${suffix}-kim` },
    data: { status: kimResult.success ? "SUCCESS" : "FAILED", errorMessage: kimResult.success ? null : kimResult.message },
  });
  return success(res, await findScopedInterview(req, interview.id));
}));

const proposedSlot = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
});
const schedulingRequestBody = z.object({
  interviewer: z.string().trim().min(1),
  round: z.number().int().positive().default(1),
  roundName: z.string().trim().min(1).default("第一轮"),
  slots: z.array(proposedSlot).min(2).max(10),
  expiresInHours: z.number().int().min(1).max(168).default(72),
});
const schedulingTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

router.post("/applications/:id/scheduling-requests", wrap(async (req, res) => {
  assertSelfSchedulingEnabled();
  assertPermission(req, FeaturePermission.INTERVIEW_SCHEDULE);
  const body = schedulingRequestBody.parse(req.body);
  const application = await findApplication(req, String(req.params.id));
  if (!["待安排面试", "待面试", "面试待反馈"].includes(application.currentStatus))
    throw new Error("INTERVIEW_SCHEDULE_STATUS_INVALID");
  const slots = body.slots.map((slot) => ({ start: new Date(slot.start), end: new Date(slot.end) }));
  for (const slot of slots) {
    if (slot.end <= slot.start) throw new Error("INTERVIEW_TIME_INVALID");
    if (slot.start <= new Date()) throw new Error("INTERVIEW_TIME_PAST");
  }
  const conflicts = await Promise.all(slots.map((slot) => interviewHasConflict(prisma, body.interviewer, slot.start, slot.end)));
  if (conflicts.some(Boolean)) throw new Error("SCHEDULING_SLOT_UNAVAILABLE");
  const currentActor = actor(req);
  const rawToken = randomBytes(32).toString("base64url");
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      await tx.interviewSchedulingRequest.updateMany({
        where: { applicationId: application.id, status: SchedulingRequestStatus.PENDING },
        data: { status: SchedulingRequestStatus.CANCELLED },
      });
      const request = await tx.interviewSchedulingRequest.create({ data: {
        applicationId: application.id,
        tokenHash: schedulingTokenHash(rawToken),
        interviewer: body.interviewer,
        round: body.round,
        roundName: body.roundName,
        proposedSlots: json(body.slots),
        expiresAt: new Date(Date.now() + body.expiresInHours * 60 * 60_000),
        createdById: currentActor.id,
        createdByName: currentActor.name,
      }});
      await tx.kimNotificationLog.create({ data: {
        applicationId: application.id,
        supplierId: application.supplierId,
        businessLine: application.businessLine,
        status: "PENDING",
        messageSummary: `【候选人自助约面】已为 ${application.candidate.name} 生成 ${body.slots.length} 个候选时段`,
        idempotencyKey: `scheduling-request-${request.id}`,
      }});
      return request;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new Error("SCHEDULING_REQUEST_ACTIVE_EXISTS");
    throw error;
  }
  const frontendOrigin = String(process.env.FRONTEND_ORIGIN || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
  return success(res, {
    ...created,
    bookingUrl: `${frontendOrigin}/candidate/interview-booking/${rawToken}`,
  }, 201);
}));

async function findSchedulingRequest(token: string) {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) throw new Error("SCHEDULING_REQUEST_NOT_FOUND");
  const request = await prisma.interviewSchedulingRequest.findUnique({
    where: { tokenHash: schedulingTokenHash(token) },
    include: { application: { include: { candidate: true, position: true, supplier: true } } },
  });
  if (!request) throw new Error("SCHEDULING_REQUEST_NOT_FOUND");
  if (request.status === SchedulingRequestStatus.PENDING && request.expiresAt <= new Date()) {
    await prisma.interviewSchedulingRequest.updateMany({
      where: { id: request.id, status: SchedulingRequestStatus.PENDING },
      data: { status: SchedulingRequestStatus.EXPIRED },
    });
    request.status = SchedulingRequestStatus.EXPIRED;
  }
  return request;
}

router.get("/public/interview-scheduling/:token", wrap(async (req, res) => {
  assertSelfSchedulingEnabled();
  const request = await findSchedulingRequest(String(req.params.token));
  if (request.status === SchedulingRequestStatus.EXPIRED) throw new Error("SCHEDULING_REQUEST_EXPIRED");
  if (request.status !== SchedulingRequestStatus.PENDING) throw new Error("SCHEDULING_REQUEST_STATUS_INVALID");
  const slots = proposedSlot.array().parse(request.proposedSlots);
  const availability = await Promise.all(slots.map(async (slot, index) => ({
    index,
    start: slot.start,
    end: slot.end,
    available: !(await interviewHasConflict(prisma, request.interviewer, new Date(slot.start), new Date(slot.end))),
  })));
  return success(res, {
    candidateName: request.application.candidate.name,
    positionName: request.application.position?.name || "招聘岗位",
    supplierName: request.application.supplier.name,
    interviewer: request.interviewer,
    roundName: request.roundName,
    expiresAt: request.expiresAt,
    slots: availability,
  });
}));

router.post("/public/interview-scheduling/:token/book", wrap(async (req, res) => {
  assertSelfSchedulingEnabled();
  const body = z.object({ slotIndex: z.number().int().nonnegative() }).parse(req.body);
  const request = await findSchedulingRequest(String(req.params.token));
  if (request.status === SchedulingRequestStatus.EXPIRED) throw new Error("SCHEDULING_REQUEST_EXPIRED");
  if (request.status !== SchedulingRequestStatus.PENDING) throw new Error("SCHEDULING_REQUEST_STATUS_INVALID");
  const slots = proposedSlot.array().parse(request.proposedSlots);
  const selected = slots[body.slotIndex];
  if (!selected) throw new Error("SCHEDULING_SLOT_INVALID");
  const start = new Date(selected.start), end = new Date(selected.end);
  if (start <= new Date()) throw new Error("SCHEDULING_SLOT_UNAVAILABLE");
  const application = request.application;
  if (!["待安排面试", "待面试", "面试待反馈"].includes(application.currentStatus))
    throw new Error("SCHEDULING_REQUEST_STATUS_INVALID");
  const candidateActor = { id: `candidate:${application.candidateId}`, name: "候选人自助预约" };
  const interview = await prisma.$transaction(async (tx) => {
    await lockAndAssertInterviewAvailable(tx, request.interviewer, start, end);
    const claimed = await tx.interviewSchedulingRequest.updateMany({
      where: { id: request.id, status: SchedulingRequestStatus.PENDING, expiresAt: { gt: new Date() } },
      data: { status: SchedulingRequestStatus.BOOKED, bookedSlot: json(selected), bookedAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error("SCHEDULING_REQUEST_STATUS_INVALID");
    const created = await tx.interview.create({ data: {
      applicationId: application.id,
      candidateId: application.candidateId,
      supplierId: application.supplierId,
      businessLine: application.businessLine,
      scheduledStartTime: start,
      scheduledEndTime: end,
      feedbackDueAt: feedbackDueAt(end),
      round: request.round,
      roundName: request.roundName,
      interviewer: request.interviewer,
      status: "待面试",
    }});
    if (application.currentStatus !== "待面试")
      await transitionApplicationAs(tx, application, "待面试", candidateActor, `${request.roundName}候选人自助选定时段`);
    await tx.kimNotificationLog.create({ data: {
      applicationId: application.id,
      interviewId: created.id,
      supplierId: application.supplierId,
      businessLine: application.businessLine,
      status: "PENDING",
      messageSummary: `【候选人已选时段】${application.candidate.name} 选择 ${start.toISOString()}，面试官：${request.interviewer}`,
      idempotencyKey: `scheduling-booked-${request.id}`,
    }});
    await tx.operationLog.create({ data: {
      module: "面试",
      action: "候选人自助选定面试时段",
      candidateId: application.candidateId,
      applicationId: application.id,
      supplierId: application.supplierId,
      businessLine: application.businessLine,
      newValue: json({ start, end, interviewer: request.interviewer, round: request.round }),
      operatorId: candidateActor.id,
      operator: candidateActor.name,
    }});
    return created;
  });

  let meeting: unknown = null;
  try {
    const createdMeeting = await meetingClient.createMeeting({
      subject: `招聘面试｜${application.candidate.name}｜${application.position?.name || "招聘岗位"}｜${request.roundName}`,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });
    meeting = await prisma.$transaction(async (tx) => {
      const record = await tx.tencentMeetingRecord.create({ data: {
        applicationId: application.id,
        interviewId: interview.id,
        supplierId: application.supplierId,
        businessLine: application.businessLine,
        meetingCode: createdMeeting.meetingCode,
        meetingUrl: createdMeeting.joinUrl,
        providerId: createdMeeting.meetingId,
        status: createdMeeting.status,
        interviewer: request.interviewer,
        scheduledAt: start,
      }});
      await tx.interview.update({ where: { id: interview.id }, data: {
        meetingProvider: "TENCENT",
        meetingId: createdMeeting.meetingId,
        meetingUrl: createdMeeting.joinUrl,
      }});
      return record;
    });
  } catch {
    await prisma.interview.update({ where: { id: interview.id }, data: { status: "会议创建失败" } });
  }
  return success(res, { interview, meeting, message: "面试时段已确认" }, 201);
}));

const feedbackBody = z.object({
  templateVersion: z.string().trim().min(1).default("default-v1"),
  dimensionScores: z.record(z.string(), z.number()),
  comment: z.string(),
});

router.post("/workflow/interviews/:id/feedback", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.FEEDBACK_SUBMIT);
  const body = feedbackBody.parse(req.body);
  const scope = scopeFor(req);
  const interview = await prisma.interview.findFirst({ where: {
    id: String(req.params.id),
    ...(req.auth!.role === UserRole.INTERVIEWER
      ? { interviewerProfileId: req.auth!.interviewerProfileId || "" }
      : { application: applicationScopeWhere(scope) }),
  }, include: { application: { include: { position: true } } } });
  if (!interview?.application) throw new Error("INTERVIEW_NOT_FOUND");
  const template = feedbackTemplateConfig(interview.application.position?.feedbackTemplate);
  assertFeedbackComplete(body.dimensionScores, body.comment, template.dimensions);
  const currentActor = actor(req), dueAt = interview.feedbackDueAt || feedbackDueAt(interview.scheduledEndTime || interview.scheduledStartTime);
  await prisma.$transaction(async (tx) => {
    await tx.interviewFeedback.upsert({
      where: { interviewId: interview.id },
      update: {
        templateVersion: template.version,
        dimensionScores: json(body.dimensionScores),
        comment: body.comment.trim(),
        status: InterviewFeedbackStatus.SUBMITTED,
        dueAt,
        submittedById: currentActor.id,
        submittedByName: currentActor.name,
        submittedAt: new Date(),
      },
      create: {
        interviewId: interview.id,
        templateVersion: template.version,
        dimensionScores: json(body.dimensionScores),
        comment: body.comment.trim(),
        status: InterviewFeedbackStatus.SUBMITTED,
        dueAt,
        submittedById: currentActor.id,
        submittedByName: currentActor.name,
        submittedAt: new Date(),
      },
    });
    await tx.interview.update({ where: { id: interview.id }, data: { feedback: body.comment.trim(), status: "面评已提交" } });
    if (interview.application!.currentStatus === "待面试")
      await transitionApplication(tx, interview.application!, "面试待反馈", req, `${interview.roundName || `第${interview.round}轮`}面评已提交`);
    await tx.operationLog.create({ data: {
      module: "面评",
      action: "提交结构化面评",
      candidateId: interview.candidateId,
      applicationId: interview.applicationId,
      supplierId: interview.supplierId,
      businessLine: interview.businessLine,
      newValue: json({ templateVersion: template.version, dimensions: body.dimensionScores }),
      operatorId: currentActor.id,
      operator: currentActor.name,
    }});
  });
  return success(res, await prisma.interview.findUnique({ where: { id: interview.id }, include: { feedbackRecord: true } }));
}));

router.post("/applications/:id/actions/conclude", wrap(async (req, res) => {
  assertInternalDecisionRole(req);
  const body = z.object({
    finalResult: z.enum(["通过", "不通过"]),
    finalLevel: z.string().trim().optional().nullable(),
    reason: z.string().trim().min(2),
  }).parse(req.body);
  if (body.finalResult === "通过" && !body.finalLevel) throw new Error("INTERVIEW_LEVEL_REQUIRED");
  const application = await findApplication(req, String(req.params.id));
  const rounds = application.interviews.filter((item) => !["已取消", "取消"].includes(item.status));
  if (!rounds.length) throw new Error("INTERVIEW_REQUIRED");
  if (rounds.some((item) => item.feedbackRecord?.status !== InterviewFeedbackStatus.SUBMITTED))
    throw new Error("INTERVIEW_FEEDBACK_REQUIRED");
  const targetStatus = body.finalResult === "通过" ? "面试通过" : "面试未通过";
  const currentActor = actor(req);
  const roundSummary = rounds.map((item) => ({
    interviewId: item.id,
    round: item.round,
    roundName: item.roundName,
    interviewer: item.interviewer,
    dimensionScores: item.feedbackRecord?.dimensionScores,
    comment: item.feedbackRecord?.comment,
    submittedAt: item.feedbackRecord?.submittedAt,
  }));
  await prisma.$transaction(async (tx) => {
    await transitionApplication(tx, application, targetStatus, req, body.reason);
    await tx.candidateApplication.update({ where: { id: application.id }, data: { interviewResult: body.finalResult } });
    await tx.interviewConclusion.upsert({
      where: { applicationId: application.id },
      update: { finalResult: body.finalResult, finalLevel: body.finalLevel, roundSummary: json(roundSummary), decidedById: currentActor.id, decidedByName: currentActor.name, decidedAt: new Date() },
      create: { applicationId: application.id, finalResult: body.finalResult, finalLevel: body.finalLevel, roundSummary: json(roundSummary), decidedById: currentActor.id, decidedByName: currentActor.name },
    });
  });
  return success(res, workflowPayload(req, await findApplication(req, application.id)));
}));

router.post("/applications/:id/offers", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.OFFER_MANAGE);
  const application = await findApplication(req, String(req.params.id));
  if (application.currentStatus !== "面试通过" || application.conclusion?.finalResult !== "通过")
    throw new Error("OFFER_PREREQUISITE_MISSING");
  const activeOfferStatuses = new Set<OfferStatus>([OfferStatus.PENDING_INITIATION, OfferStatus.SENT]);
  const active = application.offers.find((item) => activeOfferStatuses.has(item.status));
  if (active) throw new Error("OFFER_ACTIVE_EXISTS");
  const currentActor = actor(req);
  let offer;
  try {
    offer = await prisma.offer.create({ data: { applicationId: application.id, initiatedById: currentActor.id, initiatedByName: currentActor.name } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new Error("OFFER_ACTIVE_EXISTS");
    throw error;
  }
  return success(res, offer, 201);
}));

async function findOffer(req: Request, id: string) {
  const scope = scopeFor(req);
  const offer = await prisma.offer.findFirst({ where: { id, application: applicationScopeWhere(scope) }, include: { application: true } });
  if (!offer) throw new Error("OFFER_NOT_FOUND");
  return offer;
}

router.post("/workflow/offers/:id/actions/send", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.OFFER_MANAGE);
  const offer = await findOffer(req, String(req.params.id));
  if (offer.status !== OfferStatus.PENDING_INITIATION) throw new Error("OFFER_STATUS_INVALID");
  const currentActor = actor(req);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.offer.updateMany({ where: { id: offer.id, status: OfferStatus.PENDING_INITIATION }, data: { status: OfferStatus.SENT, sentAt: new Date(), sentById: currentActor.id, sentByName: currentActor.name } });
    if (updated.count !== 1) throw new Error("OFFER_STATUS_INVALID");
    await transitionApplication(tx, offer.application, "待确认入职", req, "Offer 已发出");
  });
  return success(res, await findOffer(req, offer.id));
}));

router.post("/workflow/offers/:id/actions/respond", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.OFFER_MANAGE);
  const body = z.object({ response: z.enum(["CONFIRMED", "REJECTED"]), reason: z.string().trim().optional() }).parse(req.body);
  const offer = await findOffer(req, String(req.params.id));
  if (offer.status !== OfferStatus.SENT) throw new Error("OFFER_STATUS_INVALID");
  const status = body.response === "CONFIRMED" ? OfferStatus.CANDIDATE_CONFIRMED : OfferStatus.REJECTED;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.offer.updateMany({ where: { id: offer.id, status: OfferStatus.SENT }, data: { status, candidateRespondedAt: new Date(), rejectedReason: body.response === "REJECTED" ? body.reason || "候选人拒绝" : null } });
    if (updated.count !== 1) throw new Error("OFFER_STATUS_INVALID");
    if (body.response === "REJECTED")
      await transitionApplication(tx, offer.application, "候选人放弃", req, body.reason || "候选人拒绝 Offer");
  });
  return success(res, await findOffer(req, offer.id));
}));

router.post("/workflow/offers/:id/actions/expire", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.OFFER_MANAGE);
  const offer = await findOffer(req, String(req.params.id));
  if (!new Set<OfferStatus>([OfferStatus.PENDING_INITIATION, OfferStatus.SENT]).has(offer.status))
    throw new Error("OFFER_STATUS_INVALID");
  const updated = await prisma.offer.updateMany({ where: { id: offer.id, status: offer.status }, data: { status: OfferStatus.EXPIRED, expiredAt: new Date() } });
  if (updated.count !== 1) throw new Error("OFFER_STATUS_INVALID");
  return success(res, await findOffer(req, offer.id));
}));

router.post("/applications/:id/level-adjustments", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.LEVEL_ADJUSTMENT_REQUEST);
  const body = z.object({ requestedLevel: z.string().trim().min(1), reason: z.string().trim().min(2) }).parse(req.body);
  const application = await findApplication(req, String(req.params.id)), currentActor = actor(req);
  if (application.levelAdjustments.some((item) => item.status === LevelAdjustmentStatus.PENDING))
    throw new Error("LEVEL_ADJUSTMENT_ACTIVE_EXISTS");
  try {
    return success(res, await prisma.jobLevelAdjustment.create({ data: {
      applicationId: application.id,
      requestedLevel: body.requestedLevel,
      reason: body.reason,
      requestedById: currentActor.id,
      requestedByName: currentActor.name,
    }}), 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new Error("LEVEL_ADJUSTMENT_ACTIVE_EXISTS");
    throw error;
  }
}));

router.post("/workflow/level-adjustments/:id/review", wrap(async (req, res) => {
  assertManagerRole(req);
  const body = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), comment: z.string().trim().min(2) }).parse(req.body);
  const scope = scopeFor(req);
  const adjustment = await prisma.jobLevelAdjustment.findFirst({ where: { id: String(req.params.id), application: applicationScopeWhere(scope) } });
  if (!adjustment) throw new Error("LEVEL_ADJUSTMENT_NOT_FOUND");
  if (adjustment.status !== LevelAdjustmentStatus.PENDING) throw new Error("LEVEL_ADJUSTMENT_STATUS_INVALID");
  const currentActor = actor(req);
  const updated = await prisma.jobLevelAdjustment.updateMany({ where: { id: adjustment.id, status: LevelAdjustmentStatus.PENDING }, data: {
    status: body.decision === "APPROVED" ? LevelAdjustmentStatus.APPROVED : LevelAdjustmentStatus.REJECTED,
    reviewedById: currentActor.id,
    reviewedByName: currentActor.name,
    reviewComment: body.comment,
    reviewedAt: new Date(),
  }});
  if (updated.count !== 1) throw new Error("LEVEL_ADJUSTMENT_STATUS_INVALID");
  return success(res, await prisma.jobLevelAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } }));
}));

router.post("/applications/:id/actions/confirm-onboarding", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.ONBOARDING_CONFIRM);
  const body = z.object({
    result: z.enum(["CONFIRMED", "DECLINED"]),
    entryDate: z.string().datetime({ offset: true }).optional(),
    assigneeName: z.string().trim().min(1).optional(),
    assigneeId: z.string().trim().optional(),
    note: z.string().trim().optional(),
  }).parse(req.body);
  const application = await findApplication(req, String(req.params.id));
  if (!application.offers.some((item) => item.status === OfferStatus.CANDIDATE_CONFIRMED))
    throw new Error("ONBOARDING_OFFER_NOT_CONFIRMED");
  if (body.result === "CONFIRMED" && !body.entryDate) throw new Error("ONBOARDING_ENTRY_DATE_REQUIRED");
  const currentActor = actor(req), entryDate = body.entryDate ? new Date(body.entryDate) : null;
  await prisma.$transaction(async (tx) => {
    await tx.onboardingConfirmation.upsert({
      where: { applicationId: application.id },
      update: { result: body.result === "CONFIRMED" ? OnboardingResult.CONFIRMED : OnboardingResult.DECLINED, entryDate, confirmedById: currentActor.id, confirmedByName: currentActor.name, note: body.note, confirmedAt: new Date() },
      create: { applicationId: application.id, result: body.result === "CONFIRMED" ? OnboardingResult.CONFIRMED : OnboardingResult.DECLINED, entryDate, confirmedById: currentActor.id, confirmedByName: currentActor.name, note: body.note },
    });
    if (body.result === "DECLINED") {
      await transitionApplication(tx, application, "候选人放弃", req, body.note || "候选人确认不入职");
      return;
    }
    await tx.candidateApplication.update({ where: { id: application.id }, data: { expectedEntryDate: entryDate } });
    await transitionApplication(tx, application, "待入职", req, `已确认入职日期：${entryDate!.toISOString().slice(0, 10)}`);
    await tx.receptionTask.upsert({
      where: { applicationId: application.id },
      update: { assigneeId: body.assigneeId, assigneeName: body.assigneeName || "入职接待同学", dueAt: entryDate! },
      create: {
        applicationId: application.id,
        assigneeId: body.assigneeId,
        assigneeName: body.assigneeName || "入职接待同学",
        dueAt: entryDate!,
        createdById: currentActor.id,
        createdByName: currentActor.name,
        checklist: { create: [
          { title: "确认账号已开通", sortOrder: 1 },
          { title: "确认工位与设备已准备", sortOrder: 2 },
          { title: "完成入职资料核验", sortOrder: 3 },
          { title: "完成团队与项目介绍", sortOrder: 4 },
        ] },
      },
    });
    await tx.kimNotificationLog.upsert({
      where: { idempotencyKey: `reception-created-${application.id}` },
      update: {},
      create: {
        applicationId: application.id,
        supplierId: application.supplierId,
        businessLine: application.businessLine,
        status: "PENDING",
        messageSummary: `【入职接待】${application.candidate.name} 将于 ${entryDate!.toISOString().slice(0, 10)} 入职，接待负责人：${body.assigneeName || "入职接待同学"}`,
        idempotencyKey: `reception-created-${application.id}`,
      },
    });
  });
  return success(res, workflowPayload(req, await findApplication(req, application.id)));
}));

async function findReceptionTask(req: Request, id: string) {
  const scope = scopeFor(req);
  const task = await prisma.receptionTask.findFirst({ where: { id, application: applicationScopeWhere(scope) }, include: { checklist: { orderBy: { sortOrder: "asc" } }, application: true } });
  if (!task) throw new Error("RECEPTION_TASK_NOT_FOUND");
  return task;
}

router.get("/reception-tasks", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.RECEPTION_VIEW);
  const scope = scopeFor(req);
  const status = req.query.status === undefined
    ? undefined
    : z.nativeEnum(ReceptionTaskStatus).parse(req.query.status);
  const rows = await prisma.receptionTask.findMany({
    where: { application: applicationScopeWhere(scope), ...(status ? { status } : {}) },
    include: { checklist: { orderBy: { sortOrder: "asc" } }, application: { include: { candidate: { select: { id: true, name: true, candidateNo: true, phoneMasked: true, emailMasked: true } }, supplier: true, position: true } } },
    orderBy: { dueAt: "asc" },
  });
  return success(res, rows);
}));

router.put("/reception-tasks/:id/assignee", wrap(async (req, res) => {
  assertInternalDecisionRole(req);
  const body = z.object({ assigneeId: z.string().optional().nullable(), assigneeName: z.string().trim().min(1) }).parse(req.body);
  const task = await findReceptionTask(req, String(req.params.id));
  return success(res, await prisma.receptionTask.update({ where: { id: task.id }, data: { assigneeId: body.assigneeId, assigneeName: body.assigneeName } }));
}));

router.post("/reception-tasks/:id/checklist/:itemId/toggle", wrap(async (req, res) => {
  assertInternalDecisionRole(req);
  const body = z.object({ completed: z.boolean() }).parse(req.body);
  const task = await findReceptionTask(req, String(req.params.id));
  const item = task.checklist.find((candidate) => candidate.id === String(req.params.itemId));
  if (!item) throw new Error("RECEPTION_CHECKLIST_ITEM_NOT_FOUND");
  const currentActor = actor(req);
  await prisma.$transaction([
    prisma.receptionChecklistItem.update({ where: { id: item.id }, data: {
      completed: body.completed,
      completedById: body.completed ? currentActor.id : null,
      completedByName: body.completed ? currentActor.name : null,
      completedAt: body.completed ? new Date() : null,
    }}),
    prisma.receptionTask.update({ where: { id: task.id }, data: { status: ReceptionTaskStatus.IN_PROGRESS } }),
  ]);
  return success(res, await findReceptionTask(req, task.id));
}));

router.post("/reception-tasks/:id/actions/complete", wrap(async (req, res) => {
  assertInternalDecisionRole(req);
  const body = z.object({ actualEntryDate: z.string().datetime({ offset: true }).optional() }).parse(req.body);
  const task = await findReceptionTask(req, String(req.params.id));
  if (task.checklist.some((item) => item.required && !item.completed)) throw new Error("RECEPTION_CHECKLIST_INCOMPLETE");
  if (task.status === ReceptionTaskStatus.COMPLETED) return success(res, task);
  const currentActor = actor(req), actualEntryDate = body.actualEntryDate ? new Date(body.actualEntryDate) : new Date();
  await prisma.$transaction(async (tx) => {
    await tx.receptionTask.update({ where: { id: task.id }, data: { status: ReceptionTaskStatus.COMPLETED, completedById: currentActor.id, completedByName: currentActor.name, completedAt: new Date() } });
    await tx.candidateApplication.update({ where: { id: task.applicationId }, data: { actualEntryDate } });
    await transitionApplication(tx, task.application, "培训中", req, "入职接待 Checklist 已完成并回执");
  });
  return success(res, await findReceptionTask(req, task.id));
}));

router.get("/saved-filters", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.SCREENING_SUBMIT);
  const module = String(req.query.module || "AI_SCREENING");
  return success(res, await prisma.savedFilter.findMany({ where: { userId: req.auth!.id, module }, orderBy: { updatedAt: "desc" } }));
}));

router.post("/saved-filters", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.SCREENING_SUBMIT);
  const body = z.object({ module: z.string().min(1), name: z.string().trim().min(1), filters: z.record(z.string(), z.unknown()) }).parse(req.body);
  return success(res, await prisma.savedFilter.upsert({
    where: { userId_module_name: { userId: req.auth!.id, module: body.module, name: body.name } },
    update: { filters: json(body.filters) },
    create: { userId: req.auth!.id, module: body.module, name: body.name, filters: json(body.filters) },
  }), 201);
}));

router.delete("/saved-filters/:id", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.SCREENING_SUBMIT);
  const deleted = await prisma.savedFilter.deleteMany({ where: { id: String(req.params.id), userId: req.auth!.id } });
  if (!deleted.count) throw new Error("SAVED_FILTER_NOT_FOUND");
  return success(res, { id: req.params.id });
}));

export async function scanOverdueFeedbackReminders(now = new Date()) {
  const interviews = await prisma.interview.findMany({
    where: {
      feedbackDueAt: { lte: now },
      status: { notIn: ["已取消", "取消"] },
      OR: [{ feedbackRecord: null }, { feedbackRecord: { status: { not: InterviewFeedbackStatus.SUBMITTED } } }],
      applicationId: { not: null },
      supplierId: { not: null },
      businessLine: { not: null },
    },
    include: { feedbackRecord: true, application: { include: { candidate: true } } },
  });
  for (const interview of interviews) {
    if (!interview.applicationId || !interview.supplierId || !interview.businessLine) continue;
    await prisma.$transaction(async (tx) => {
      await tx.interviewFeedback.upsert({
        where: { interviewId: interview.id },
        update: { status: InterviewFeedbackStatus.OVERDUE },
        create: { interviewId: interview.id, templateVersion: "default-v1", dimensionScores: {}, comment: "", status: InterviewFeedbackStatus.OVERDUE, dueAt: interview.feedbackDueAt! },
      });
      await tx.kimNotificationLog.upsert({
        where: { idempotencyKey: `feedback-overdue-${interview.id}` },
        update: {},
        create: {
          applicationId: interview.applicationId!,
          interviewId: interview.id,
          supplierId: interview.supplierId!,
          businessLine: interview.businessLine!,
          status: "PENDING",
          messageSummary: `【面评超时】${interview.application?.candidate.name || "候选人"} 的${interview.roundName || `第${interview.round}轮`}面评已超过 24 小时未提交`,
          idempotencyKey: `feedback-overdue-${interview.id}`,
        },
      });
    });
  }
  return interviews.length;
}

router.post("/workflow/feedback-reminders/scan", wrap(async (req, res) => {
  assertInternalDecisionRole(req);
  return success(res, { overdue: await scanOverdueFeedbackReminders() });
}));

router.get("/workflow/feedback-template", wrap(async (req, res) => {
  assertPermission(req, FeaturePermission.FEEDBACK_VIEW);
  const position = req.query.positionId
    ? await prisma.jobPosition.findUnique({ where: { id: String(req.query.positionId) }, select: { feedbackTemplate: true } })
    : null;
  return success(res, feedbackTemplateConfig(position?.feedbackTemplate));
}));

router.put("/workflow/positions/:id/feedback-template", wrap(async (req, res) => {
  assertManagerRole(req);
  const body = z.object({
    version: z.string().trim().min(1).max(50),
    dimensions: z.array(z.string().trim().min(1).max(50)).min(1).max(10),
  }).parse(req.body);
  const position = await prisma.jobPosition.findUnique({ where: { id: String(req.params.id) } });
  if (!position) throw new Error("POSITION_NOT_FOUND");
  const template = feedbackTemplateConfig(body);
  await prisma.jobPosition.update({ where: { id: position.id }, data: { feedbackTemplate: json(template) } });
  return success(res, template);
}));

export default router;
