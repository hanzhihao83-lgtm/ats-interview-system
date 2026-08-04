import { api } from "./backend";
export const businessDashboardApi = {
  overview: (line?: string) => api<Record<string, number>>(`/api/dashboard/overview${line ? `?businessLine=${line}` : ""}`),
  funnel: (line?: string) => api<any>(`/api/dashboard/funnel${line ? `?businessLine=${line}` : ""}`),
  suppliers: (line?: string) => api<any[]>(`/api/dashboard/suppliers${line ? `?businessLine=${line}` : ""}`),
  trends: (line?: string, days = 30) => api<any[]>(`/api/dashboard/trends?days=${days}${line ? `&businessLine=${line}` : ""}`),
  risks: (line?: string) => api<Record<string, number>>(`/api/dashboard/risks${line ? `?businessLine=${line}` : ""}`),
  duplicateRisks: () => api<{ total: number; rows: Array<{ kind: "PHONE" | "EMAIL"; key: string; supplierCount: number; candidateCount: number; suppliers: string[]; candidates: string[] }> }>("/api/dashboard/duplicate-risks"),
};
