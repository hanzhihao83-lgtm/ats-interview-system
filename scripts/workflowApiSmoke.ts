import assert from "node:assert/strict";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3301";
const password = process.env.SMOKE_PASSWORD;
if (!password) throw new Error("SMOKE_PASSWORD_REQUIRED");

let token = "";
async function request(path: string, init: RequestInit = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await response.json();
  assert.equal(response.status, expectedStatus, `${path}: ${JSON.stringify(body)}`);
  return body;
}

const post = (path: string, body: unknown, expectedStatus = 200) =>
  request(path, { method: "POST", body: JSON.stringify(body) }, expectedStatus);

const login = await post("/api/auth/login", {
  email: "admin@recruitment.local",
  password,
});
token = login.data.token;

const existing = await request("/api/applications?page=1&pageSize=1");
const reference = existing.data.rows[0];
assert.ok(reference?.supplier?.id && reference?.position?.id, "缺少可用于测试的供应商或岗位");

await post("/api/applications", {
  name: `越权状态测试-${Date.now()}`,
  phone: `138${String(Date.now()).slice(-8)}`,
  supplierId: reference.supplier.id,
  positionId: reference.position.id,
  businessLine: "VIDEO",
  currentStatus: "项目中",
}, 400);

const created = await post("/api/applications", {
  name: `闭环测试候选人-${Date.now()}`,
  phone: `139${String(Date.now()).slice(-8)}`,
  supplierId: reference.supplier.id,
  positionId: reference.position.id,
  businessLine: "VIDEO",
  currentStatus: "简历待筛选",
}, 201);
const applicationId = created.data.id as string;

await request(`/api/applications/${applicationId}`, {
  method: "PUT",
  body: JSON.stringify({ currentStatus: "项目中" }),
}, 400);

await post(`/api/applications/${applicationId}/actions/transition`, {
  targetStatus: "待安排面试",
  reason: "端到端测试：人工确认简历通过",
});

await post(`/api/applications/${applicationId}/actions/transition`, {
  targetStatus: "项目中",
  reason: "端到端测试：非法跳转",
}, 400);

const start = new Date(Date.now() + 7 * 24 * 60 * 60_000);
start.setUTCMinutes(0, 0, 0);
const end = new Date(start.getTime() + 60 * 60_000);
const interviewer = `冲突校验面试官-${Date.now()}`;
await post("/api/interviews", {
  applicationId,
  scheduledStartTime: start.toISOString(),
  scheduledEndTime: end.toISOString(),
  interviewer,
  status: "任意状态",
  result: "通过",
}, 400);
const scheduled = await post(`/api/applications/${applicationId}/interviews`, {
  scheduledStartTime: start.toISOString(),
  scheduledEndTime: end.toISOString(),
  round: 1,
  roundName: "业务初试",
  interviewer,
}, 201);
const interviewId = scheduled.data.interview.id as string;
assert.ok(scheduled.data.meeting?.meetingUrl, "未生成模拟会议记录");

await post(`/api/applications/${applicationId}/interviews`, {
  scheduledStartTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
  scheduledEndTime: new Date(end.getTime() + 30 * 60_000).toISOString(),
  round: 2,
  roundName: "冲突复试",
  interviewer,
}, 409);

await post(`/api/workflow/interviews/${interviewId}/feedback`, {
  templateVersion: "default-v1",
  dimensionScores: { 专业能力: 5, 沟通能力: 4 },
  comment: "缺少一个维度应当失败",
}, 400);

await post(`/api/workflow/interviews/${interviewId}/feedback`, {
  templateVersion: "default-v1",
  dimensionScores: { 专业能力: 5, 沟通能力: 4, 岗位匹配度: 5 },
  comment: "候选人的专业经验和岗位要求匹配，表达清晰。",
});

await post(`/api/applications/${applicationId}/actions/conclude`, {
  finalResult: "通过",
  reason: "端到端测试：面评完整且通过",
}, 400);

await post(`/api/applications/${applicationId}/actions/conclude`, {
  finalResult: "通过",
  finalLevel: "P5",
  reason: "端到端测试：面评完整且通过",
});

