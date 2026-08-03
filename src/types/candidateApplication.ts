import type { BusinessLine } from "./businessLine";

export interface CandidateApplication {
  id: string;
  applicationNo: string;
  businessLine: BusinessLine | "UNCLASSIFIED";
  currentStatus: string;
  resumeResult?: string | null;
  interviewResult?: string | null;
  expectedEntryDate?: string | null;
  actualEntryDate?: string | null;
  candidate: { id: string; name: string; phoneMasked?: string | null; emailMasked?: string | null };
  supplier: { id: string; name: string };
  position?: { id: string; name: string } | null;
  interviews?: Array<{ id: string; scheduledStartTime: string; result?: string | null; interviewer?: string | null }>;
}
