import { api, authorizedFetch } from "./backend";
import type { CandidateApplication } from "../types/candidateApplication";
export const applicationApi = {
  list: (params: URLSearchParams) => api<{ rows: CandidateApplication[]; pagination: { page: number; pageSize: number; total: number } }>(`/api/applications?${params}`),
  detail: (id: string, businessLine?: string) => api<CandidateApplication>(`/api/applications/${id}${businessLine ? `?businessLine=${businessLine}` : ""}`),
  export: (businessLine?: string) => authorizedFetch(`/api/exports/candidates${businessLine ? `?businessLine=${businessLine}` : ""}`),
};
