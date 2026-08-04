import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFeedbackComplete,
  assertWorkflowTransition,
  feedbackTemplateConfig,
  feedbackDueAt,
  rangesOverlap,
} from "./workflowService.js";

test("工作流只允许白名单状态迁移", () => {
  assert.doesNotThrow(() => assertWorkflowTransition("简历待筛选", "待安排面试"));
  assert.doesNotThrow(() => assertWorkflowTransition("面试待反馈", "面试通过"));
  assert.doesNotThrow(() => assertWorkflowTransition("面试待反馈", "待面试"));
  assert.throws(
    () => assertWorkflowTransition("简历待筛选", "项目中"),
    /APPLICATION_STATUS_TRANSITION_INVALID/,
  );
  assert.throws(
    () => assertWorkflowTransition("任意伪造状态", "项目中"),
    /APPLICATION_STATUS_INVALID/,
  );
});

test("结构化面评要求三个维度完整且评语有效", () => {
  assert.doesNotThrow(() => assertFeedbackComplete(
    { 专业能力: 5, 沟通能力: 4, 岗位匹配度: 4 },
    "候选人能清楚说明项目经验",
  ));
  assert.throws(
    () => assertFeedbackComplete({ 专业能力: 5, 沟通能力: 4 }, "内容完整但少一项"),
    /INTERVIEW_FEEDBACK_INCOMPLETE/,
  );
  assert.throws(
    () => assertFeedbackComplete({ 专业能力: 6, 沟通能力: 4, 岗位匹配度: 4 }, "评分越界应拦截"),
    /INTERVIEW_FEEDBACK_INCOMPLETE/,
  );
  assert.throws(
    () => assertFeedbackComplete({ 专业能力: 5, 沟通能力: 4, 岗位匹配度: 4 }, "太短"),
    /INTERVIEW_FEEDBACK_INCOMPLETE/,
  );
});

test("面试时间冲突包含十分钟缓冲时间", () => {
  const existingStart = new Date("2026-08-04T02:00:00.000Z");
  const existingEnd = new Date("2026-08-04T03:00:00.000Z");
  assert.equal(rangesOverlap(
    new Date("2026-08-04T02:30:00.000Z"),
    new Date("2026-08-04T03:30:00.000Z"),
    existingStart,
    existingEnd,
  ), true);
  assert.equal(rangesOverlap(
    new Date("2026-08-04T03:05:00.000Z"),
    new Date("2026-08-04T04:00:00.000Z"),
    existingStart,
    existingEnd,
  ), true);
  assert.equal(rangesOverlap(
    new Date("2026-08-04T03:10:00.000Z"),
    new Date("2026-08-04T04:00:00.000Z"),
    existingStart,
    existingEnd,
  ), false);
  assert.throws(
    () => rangesOverlap(existingEnd, existingStart, existingStart, existingEnd),
    /INTERVIEW_TIME_INVALID/,
  );
});

test("面评截止时间为面试结束后 24 小时", () => {
  const end = new Date("2026-08-04T10:00:00.000Z");
  assert.equal(feedbackDueAt(end).toISOString(), "2026-08-05T10:00:00.000Z");
});

test("岗位可以配置独立面评维度并自动去重", () => {
  const template = feedbackTemplateConfig({ version: "video-v2", dimensions: ["镜头语言", "内容理解", "镜头语言"] });
  assert.deepEqual(template, { version: "video-v2", dimensions: ["镜头语言", "内容理解"] });
  assert.doesNotThrow(() => assertFeedbackComplete({ 镜头语言: 5, 内容理解: 4 }, "岗位维度评分完整", template.dimensions));
  assert.throws(() => assertFeedbackComplete({ 镜头语言: 5 }, "岗位维度缺失应失败", template.dimensions), /INTERVIEW_FEEDBACK_INCOMPLETE/);
});
