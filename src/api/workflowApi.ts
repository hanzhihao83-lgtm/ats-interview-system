import { api } from "./backend";
import type { BusinessLine } from "../types/businessLine";

export type OfferStatus = "PENDING_INITIATION" | "SENT" | "CANDIDATE_CONFIRMED" | "REJECTED" | "EXPIRED";
export type LevelAdjustmentStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export interface WorkflowFeedback {
  id: string;
  status: "DRAFT" | "SUBMITTED" | "OVERDUE";
  templateVersion: string;
  dimensionScores: Record<string, number>;
  comment: string;
  dueAt: string;
  submittedByName?: string | null;
  submittedAt?: string | null;
}

export interface WorkflowInterview {
  id: string;
  round: number;
  roundName?: string | null;
  interviewer?: string | null;
  interviewerProfileId?: string | null;
  scheduledStartTime: string;
  scheduledEndTime?: string | null;
  feedbackDueAt?: string | null;
  status: string;
  meetingUrl?: string | null;
  feedbackRecord?: WorkflowFeedback | null;
}

export interface WorkflowOffer {
  id: string;
  status: OfferStatus;
  initiatedByName: string;
  sentByName?: string | null;
  sentAt?: string | null;
  candidateRespondedAt?: string | null;
  rejectedReason?: string | null;
  createdAt: string;
}

export interface WorkflowLevelAdjustment {
  id: string;
  requestedLevel: string;
  reason: string;
  status: LevelAdjustmentStatus;
  requestedByName: string;
  reviewedByName?: string | null;
  reviewComment?: string | null;
  createdAt: string;
}

export interface ReceptionChecklistItem {
  id: string;
  title: string;
  required: boolean;
  completed: boolean;
  completedByName?: string | null;
  completedAt?: string | null;
}

export interface WorkflowDetail {
  id: string;
  applicationNo: string;
  businessLine: BusinessLine | "UNCLASSIFIED";
  currentStatus: string;
  resumeResult?: string | null;
  interviewResult?: string | null;
  expectedEntryDate?: string | null;
  actualEntryDate?: string | null;
  candidate: { id: string; candidateNo: string; name: string; phone?: string | null; email?: string | null; phoneMasked?: string | null; emailMasked?: string | null };
  supplier: { id: string; name: string; code: string };
  position?: { id: string; name: string; feedbackTemplate?: unknown } | null;
  interviews: WorkflowInterview[];
  statusEvents: Array<{ id: string; fromStatus?: string | null; toStatus: string; operatorName: string; reason?: string | null; occurredAt: string }>;
  conclusion?: { finalResult: string; finalLevel?: string | null; decidedByName: string; decidedAt: string } | null;
  offers: WorkflowOffer[];
  levelAdjustments: WorkflowLevelAdjustment[];
  onboarding?: { result: string; entryDate?: string | null; confirmedByName: string; confirmedAt: string; note?: string | null } | null;
  receptionTask?: {
    id: string;
    status: string;
    assigneeName?: string | null;
    dueAt: string;
    completedAt?: string | null;
    checklist: ReceptionChecklistItem[];
  } | null;
  screeningResults: Array<{ id: string; score: number; recommendedLevel?: string | null; createdAt: string }>;
}

