// @ts-nocheck Legacy .mjs integration adapters are runtime-checked by build:server.
import "dotenv/config";
import express, { type Response } from "express";
import cors from "cors";
import { z } from "zod";
// @ts-ignore JS 适配器在 Node 运行时加载
import {
  createInterviewReminderTasks,
  defaultReminderSettings,
  scanAndSendInterviewReminders,
} from "./interviewReminderService.mjs";
// @ts-ignore JS 适配器在 Node 运行时加载
import { createKimClient, kimConfig } from "./kimClient.mjs";
import { createTencentMeetingClient } from "./tencentMeetingClient.js";
import { aiStatus, matchResumeWithAi } from "./aiClient.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import recruitmentRouter, {
  cleanupExpiredImportFiles,
} from "./recruitmentRouter.js";
import autoDashboardRouter from "./autoDashboardRouter.js";
import authRouter from "./authRouter.js";
import { isSupplierUser, requireAuth, requireRoles } from "./auth.js";
import { UserRole } from "@prisma/client";
import { assertDatabaseConnection, prisma } from "./database.js";
import { ensureBootstrapAdmin } from "./bootstrap.js";
type Store = {
  interviews: Record<string, any>[];
  tasks: Record<string, any>[];
  logs: Record<string, any>[];
  meetings: Record<string, any>[];
  participants: Record<string, any>[];
  recordings: Record<string, any>[];
  webhookEvents: Record<string, any>[];
};
const dataPath = path.resolve(process.env.KIM_DATA_PATH || "data/kim-interviews.json");
fs.mkdirSync(path.dirname(dataPath), { recursive: true });
const store: Store = fs.existsSync(dataPath)
  ? {
      meetings: [],
      participants: [],
      recordings: [],
      webhookEvents: [],
      ...JSON.parse(fs.readFileSync(dataPath, "utf8")),
    }
  : {
      interviews: [],
      tasks: [],
      logs: [],
      meetings: [],
      participants: [],
      recordings: [],
      webhookEvents: [],
    };
const save = () => fs.writeFileSync(dataPath, JSON.stringify(store, null, 2));
const app = express();
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin.replace(/\/$/, ""))), allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"] }));
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const requestId = String(req.headers["x-request-id"] || randomUUID());
  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
});
const rateState = new Map<string, { count: number; resetAt: number }>();
app.use(
  ["/api/imports/candidates/upload", "/api/imports/candidates/:taskId/confirm"],
  (req, res, next) => {
    const key = `${req.ip}:${req.path.includes("confirm") ? "confirm" : "upload"}`,
      now = Date.now(),
      current = rateState.get(key);
    const state =
      !current || current.resetAt < now
        ? { count: 0, resetAt: now + 60_000 }
        : current;
    state.count += 1;
    rateState.set(key, state);
    if (state.count > 20)
      return res.status(429).json({
        success: false,
        code: "RATE_LIMITED",
        message: "请求过于频繁，请稍后重试",
        requestId: res.locals.requestId,
      });
    next();
  },
);
app.get("/api/health", (_req, res) => res.json({ success: true, data: { status: "ok" } }));
app.use("/api/auth", authRouter);
app.use("/api", (req, res, next) => req.path === "/webhooks/tencent-meeting" ? next() : requireAuth(req, res, next));
app.use("/api", recruitmentRouter);
app.use("/api/auto-dashboard", autoDashboardRouter);
const send = (res: Response, status: number, body: object) =>
  res.status(status).json(body);
const addTasks = (tasks: Record<string, unknown>[]) => {
  const keys = new Set(store.tasks.map((task) => task.idempotencyKey));
  tasks.forEach((task) => {
    if (!keys.has(task.idempotencyKey)) {
      store.tasks.push(task);
      keys.add(task.idempotencyKey);
    }
  });
};
const meetingClient = createTencentMeetingClient();
const interviewSupplier = (item: Record<string, any>) => item.supplierName || item.supplier || item.vendor || null;
const canAccessInterview = (req: express.Request, item: Record<string, any>) =>
  !isSupplierUser(req) || interviewSupplier(item) === req.auth?.supplierName;
