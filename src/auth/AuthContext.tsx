import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, AUTH_TOKEN_KEY } from "../api/backend";

export type UserRole = "PLATFORM_ADMIN" | "DEPARTMENT_MANAGER" | "INTERNAL_RECRUITER" | "VIDEO_RECRUITER" | "AUDIO_RECRUITER" | "SUPPLIER_ADMIN" | "SUPPLIER_VIDEO_RECRUITER" | "SUPPLIER_AUDIO_RECRUITER" | "SUPPLIER_RECRUITER" | "INTERVIEWER";
export type FeaturePermission =
  | "CANDIDATE_VIEW" | "CANDIDATE_CREATE" | "CANDIDATE_IMPORT" | "CANDIDATE_EDIT"
  | "CANDIDATE_CONTACT_VIEW" | "SCREENING_SUBMIT" | "INTERVIEW_VIEW" | "INTERVIEW_SCHEDULE"
  | "FEEDBACK_VIEW" | "FEEDBACK_SUBMIT" | "LEVEL_ADJUSTMENT_REQUEST" | "OFFER_MANAGE"
  | "ONBOARDING_CONFIRM" | "RECEPTION_VIEW" | "DATA_EXPORT" | "SUPPLIER_ACCOUNT_MANAGE";
export type UserBusinessLine = "VIDEO" | "AUDIO";
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  supplierId: string | null;
  supplierName: string | null;
  isSupplierManager: boolean;
  permissions: FeaturePermission[];
  businessLines: UserBusinessLine[];
  kimUserId: string | null;
  interviewerProfileId: string | null;
  simulation: {
    supplierId: string;
    supplierName: string;
    permissions: FeaturePermission[];
    businessLines: UserBusinessLine[];
  } | null;
}
interface AuthValue { user: CurrentUser | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; hasPermission: (permission: FeaturePermission) => boolean }
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
    logout: async () => { localStorage.removeItem("recruitment_simulated_supplier_id"); try { await api("/api/auth/logout", { method: "POST" }); } finally { localStorage.removeItem(AUTH_TOKEN_KEY); setUser(null); } },
    hasPermission: (permission) => {
      if (!user) return false;
      return user.simulation
        ? user.simulation.permissions.includes(permission)
        : user.role === "PLATFORM_ADMIN" || user.permissions.includes(permission);
    },
  }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error("AuthProvider missing"); return value; }
export const isSupplierRole = (role?: UserRole) => ["SUPPLIER_ADMIN", "SUPPLIER_VIDEO_RECRUITER", "SUPPLIER_AUDIO_RECRUITER", "SUPPLIER_RECRUITER"].includes(role || "");
export const roleLabels: Record<UserRole, string> = { PLATFORM_ADMIN: "平台管理员", DEPARTMENT_MANAGER: "大部门负责人", INTERNAL_RECRUITER: "内部招聘人员", VIDEO_RECRUITER: "视频招聘人员", AUDIO_RECRUITER: "音频招聘人员", SUPPLIER_ADMIN: "外包公司负责人", SUPPLIER_VIDEO_RECRUITER: "外包公司视频专员（兼容）", SUPPLIER_AUDIO_RECRUITER: "外包公司音频专员（兼容）", SUPPLIER_RECRUITER: "外包公司招聘账号", INTERVIEWER: "面试官" };
