export interface ApiResponse<T> {
  success: boolean;
  data: T;
  code?: string;
  message?: string;
  requestId?: string;
}
const productionApiBaseUrl = "https://ats-recruitment-api-hanzhihao.onrender.com";
const apiBaseUrl = String(
  import.meta.env.PROD ? productionApiBaseUrl : import.meta.env.VITE_API_BASE_URL || "",
).replace(/\/$/, "");
export const AUTH_TOKEN_KEY = "recruitment_auth_token";
export const SIMULATED_SUPPLIER_KEY = "recruitment_simulated_supplier_id";
export const apiUrl = (url: string) => `${apiBaseUrl}${url}`;
export function authHeaders(headers?: HeadersInit) {
  const result = new Headers(headers || {}), token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) result.set("Authorization", `Bearer ${token}`);
  const simulatedSupplierId = localStorage.getItem(SIMULATED_SUPPLIER_KEY);
  if (simulatedSupplierId) result.set("X-Simulate-Supplier-Id", simulatedSupplierId);
  return result;
}
export const authorizedFetch = (url: string, init?: RequestInit) => fetch(apiUrl(url), { ...init, headers: authHeaders(init?.headers) });
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await authorizedFetch(url, init);
  const body = (await response.json().catch(() => ({}))) as ApiResponse<T>;
  if (response.status === 401 && url !== "/api/auth/login") window.dispatchEvent(new Event("auth:unauthorized"));
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
  upload: async (file: File, uploadedBy?: string, businessLine?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (uploadedBy) form.append("uploadedBy", uploadedBy);
    if (businessLine) form.append("businessLine", businessLine);
    return api<{ datasetId: string; dashboardId: string; processedSheets: number; candidateCount: number; supplierCount: number; warningCount: number; redirectUrl: string }>("/api/auto-dashboard/upload", { method: "POST", body: form });
  },
  detail: (id: string) => api<any>(`/api/auto-dashboard/${id}`),
  section: <T>(id: string, section: string, params = "") => api<T>(`/api/auto-dashboard/${id}/${section}${params}`),
};
