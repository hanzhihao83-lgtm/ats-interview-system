import type { CandidateStatus } from "../types/recruitment";
export const allowedStatusTransitions: Record<CandidateStatus,CandidateStatus[]> = {
  "简历待筛选":["简历未通过","待安排面试"],"简历未通过":[],"待安排面试":["待面试","候选人放弃"],"待面试":["面试待反馈","面试未通过","候选人放弃"],"面试待反馈":["面试未通过","面试通过","候选人放弃"],"面试未通过":[],"面试通过":["待确认入职"],"待确认入职":["待入职","候选人放弃"],"待入职":["培训中","候选人放弃"],"培训中":["培训未通过","项目中"],"培训未通过":[],"项目中":["已离职"],"候选人放弃":[],"已离职":[],"异常":[]
};
export const canTransitionStatus=(from:CandidateStatus,to:CandidateStatus)=>allowedStatusTransitions[from]?.includes(to)??false;
