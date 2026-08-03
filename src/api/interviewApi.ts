import { api } from "./backend";
export const interviewApi = { list: (businessLine?: string) => api<{ rows: any[]; pagination: { total: number } }>(`/api/interviews?pageSize=100${businessLine ? `&businessLine=${businessLine}` : ""}`) };
