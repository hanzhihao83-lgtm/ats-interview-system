import { AudioOutlined, BarChartOutlined, CalendarOutlined, DashboardOutlined, FileSearchOutlined, HomeOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SafetyOutlined, TeamOutlined, UploadOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { Button, Card, Layout, Menu, Result, Space, Table, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { canAccessBusinessLine, canAccessCombinedRecruitment } from "../config/menuPermissions";
import type { BusinessLine } from "../types/businessLine";
import CombinedDashboardPage from "./dashboard/CombinedDashboardPage";
import VideoDashboardPage from "./dashboard/VideoDashboardPage";
import AudioDashboardPage from "./dashboard/AudioDashboardPage";
import CandidateApplicationListPage from "./candidates/CandidateApplicationListPage";
import BusinessInterviewPage from "./interviews/BusinessInterviewPage";
import BusinessPageHeader from "../components/business/BusinessPageHeader";
import { businessDashboardApi } from "../api/businessDashboardApi";
import { businessLineConfigs } from "../config/businessLineConfigs";

const navigate = (path: string) => { history.pushState({}, "", path); dispatchEvent(new PopStateEvent("popstate")); };
function SupplierPage({ businessLine }: { businessLine?: BusinessLine }) { const [rows, setRows] = useState<any[]>([]); useEffect(() => { businessDashboardApi.suppliers(businessLine).then(setRows); }, [businessLine]); return <Card title="供应商招聘贡献"><Table rowKey="supplierId" dataSource={rows} columns={[{ title: "供应商", dataIndex: "supplier" }, { title: "全部候选人", dataIndex: "candidates" }, { title: "视频", dataIndex: "video" }, { title: "音频", dataIndex: "audio" }, { title: "面试通过", dataIndex: "passed" }, { title: "实际入职", dataIndex: "joined" }, { title: "异常", dataIndex: "abnormal" }]} /></Card>; }
function ScreeningPage({ businessLine }: { businessLine: BusinessLine }) { const config = businessLineConfigs[businessLine]; return <><BusinessPageHeader businessLine={businessLine} /><Card title={config.screeningTitle}><Typography.Paragraph>AI 将按当前业务线的岗位规则进行辅助筛选，不会自动淘汰候选人。</Typography.Paragraph><Space wrap>{config.featureFields.map((field) => <Button key={field}>{field}</Button>)}</Space></Card><CandidateApplicationListPage businessLine={businessLine} /></>; }
function BusinessContent({ path }: { path: string }) {
  if (path === "/dashboard") return <CombinedDashboardPage />;
  if (path === "/candidates") return <><BusinessPageHeader businessLine="COMBINED" /><CandidateApplicationListPage /></>;
  if (path === "/interviews") return <><BusinessPageHeader businessLine="COMBINED" /><BusinessInterviewPage /></>;
  if (path === "/suppliers") return <><BusinessPageHeader businessLine="COMBINED" /><SupplierPage /></>;
  const match = path.match(/^\/(video|audio)\/(dashboard|candidates|screening|interviews|onboarding|risks|suppliers)$/);
  if (!match) return <Result status="404" title="页面不存在" extra={<Button onClick={() => navigate("/dashboard")}>返回看板</Button>} />;
  const line = match[1] === "video" ? "VIDEO" : "AUDIO", page = match[2];
  if (page === "dashboard") return line === "VIDEO" ? <VideoDashboardPage /> : <AudioDashboardPage />;
  if (page === "screening") return <ScreeningPage businessLine={line} />;
  if (page === "interviews") return <><BusinessPageHeader businessLine={line} /><BusinessInterviewPage businessLine={line} /></>;
  if (page === "onboarding") return <><BusinessPageHeader businessLine={line} /><CandidateApplicationListPage businessLine={line} status="待入职" /></>;
  if (page === "risks") return <><BusinessPageHeader businessLine={line} /><CandidateApplicationListPage businessLine={line} status="异常" /></>;
  if (page === "suppliers") return <><BusinessPageHeader businessLine={line} /><SupplierPage businessLine={line} /></>;
  return <><BusinessPageHeader businessLine={line} /><CandidateApplicationListPage businessLine={line} /></>;
}

export default function RecruitmentPortalPage() {
  const { user, logout } = useAuth(), [path, setPath] = useState(location.pathname), [collapsed, setCollapsed] = useState(false);
  useEffect(() => { const sync = () => setPath(location.pathname); addEventListener("popstate", sync); return () => removeEventListener("popstate", sync); }, []);
  if (!user) return null;
  const line = path.startsWith("/video/") ? "VIDEO" : path.startsWith("/audio/") ? "AUDIO" : null;
  if ((line && !canAccessBusinessLine(user.role, line)) || (!line && ["/dashboard", "/candidates", "/interviews", "/suppliers"].includes(path) && !canAccessCombinedRecruitment(user.role))) return <Result status="403" title="403" subTitle="当前账号无权访问此业务部门" extra={<Button type="primary" onClick={() => navigate(canAccessBusinessLine(user.role, "VIDEO") ? "/video/dashboard" : "/audio/dashboard")}>返回可访问看板</Button>} />;
  const items = useMemo(() => {
    const menu: any[] = [{ key: "/", icon: <HomeOutlined />, label: "工作台" }];
    if (canAccessCombinedRecruitment(user.role)) menu.push({ key: "combined", icon: <DashboardOutlined />, label: "综合招聘", children: [{ key: "/dashboard", label: "综合招聘看板" }, { key: "/candidates", label: "全部候选人" }, { key: "/interviews", label: "全部面试" }, { key: "/suppliers", label: "供应商总览" }] });
    const businessItems = (prefix: string, icon: any, title: string) => ({ key: prefix, icon, label: title, children: [{ key: `/${prefix}/dashboard`, label: `${title}看板` }, { key: `/${prefix}/candidates`, label: `${title}候选人` }, { key: `/${prefix}/screening`, label: "简历筛选" }, { key: `/${prefix}/interviews`, label: "面试排期" }, { key: `/${prefix}/onboarding`, label: "待入职" }, { key: `/${prefix}/risks`, label: "异常人员" }, { key: `/${prefix}/suppliers`, label: "供应商分析" }] });
    if (canAccessBusinessLine(user.role, "VIDEO")) menu.push(businessItems("video", <VideoCameraOutlined />, "视频招聘"));
    if (canAccessBusinessLine(user.role, "AUDIO")) menu.push(businessItems("audio", <AudioOutlined />, "音频招聘"));
    menu.push({ key: "system", icon: <SafetyOutlined />, label: "系统功能", children: [{ key: "/auto-dashboard/upload", icon: <UploadOutlined />, label: "Excel 数据导入" }, ...(user.role === "PLATFORM_ADMIN" || user.role === "SUPPLIER_ADMIN" ? [{ key: "/admin/users", icon: <TeamOutlined />, label: "用户管理" }] : [])] });
    return menu;
  }, [user.role]);
  return <Layout className="recruitment-portal"><Layout.Sider collapsible collapsed={collapsed} trigger={null} width={238}><div className="portal-logo">{collapsed ? "招" : "招聘管理系统"}</div><Menu theme="dark" mode="inline" selectedKeys={[path]} items={items} onClick={({ key }) => navigate(key)} /></Layout.Sider><Layout><Layout.Header className="portal-header"><Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} /><Space><Typography.Text>{user.name} · {user.supplierName || "内部"}</Typography.Text><Button icon={<LogoutOutlined />} onClick={() => void logout()}>退出</Button></Space></Layout.Header><Layout.Content className="portal-content"><BusinessContent path={path} /></Layout.Content></Layout></Layout>;
}
