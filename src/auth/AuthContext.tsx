import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, AUTH_TOKEN_KEY } from "../api/backend";

export type UserRole = "PLATFORM_ADMIN" | "INTERNAL_RECRUITER" | "SUPPLIER_ADMIN" | "SUPPLIER_RECRUITER";
export interface CurrentUser { id: string; email: string; name: string; role: UserRole; supplierId: string | null; supplierName: string | null }
interface AuthValue { user: CurrentUser | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void> }
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(Boolean(localStorage.getItem(AUTH_TOKEN_KEY)));
  useEffect(() => {
    const unauthorized = () => { localStorage.removeItem(AUTH_TOKEN_KEY); setUser(null); setLoading(false); };
    window.addEventListener("auth:unauthorized", unauthorized);
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) api<CurrentUser>("/api/auth/me").then(setUser).catch(unauthorized).finally(() => setLoading(false));
    return () => window.removeEventListener("auth:unauthorized", unauthorized);
  }, []);
  const value = useMemo<AuthValue>(() => ({
    user, loading,
    login: async (email, password) => {
      const result = await api<{ token: string; user: CurrentUser }>("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      localStorage.setItem(AUTH_TOKEN_KEY, result.token); setUser(result.user);
    },
    logout: async () => { try { await api("/api/auth/logout", { method: "POST" }); } finally { localStorage.removeItem(AUTH_TOKEN_KEY); setUser(null); } },
  }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error("AuthProvider missing"); return value; }
export const isSupplierRole = (role?: UserRole) => role === "SUPPLIER_ADMIN" || role === "SUPPLIER_RECRUITER";
export const roleLabels: Record<UserRole, string> = { PLATFORM_ADMIN: "平台管理员", INTERNAL_RECRUITER: "内部招聘人员", SUPPLIER_ADMIN: "供应商管理员", SUPPLIER_RECRUITER: "供应商招聘人员" };
