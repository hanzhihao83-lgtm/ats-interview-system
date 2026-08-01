import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterviewReminderTasks, defaultReminderSettings, scanAndSendInterviewReminders } from "./interviewReminderService.mjs";
import { createKimClient, kimConfig } from "./kimClient.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)); const dataDir = path.join(root, "../data"); fs.mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, "kim-interviews.json");
const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { interviews: [], tasks: [], logs: [] };
const save = () => fs.writeFileSync(file, JSON.stringify(store, null, 2));
const json = (response, status, body) => { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": process.env.FRONTEND_ORIGIN || "http://localhost:5173" }); response.end(JSON.stringify(body)); };
const readBody = (request) => new Promise((resolve, reject) => { let data = ""; request.on("data", (chunk) => { data += chunk; if (data.length > 1024 * 1024) reject(new Error("请求体过大")); }); request.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("请求格式错误")); } }); });
const mergeTasks = (tasks) => { const keys = new Set(store.tasks.map((task) => task.idempotencyKey)); tasks.forEach((task) => { if (!keys.has(task.idempotencyKey)) { store.tasks.push(task); keys.add(task.idempotencyKey); } }); };
const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") return json(response, 204, {});
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/api/kim/status") return json(response, 200, { success: true, configured: createKimClient().configured, mode: kimConfig().mode, message: createKimClient().configured ? "Kim已配置" : "Kim机器人尚未配置" });
    if (request.method === "GET" && url.pathname === "/api/interviews") return json(response, 200, { success: true, data: store.interviews, tasks: store.tasks.map(({ id, interviewId, type, scheduledAt, status, attemptCount, failureReason }) => ({ id, interviewId, type, scheduledAt, status, attemptCount, failureReason })) });
    if (request.method === "GET" && url.pathname === "/api/interview-reminders") return json(response, 200, { success: true, data: store.tasks });
    if (request.method === "POST" && url.pathname === "/api/interviews") { const body = await readBody(request); const interview = { ...body, id: body.id || `INT-${Date.now()}`, status: body.status || "已安排", result: body.result || "待反馈", timezone: body.timezone || "Asia/Shanghai", reminderSettings: { ...defaultReminderSettings, ...(body.reminderSettings || {}) }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; store.interviews.push(interview); mergeTasks(createInterviewReminderTasks(interview)); save(); return json(response, 201, { success: true, data: interview, reminderCount: store.tasks.filter((task) => task.interviewId === interview.id).length }); }
    if (request.method === "POST" && url.pathname === "/api/kim/interview-reminders/test") { const body = await readBody(request); const result = await createKimClient().sendMessage({ webhookUrl: body.webhookUrl }, { type: "markdown", title: "Kim接入测试", content: body.content || "Kim面试提醒接入测试成功" }); return json(response, result.success ? 200 : 503, { success: result.success, code: result.code, message: result.message, requestId: result.requestId }); }
    if (request.method === "POST" && url.pathname === "/api/interview-reminders/scan") { await scanAndSendInterviewReminders(store); save(); return json(response, 200, { success: true, pending: store.tasks.filter((task) => task.status === "pending").length }); }
    if (request.method === "POST" && url.pathname.startsWith("/api/interviews/") && url.pathname.endsWith("/cancel")) { const interview = store.interviews.find((item) => item.id === url.pathname.split("/")[3]); if (!interview) return json(response, 404, { success: false, code: "INTERVIEW_NOT_FOUND", message: "面试不存在" }); const body = await readBody(request); interview.status = "已取消"; interview.result = "取消"; interview.cancelReason = body.reason || "未填写原因"; interview.updatedAt = new Date().toISOString(); store.tasks.filter((task) => task.interviewId === interview.id && task.status === "pending").forEach((task) => { task.status = "cancelled"; }); save(); return json(response, 200, { success: true, data: interview }); }
    json(response, 404, { success: false, code: "INTERNAL_ERROR", message: "接口不存在" });
  } catch (error) { json(response, 400, { success: false, code: "INTERNAL_ERROR", message: error.message || "请求失败" }); }
});
const port = Number(process.env.SERVER_PORT || 3001); server.listen(port, () => console.log(`招聘提醒服务已启动：http://localhost:${port}`));
const interval = setInterval(() => scanAndSendInterviewReminders(store).then(save).catch((error) => console.error("提醒扫描失败：", error.message)), 60000); process.on("SIGINT", () => { clearInterval(interval); save(); server.close(); });
