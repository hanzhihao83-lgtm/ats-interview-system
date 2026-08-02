export interface ApiResponse<T> {
  success: boolean;
  data: T;
  code?: string;
  message?: string;
  requestId?: string;
}
const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export const apiUrl = (url: string) => `${apiBaseUrl}${url}`;
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), init);
  const body = (await response.json().catch(() => ({}))) as ApiResponse<T>;
  if (!response.ok || !body.success)
    throw new Error(body.message || body.code || "请求失败");
  return body.data;
}
export const candidateApi = {
  list: (params: URLSearchParams) =>
    api<{
      rows: unknown[];
      pagination: { page: number; pageSize: number; total: number };
    }>(`/api/candidates?${params}`),
  detail: (id: string) => api<unknown>(`/api/candidates/${id}`),
  update: (id: string, data: unknown) =>
    api<unknown>(`/api/candidates/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
};
export const dashboardApi = {
  overview: (params: URLSearchParams) =>
    api<Record<string, number>>(`/api/dashboard/overview?${params}`),
  funnel: (params: URLSearchParams) =>
    api<Record<string, number>>(`/api/dashboard/funnel?${params}`),
  vendors: (params: URLSearchParams) =>
    api<unknown[]>(`/api/dashboard/vendors?${params}`),
  risks: (params: URLSearchParams) =>
    api<Record<string, number>>(`/api/dashboard/risks?${params}`),
};

export const autoDashboardApi = {
  upload: async (file: File, uploadedBy?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (uploadedBy) form.append("uploadedBy", uploadedBy);
    return api<{ datasetId: string; dashboardId: string; processedSheets: number; candidateCount: number; supplierCount: number; warningCount: number; redirectUrl: string }>("/api/auto-dashboard/upload", { method: "POST", body: form });
  },
  detail: (id: string) => api<any>(`/api/auto-dashboard/${id}`),
  section: <T>(id: string, section: string, params = "") => api<T>(`/api/auto-dashboard/${id}/${section}${params}`),
};