const offer = await post(`/api/applications/${applicationId}/offers`, {}, 201);
await post(`/api/applications/${applicationId}/offers`, {}, 409);
await post(`/api/workflow/offers/${offer.data.id}/actions/send`, {});
await post(`/api/workflow/offers/${offer.data.id}/actions/respond`, { response: "CONFIRMED" });

const onboarding = await post(`/api/applications/${applicationId}/actions/confirm-onboarding`, {
  result: "CONFIRMED",
  entryDate: new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString(),
  assigneeName: "端到端接待同学",
  note: "已与候选人确认",
});
const receptionTask = onboarding.data.receptionTask;
assert.equal(receptionTask.checklist.length, 4);

await post(`/api/reception-tasks/${receptionTask.id}/actions/complete`, {}, 409);
for (const item of receptionTask.checklist) {
  await post(`/api/reception-tasks/${receptionTask.id}/checklist/${item.id}/toggle`, { completed: true });
}
await post(`/api/reception-tasks/${receptionTask.id}/actions/complete`, {});

const finalDetail = await request(`/api/workflow/applications/${applicationId}`);
assert.equal(finalDetail.data.currentStatus, "培训中");
assert.equal(finalDetail.data.offers[0].status, "CANDIDATE_CONFIRMED");
assert.equal(finalDetail.data.receptionTask.status, "COMPLETED");
assert.ok(finalDetail.data.statusEvents.length >= 6);
assert.ok(finalDetail.data.statusEvents.every((event: { operatorName: string }) => event.operatorName === "平台管理员"));

const selfServiceApplication = await post("/api/applications", {
  name: `自助约面候选人-${Date.now()}`,
  phone: `137${String(Date.now()).slice(-8)}`,
  supplierId: reference.supplier.id,
  positionId: reference.position.id,
  businessLine: "VIDEO",
  currentStatus: "简历待筛选",
}, 201);
await post(`/api/applications/${selfServiceApplication.data.id}/actions/transition`, {
  targetStatus: "待安排面试",
  reason: "端到端测试：进入自助约面",
});
const selfServiceStart = new Date(Date.now() + 9 * 24 * 60 * 60_000);
selfServiceStart.setUTCMinutes(0, 0, 0);
const selfServiceInterviewer = `自助约面面试官-${Date.now()}`;
const invitation = await post(`/api/applications/${selfServiceApplication.data.id}/scheduling-requests`, {
  interviewer: selfServiceInterviewer,
  round: 1,
  roundName: "候选人自选初试",
  slots: [0, 2, 4].map((hours) => ({
    start: new Date(selfServiceStart.getTime() + hours * 60 * 60_000).toISOString(),
    end: new Date(selfServiceStart.getTime() + (hours + 1) * 60 * 60_000).toISOString(),
  })),
}, 201);
const bookingToken = new URL(invitation.data.bookingUrl).pathname.split("/").pop()!;
const adminToken = token;
token = "";
const publicSlots = await request(`/api/public/interview-scheduling/${bookingToken}`);
assert.equal(publicSlots.data.slots.filter((slot: { available: boolean }) => slot.available).length, 3);
const publicBooked = await post(`/api/public/interview-scheduling/${bookingToken}/book`, { slotIndex: 1 }, 201);
assert.ok(publicBooked.data.interview.id);
await post(`/api/public/interview-scheduling/${bookingToken}/book`, { slotIndex: 1 }, 409);
token = adminToken;
const selfServiceDetail = await request(`/api/workflow/applications/${selfServiceApplication.data.id}`);
assert.equal(selfServiceDetail.data.currentStatus, "待面试");
assert.ok(selfServiceDetail.data.statusEvents.some((event: { operatorName: string }) => event.operatorName === "候选人自助预约"));

console.log(JSON.stringify({
  applicationId,
  interviewId,
  checks: [
    "初始状态与直接写状态被拦截",
    "非法跨节点流转被拦截",
    "通用面试写接口被关闭，必须使用流程动作",
    "面试官冲突时段被拦截",
    "不完整面评和无定级通过被拦截",
    "Offer 状态机闭环",
    "入职确认自动生成四项接待清单",
    "清单未完成禁止回执，完成后进入培训中",
    "状态事件使用登录账号留痕",
    "一次性公开链接支持候选人自助选时段并回写，重复提交被拦截",
  ],
}, null, 2));
