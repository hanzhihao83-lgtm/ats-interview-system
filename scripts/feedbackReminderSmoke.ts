import assert from "node:assert/strict";
import { prisma } from "../server/database.js";
import { scanOverdueFeedbackReminders } from "../server/workflowRouter.js";

const interviewId = process.env.SMOKE_INTERVIEW_ID || "demo-interview-demo-rr-v";
const interview = await prisma.interview.findUnique({
  where: { id: interviewId },
  include: { feedbackRecord: true },
});
if (!interview) throw new Error("SMOKE_INTERVIEW_NOT_FOUND");
if (interview.feedbackRecord) throw new Error("SMOKE_INTERVIEW_ALREADY_HAS_FEEDBACK");

const idempotencyKey = `feedback-overdue-${interviewId}`;
try {
  await prisma.interview.update({
    where: { id: interviewId },
    data: { feedbackDueAt: new Date(Date.now() - 60_000) },
  });
  const first = await scanOverdueFeedbackReminders();
  const second = await scanOverdueFeedbackReminders();
  const [feedback, notifications] = await Promise.all([
    prisma.interviewFeedback.findUnique({ where: { interviewId } }),
    prisma.kimNotificationLog.count({ where: { idempotencyKey } }),
  ]);
  assert.ok(first >= 1);
  assert.ok(second >= 1);
  assert.equal(feedback?.status, "OVERDUE");
  assert.equal(notifications, 1, "重复扫描必须只生成一条催办记录");
  console.log(JSON.stringify({ interviewId, feedbackStatus: feedback?.status, idempotentNotifications: notifications }));
} finally {
  await prisma.$transaction([
    prisma.kimNotificationLog.deleteMany({ where: { idempotencyKey } }),
    prisma.interviewFeedback.deleteMany({ where: { interviewId } }),
    prisma.interview.update({ where: { id: interviewId }, data: { feedbackDueAt: interview.feedbackDueAt } }),
  ]).catch(() => undefined);
  await prisma.$disconnect();
}
