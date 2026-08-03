import { Spin } from "antd";
import { useEffect, useState } from "react";
import App from "./App";
import { useAuth } from "./auth/AuthContext";
import LoginPage from "./pages/LoginPage";
import UserManagementPage from "./pages/UserManagementPage";

export default function AuthenticatedApp() {
  const { user, loading } = useAuth(); const [path, setPath] = useState(location.pathname);
  useEffect(() => { const update = () => setPath(location.pathname); addEventListener("popstate", update); return () => removeEventListener("popstate", update); }, []);
  if (loading) return <div className="auth-loading"><Spin size="large" /></div>;
  if (!user) return <LoginPage />;
  if (path === "/admin/users" && ["PLATFORM_ADMIN", "SUPPLIER_ADMIN"].includes(user.role)) return <UserManagementPage />;
  return <App />;
}