const jsonRequest = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const workflowApi = {
  detail: (id: string, businessLine?: string) =>
    api<WorkflowDetail>(`/api/workflow/applications/${id}${businessLine ? `?businessLine=${businessLine}` : ""}`),
  transition: (id: string, targetStatus: string, reason: string) =>
    api<WorkflowDetail>(`/api/applications/${id}/actions/transition`, jsonRequest("POST", { targetStatus, reason })),
  scheduleInterview: (id: string, body: { scheduledStartTime: string; scheduledEndTime: string; round: number; roundName: string; interviewerId: string }) =>
    api(`/api/applications/${id}/interviews`, jsonRequest("POST", body)),
  rescheduleInterview: (id: string, body: { scheduledStartTime: string; scheduledEndTime: string; interviewerId?: string; reason: string }) =>
    api(`/api/workflow/interviews/${id}/schedule`, jsonRequest("PUT", body)),
  cancelInterview: (id: string, reason: string) =>
    api(`/api/workflow/interviews/${id}/cancel`, jsonRequest("POST", { reason })),
  createSchedulingRequest: (id: string, body: { interviewer: string; round: number; roundName: string; slots: Array<{ start: string; end: string }>; expiresInHours?: number }) =>
    api<{ id: string; bookingUrl: string; expiresAt: string }>(`/api/applications/${id}/scheduling-requests`, jsonRequest("POST", body)),
  submitFeedback: (interviewId: string, body: { templateVersion: string; dimensionScores: Record<string, number>; comment: string }) =>
    api(`/api/workflow/interviews/${interviewId}/feedback`, jsonRequest("POST", body)),
  conclude: (id: string, body: { finalResult: "通过" | "不通过"; finalLevel?: string; reason: string }) =>
    api<WorkflowDetail>(`/api/applications/${id}/actions/conclude`, jsonRequest("POST", body)),
  createOffer: (id: string) => api<WorkflowOffer>(`/api/applications/${id}/offers`, jsonRequest("POST")),
  sendOffer: (id: string) => api<WorkflowOffer>(`/api/workflow/offers/${id}/actions/send`, jsonRequest("POST")),
  respondOffer: (id: string, response: "CONFIRMED" | "REJECTED", reason?: string) =>
    api<WorkflowOffer>(`/api/workflow/offers/${id}/actions/respond`, jsonRequest("POST", { response, reason })),
  expireOffer: (id: string) => api<WorkflowOffer>(`/api/workflow/offers/${id}/actions/expire`, jsonRequest("POST")),
  requestLevelAdjustment: (id: string, requestedLevel: string, reason: string) =>
    api(`/api/applications/${id}/level-adjustments`, jsonRequest("POST", { requestedLevel, reason })),
  reviewLevelAdjustment: (id: string, decision: "APPROVED" | "REJECTED", comment: string) =>
    api(`/api/workflow/level-adjustments/${id}/review`, jsonRequest("POST", { decision, comment })),
  confirmOnboarding: (id: string, body: { result: "CONFIRMED" | "DECLINED"; entryDate?: string; assigneeName?: string; note?: string }) =>
    api<WorkflowDetail>(`/api/applications/${id}/actions/confirm-onboarding`, jsonRequest("POST", body)),
  setReceptionAssignee: (id: string, assigneeName: string) =>
    api(`/api/reception-tasks/${id}/assignee`, jsonRequest("PUT", { assigneeName })),
  toggleChecklist: (taskId: string, itemId: string, completed: boolean) =>
    api(`/api/reception-tasks/${taskId}/checklist/${itemId}/toggle`, jsonRequest("POST", { completed })),
  completeReception: (id: string, actualEntryDate?: string) =>
    api(`/api/reception-tasks/${id}/actions/complete`, jsonRequest("POST", { actualEntryDate })),
};

export interface PublicSchedulingDetail {
  candidateName: string;
  positionName: string;
  supplierName: string;
  interviewer: string;
  roundName: string;
  expiresAt: string;
  slots: Array<{ index: number; start: string; end: string; available: boolean }>;
}

export const publicSchedulingApi = {
  detail: (token: string) => api<PublicSchedulingDetail>(`/api/public/interview-scheduling/${encodeURIComponent(token)}`),
  book: (token: string, slotIndex: number) => api<{ message: string; meeting?: { meetingUrl?: string } }>(`/api/public/interview-scheduling/${encodeURIComponent(token)}/book`, jsonRequest("POST", { slotIndex })),
};

export interface SavedFilter {
  id: string;
  module: string;
  name: string;
  filters: Record<string, unknown>;
  updatedAt: string;
}

export const screeningApi = {
  run: (applicationId: string) => api<any>(`/api/ai-screening/${applicationId}/run`, jsonRequest("POST")),
  list: (businessLine?: string) => api<any[]>(`/api/ai-screening${businessLine ? `?businessLine=${businessLine}` : ""}`),
  filters: () => api<SavedFilter[]>("/api/saved-filters?module=AI_SCREENING"),
  saveFilter: (name: string, filters: Record<string, unknown>) =>
    api<SavedFilter>("/api/saved-filters", jsonRequest("POST", { module: "AI_SCREENING", name, filters })),
  deleteFilter: (id: string) => api(`/api/saved-filters/${id}`, jsonRequest("DELETE")),
};