const findVisibleInterview = (req: express.Request, id: string) =>
  store.interviews.find((item) => item.id === id && canAccessInterview(req, item));
const conflict = (
  interviewerId: string,
  start: string,
  end: string,
  exclude?: string,
) =>
  store.interviews.some(
    (item) =>
      item.id !== exclude &&
      item.interviewerId === interviewerId &&
      item.status !== "已取消" &&
      new Date(start).getTime() <
        new Date(item.scheduledEndTime || item.endTime).getTime() +
          10 * 60000 &&
      new Date(end).getTime() >
        new Date(item.scheduledStartTime || item.startTime).getTime() -
          10 * 60000,
  );
app.get("/api/kim/status", (_req, res) =>
  send(res, 200, {
    success: true,
    configured: createKimClient().configured,
    mode: kimConfig().mode,
    message: createKimClient().configured ? "Kim已配置" : "Kim机器人尚未配置",
  }),
);
app.get("/api/interviews", (req, res) =>
  send(res, 200, { success: true, data: store.interviews.filter((item) => canAccessInterview(req, item)), tasks: store.tasks.filter((task) => !isSupplierUser(req) || interviewSupplier(task) === req.auth?.supplierName) }),
);
app.get("/api/interview-reminders", (req, res) =>
  send(res, 200, { success: true, data: store.tasks.filter((task) => {
    if (!isSupplierUser(req)) return true;
    const interview = store.interviews.find((item) => item.id === task.interviewId);
    return Boolean(interview && canAccessInterview(req, interview));
  }) }),
);
app.get("/api/tencent-meeting/status", async (_req, res) =>
  send(res, 200, { success: true, data: await meetingClient.testConnection() }),
);
app.get("/api/ai/status", (_req, res) =>
  send(res, 200, {
    success: true,
    data: aiStatus(),
    message: aiStatus().configured
      ? "AI 模型已配置"
      : "AI 模型尚未配置，将使用规则筛选",
  }),
);
app.post("/api/ai/resume-match", async (req, res) => {
  try {
    const data = await matchResumeWithAi(req.body);
    return send(res, 200, { success: true, data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "AI_REQUEST_FAILED";
    const status = code === "AI_NOT_CONFIGURED" ? 503 : 502;
    return send(res, status, {
      success: false,
      code,
      message:
        code === "AI_NOT_CONFIGURED"
          ? "AI 模型尚未配置"
          : "AI 筛选服务暂时不可用，请使用规则筛选或稍后重试",
    });
  }
});
app.post("/api/tencent-meeting/test", async (_req, res) =>
  send(res, 200, { success: true, data: await meetingClient.testConnection() }),
);
app.post("/api/interviews", (req, res) => {
  const interview = {
    ...req.body,
    ...(isSupplierUser(req) ? { supplierId: req.auth?.supplierId, supplierName: req.auth?.supplierName, supplier: req.auth?.supplierName, vendor: req.auth?.supplierName } : {}),
    id: req.body.id || `INT-${Date.now()}`,
    status: req.body.status || "已安排",
    result: req.body.result || "待反馈",
    timezone: req.body.timezone || "Asia/Shanghai",
    reminderSettings: {
      ...defaultReminderSettings,
      ...(req.body.reminderSettings || {}),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.interviews.push(interview);
  addTasks(createInterviewReminderTasks(interview));
  save();
  return send(res, 201, {
    success: true,
    data: interview,
    reminderCount: store.tasks.filter(
      (task) => task.interviewId === interview.id,
    ).length,
  });
});
app.post("/api/interviews/:id/create-meeting", async (req, res) => {
  const interview = findVisibleInterview(req, req.params.id);
  if (!interview)
    return send(res, 404, {
      success: false,
      code: "INTERVIEW_NOT_FOUND",
      message: "面试不存在",
    });
  if (interview.tencentMeeting?.meetingId)
    return send(res, 409, {
      success: false,
      code: "MEETING_ALREADY_CREATED",
      message: "该面试已经创建腾讯会议",
    });
  const start =
    req.body.startTime || interview.scheduledStartTime || interview.startTime;
  const end =
    req.body.endTime || interview.scheduledEndTime || interview.endTime;
  if (
    interview.interviewerId &&
    conflict(interview.interviewerId, start, end, interview.id)
  )
    return send(res, 409, {
      success: false,
      code: "INTERVIEW_TIME_CONFLICT",
      message: "面试官时间冲突，请调整时间",
    });
  try {
    interview.status = "会议创建中";
    const meeting = await meetingClient.createMeeting({
      subject:
        req.body.subject ||
        `招聘面试｜${interview.candidateName}｜${interview.position}｜${interview.roundName}`,
      startTime: start,
      endTime: end,
      creatorUserId: process.env.TENCENT_MEETING_CREATOR_USER_ID,
      hostUserId: interview.interviewerId,
      timezone: "Asia/Shanghai",
      autoRecord: Boolean(req.body.autoRecord),
    });
    interview.tencentMeeting = meeting;
    interview.meetingProvider = "腾讯会议";
    interview.meetingMode =
      process.env.TENCENT_MEETING_MODE === "api" ? "api" : "mock";
    interview.status = "已安排";
    interview.updatedAt = new Date().toISOString();
    store.meetings.push({ interviewId: interview.id, ...meeting });
    save();
    return send(res, 200, {
      success: true,
      data: { interview, meeting, mode: interview.meetingMode },
    });
  } catch (error) {
    interview.status = "会议创建失败";
    interview.updatedAt = new Date().toISOString();
    save();
    return send(res, 502, {
      success: false,
      code:
        error instanceof Error
          ? error.message
          : "TENCENT_MEETING_CREATE_FAILED",
      message: "腾讯会议创建失败，面试记录已保留",
    });
  }
});
app.get("/api/interviews/:id/participants", (req, res) => {
  if (!findVisibleInterview(req, req.params.id)) return send(res, 404, { success: false, code: "INTERVIEW_NOT_FOUND", message: "面试不存在" });
  return send(res, 200, {
    success: true,
    data: store.participants.filter(
      (item) => item.interviewId === req.params.id,
    ),
  });
});
app.post("/api/interviews/:id/sync-participants", async (req, res) => {
  const interview = findVisibleInterview(req, req.params.id);
  if (!interview?.tencentMeeting?.meetingId)
    return send(res, 400, {
      success: false,
      code: "TENCENT_MEETING_NOT_FOUND",
      message: "暂无腾讯会议",
    });
  const data = await meetingClient.getParticipants(
    interview.tencentMeeting.meetingId,
  );
  store.participants = store.participants
    .filter((item) => item.interviewId !== interview.id)
    .concat(data.map((item) => ({ ...item, interviewId: interview.id })));
  save();
  return send(res, 200, { success: true, data });
});
app.get("/api/interviews/:id/recordings", (req, res) => {
  if (!findVisibleInterview(req, req.params.id)) return send(res, 404, { success: false, code: "INTERVIEW_NOT_FOUND", message: "面试不存在" });
  return send(res, 200, {
    success: true,
    data: store.recordings.filter((item) => item.interviewId === req.params.id),
  });
});
app.post("/api/interviews/:id/sync-recordings", async (req, res) => {
  const interview = findVisibleInterview(req, req.params.id);
  if (!interview?.tencentMeeting?.meetingId)
    return send(res, 400, {
      success: false,
      code: "TENCENT_MEETING_NOT_FOUND",
      message: "暂无腾讯会议",
    });
  if (process.env.TENCENT_MEETING_SYNC_RECORDINGS_ENABLED !== "true")
    return send(res, 200, {
      success: true,
      data: [],
      message: "录制同步未开启",
    });
  const data = await meetingClient.getRecordings(
    interview.tencentMeeting.meetingId,
  );
  store.recordings = store.recordings
    .filter((item) => item.interviewId !== interview.id)
    .concat(data.map((item) => ({ ...item, interviewId: interview.id })));
  save();
  return send(res, 200, { success: true, data });
});
app.post("/api/kim/interview-reminders/test", requireRoles(UserRole.PLATFORM_ADMIN, UserRole.INTERNAL_RECRUITER), async (req, res) => {
  const result = await createKimClient().sendMessage(
    { webhookUrl: req.body.webhookUrl },
    {
      type: "markdown",
      title: "Kim接入测试",
      content: req.body.content || "Kim面试提醒接入测试成功",
    },
  );
  return send(res, result.success ? 200 : 503, {
    success: result.success,
    code: result.code,
    message: result.message,
    requestId: result.requestId,
  });
});
app.post("/api/interview-reminders/scan", requireRoles(UserRole.PLATFORM_ADMIN, UserRole.INTERNAL_RECRUITER), async (_req, res) => {
  await scanAndSendInterviewReminders(store);
  save();
  return send(res, 200, {
    success: true,
    pending: store.tasks.filter((task) => task.status === "pending").length,
  });
});
app.post("/api/interviews/:id/cancel", (req, res) => {
  const interview = findVisibleInterview(req, req.params.id);
  if (!interview)
    return send(res, 404, {
      success: false,
      code: "INTERVIEW_NOT_FOUND",
      message: "面试不存在",
    });
  interview.status = "已取消";
  interview.result = "取消";
  interview.cancelReason = req.body.reason || "未填写原因";
  store.tasks
    .filter(
      (task) => task.interviewId === interview.id && task.status === "pending",
    )
    .forEach((task) => {
      task.status = "cancelled";
    });
  save();
  return send(res, 200, { success: true, data: interview });
});
app.post("/api/webhooks/tencent-meeting", (req, res) => {
  const token = process.env.TENCENT_MEETING_WEBHOOK_TOKEN;
  if (token && req.headers["x-tencent-meeting-token"] !== token)
    return send(res, 401, {
      success: false,
      code: "TENCENT_MEETING_WEBHOOK_INVALID",
      message: "Webhook校验失败",
    });
  const event = req.body || {};
  const traceId = event.trace_id || event.traceId || `local-${Date.now()}`;
  if (store.webhookEvents.some((item) => item.traceId === traceId))
    return send(res, 200, { success: true, duplicate: true });
  const record = {
    id: `WH-${Date.now()}`,
    traceId,
    eventName: event.event || event.eventName || "unknown",
    meetingId: event.meeting_id || event.meetingId,
    receivedAt: new Date().toISOString(),
    status: "处理成功",
  };
  store.webhookEvents.push(record);
  const meeting = store.meetings.find(
    (item) => item.meetingId === record.meetingId,
  );
  const interview = store.interviews.find(
    (item) => item.id === meeting?.interviewId,
  );
  if (interview) {
    if (record.eventName.includes("started")) interview.status = "进行中";
    if (record.eventName.includes("ended")) interview.status = "待反馈";
    interview.updatedAt = new Date().toISOString();
  }
  save();
  return send(res, 200, { success: true, traceId });
});
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const raw = error instanceof Error ? error.message : "INTERNAL_ERROR";
    const known = new Set([
      "DATABASE_UNAVAILABLE",
      "IMPORT_FILE_INVALID",
      "IMPORT_FILE_TOO_LARGE",
      "IMPORT_ROW_LIMIT_EXCEEDED",
      "IMPORT_SHEET_NOT_FOUND",
      "IMPORT_MAPPING_INVALID",
      "IMPORT_VALIDATION_FAILED",
      "IMPORT_DUPLICATE_UNRESOLVED",
      "IMPORT_TASK_NOT_FOUND",
      "IMPORT_TASK_ALREADY_CONFIRMED",
      "CANDIDATE_NOT_FOUND",
      "CANDIDATE_CREATE_FAILED",
      "AUTO_DASHBOARD_FILE_INVALID",
      "AUTO_DASHBOARD_ROW_LIMIT_EXCEEDED",
      "AUTO_DASHBOARD_NO_RECOGNIZED_SHEETS",
      "AUTO_DASHBOARD_NO_DATA",
      "AUTO_DASHBOARD_NOT_FOUND",
      "AUTH_SUPPLIER_REQUIRED",
    ]);
    const multerTooLarge = raw === "File too large";
    const code = multerTooLarge
      ? "IMPORT_FILE_TOO_LARGE"
      : known.has(raw)
        ? raw
        : error instanceof z.ZodError
          ? "IMPORT_VALIDATION_FAILED"
          : "INTERNAL_ERROR";
    const status = code.endsWith("NOT_FOUND")
      ? 404
      : code === "IMPORT_TASK_ALREADY_CONFIRMED"
        ? 409
        : code === "AUTH_SUPPLIER_REQUIRED"
          ? 403
        : code === "DATABASE_UNAVAILABLE"
          ? 503
          : code === "INTERNAL_ERROR"
            ? 500
            : 400;
    if (code === "INTERNAL_ERROR") console.error("服务端请求失败：", raw);
    res.status(status).json({
      success: false,
      code,
      message:
        (
          {
            DATABASE_UNAVAILABLE:
              "数据库不可连接，请确认 PostgreSQL 已启动并检查服务端配置",
            IMPORT_FILE_INVALID: "文件类型无效，仅支持 Excel 或 CSV",
            IMPORT_FILE_TOO_LARGE: "导入文件超过大小限制",
            IMPORT_ROW_LIMIT_EXCEEDED: "导入行数超过限制",
            IMPORT_SHEET_NOT_FOUND: "工作表不存在或为空",
            IMPORT_MAPPING_INVALID: "字段映射无效，姓名、供应商和岗位为必填",
            IMPORT_VALIDATION_FAILED: "请求或导入数据校验失败",
            IMPORT_DUPLICATE_UNRESOLVED: "重复候选人尚未选择有效的处理目标",
            IMPORT_TASK_NOT_FOUND: "导入任务不存在",
            IMPORT_TASK_ALREADY_CONFIRMED: "导入任务已确认或正在执行",
            CANDIDATE_NOT_FOUND: "候选人不存在",
            AUTO_DASHBOARD_FILE_INVALID: "文件类型无效，仅支持 .xlsx、.xls 或 .csv",
            AUTO_DASHBOARD_ROW_LIMIT_EXCEEDED: "文件数据超过 10000 行限制",
            AUTO_DASHBOARD_NO_RECOGNIZED_SHEETS: "所有工作表均为空或无法识别",
            AUTO_DASHBOARD_NO_DATA: "工作表中没有可用于生成看板的数据",
            AUTO_DASHBOARD_NOT_FOUND: "招聘结果看板不存在",
            AUTH_SUPPLIER_REQUIRED: "供应商账号尚未绑定供应商",
            INTERNAL_ERROR: "服务暂时不可用，请稍后重试",
          } as Record<string, string>
        )[code] || "请求失败",
      requestId: res.locals.requestId,
    });
  },
);
const port = Number(process.env.PORT || process.env.SERVER_PORT || 3001);
assertDatabaseConnection()
  .then(ensureBootstrapAdmin)
  .then(() =>
    app.listen(port, () =>
      console.log(`招聘服务已启动：http://localhost:${port}`),
    ),
  )
  .catch((error: Error) => {
    console.error(
      error.message === "DATABASE_UNAVAILABLE"
        ? "数据库不可连接，请启动 PostgreSQL 并检查 DATABASE_URL（连接串不会输出）"
        : error.message,
    );
    process.exitCode = 1;
  });
setInterval(
  () =>
    scanAndSendInterviewReminders(store)
      .then(save)
      .catch((error: Error) => console.error("提醒扫描失败：", error.message)),
  60_000,
).unref();
setInterval(
  () =>
    cleanupExpiredImportFiles().catch((error: Error) =>
      console.error("导入临时文件清理失败：", error.message),
    ),
  24 * 60 * 60_000,
).unref();
process.on("SIGTERM", () => prisma.$disconnect());
