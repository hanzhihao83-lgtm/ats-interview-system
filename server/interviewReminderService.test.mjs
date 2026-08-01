import assert from "node:assert/strict";
import { createInterviewReminderTasks } from "./interviewReminderService.mjs";

const now = new Date("2026-08-01T00:00:00+08:00");
const interview = { id: "I-TEST", candidateId: "C-TEST", candidateName: "测试候选人", vendor: "人瑞", project: "多模态数据项目", position: "视频评测工程师", roundName: "第一轮", startTime: "2026-08-03T14:00:00+08:00", interviewer: "Kim", interviewType: "腾讯会议", reminderSettings: { reminder30Minutes: false } };
const tasks = createInterviewReminderTasks(interview, now);
assert.equal(tasks.filter((task) => task.status === "pending").length, 3);
assert.equal(tasks.some((task) => task.type === "before_24_hours"), true);
assert.equal(tasks.some((task) => task.type === "before_2_hours"), true);
assert.equal(tasks.some((task) => task.type === "before_30_minutes"), false);
assert.equal(new Set(tasks.map((task) => task.idempotencyKey)).size, tasks.length);
console.log("面试提醒任务测试通过");
