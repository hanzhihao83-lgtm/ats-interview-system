export const workflowStatuses = [
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
] as const;

export type WorkflowStatus = (typeof workflowStatuses)[number];

export const allowedWorkflowTransitions: Record<WorkflowStatus, WorkflowStatus[]> = {
  简历待筛选: ["简历未通过", "待安排面试", "候选人放弃"],
  简历未通过: [],
  待安排面试: ["待面试", "候选人放弃"],
  待面试: ["面试待反馈", "候选人放弃"],
  面试待反馈: ["待面试", "面试未通过", "面试通过", "候选人放弃"],
  面试未通过: [],
  面试通过: ["待确认入职", "候选人放弃"],
  待确认入职: ["待入职", "候选人放弃"],
  待入职: ["培训中", "候选人放弃", "异常"],
  培训中: ["培训未通过", "项目中", "已离职", "异常"],
  培训未通过: [],
  项目中: ["已离职", "异常"],
  候选人放弃: [],
  已离职: [],
  异常: ["待入职", "培训中", "项目中", "候选人放弃"],
};

export const isWorkflowStatus = (value: unknown): value is WorkflowStatus =>
  typeof value === "string" && workflowStatuses.includes(value as WorkflowStatus);

export function assertWorkflowStatus(value: unknown): asserts value is WorkflowStatus {
  if (!isWorkflowStatus(value)) throw new Error("APPLICATION_STATUS_INVALID");
}

export function assertWorkflowTransition(from: unknown, to: unknown) {
  assertWorkflowStatus(from);
  assertWorkflowStatus(to);
  if (from === to) return;
  if (!allowedWorkflowTransitions[from].includes(to))
    throw new Error("APPLICATION_STATUS_TRANSITION_INVALID");
}

export const defaultFeedbackDimensions = ["专业能力", "沟通能力", "岗位匹配度"] as const;

export function feedbackTemplateConfig(value: unknown) {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const configured = Array.isArray(candidate.dimensions)
    ? [...new Set(candidate.dimensions.map((item) => String(item).trim()).filter(Boolean))].slice(0, 10)
    : [];
  return {
    version: typeof candidate.version === "string" && candidate.version.trim()
      ? candidate.version.trim()
      : "default-v1",
    dimensions: configured.length ? configured : [...defaultFeedbackDimensions],
  };
}

export function assertFeedbackComplete(
  dimensionScores: Record<string, unknown>,
  comment: unknown,
  requiredDimensions: readonly string[] = defaultFeedbackDimensions,
) {
  if (!comment || String(comment).trim().length < 5)
    throw new Error("INTERVIEW_FEEDBACK_INCOMPLETE");
  for (const dimension of requiredDimensions) {
    const score = Number(dimensionScores[dimension]);
    if (!Number.isInteger(score) || score < 1 || score > 5)
      throw new Error("INTERVIEW_FEEDBACK_INCOMPLETE");
  }
}

export function feedbackDueAt(end: Date) {
  return new Date(end.getTime() + 24 * 60 * 60_000);
}

export function rangesOverlap(
  start: Date,
  end: Date,
  existingStart: Date,
  existingEnd: Date,
  bufferMinutes = 10,
) {
  if (end <= start) throw new Error("INTERVIEW_TIME_INVALID");
  const buffer = Math.max(0, bufferMinutes) * 60_000;
  return start.getTime() < existingEnd.getTime() + buffer && end.getTime() > existingStart.getTime() - buffer;
}
