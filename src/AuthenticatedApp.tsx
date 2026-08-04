import { Spin } from "antd";
import { useEffect, useState } from "react";
import App from "./App";
import { useAuth } from "./auth/AuthContext";
import LoginPage from "./pages/LoginPage";
import UserManagementPage from "./pages/UserManagementPage";
import RecruitmentPortalPage from "./pages/RecruitmentPortalPage";
import { defaultRecruitmentPath } from "./config/menuPermissions";

export default function AuthenticatedApp() {
  const { user, loading } = useAuth(); const [path, setPath] = useState(location.pathname);
  useEffect(() => { const update = () => setPath(location.pathname); addEventListener("popstate", update); return () => removeEventListener("popstate", update); }, []);
  useEffect(() => {
    if (user && path === "/") {
      const target = defaultRecruitmentPath(user.role, user.simulation?.businessLines || user.businessLines);
      history.replaceState({}, "", target);
      setPath(target);
    }
  }, [user, path]);
  if (loading) return <div className="auth-loading"><Spin size="large" /></div>;
  if (!user) return <LoginPage />;
  if (path === "/") return <div className="auth-loading"><Spin size="large" /></div>;
  if (path === "/admin/users" && !user.simulation && (user.role === "PLATFORM_ADMIN" || user.isSupplierManager)) return <UserManagementPage />;
  if (path === "/403" || path === "/calendar" || ["/dashboard", "/candidates", "/interviews", "/suppliers"].includes(path) || /^\/(video|audio)\//.test(path)) return <RecruitmentPortalPage />;
  return <App />;
}
