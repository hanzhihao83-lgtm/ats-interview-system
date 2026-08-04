import {
  AudioOutlined,
  BellOutlined,
  CalendarOutlined,
  DashboardOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SafetyOutlined,
  TeamOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  Layout,
  List,
  Menu,
  Result,
  Select,
  Space,
  Table,
  Typography,
  message,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { calendarApi } from "../api/calendarApi";
import { api, SIMULATED_SUPPLIER_KEY } from "../api/backend";
import { useAuth, type UserBusinessLine } from "../auth/AuthContext";
import { canAccessBusinessLine, canAccessCombinedRecruitment, defaultRecruitmentPath } from "../config/menuPermissions";
import type { BusinessLine } from "../types/businessLine";
import CandidateApplicationListPage from "./candidates/CandidateApplicationListPage";
import AudioDashboardPage from "./dashboard/AudioDashboardPage";
import CombinedDashboardPage from "./dashboard/CombinedDashboardPage";
import VideoDashboardPage from "./dashboard/VideoDashboardPage";
import BusinessInterviewPage from "./interviews/BusinessInterviewPage";
import InterviewerCalendarPage from "./interviews/InterviewerCalendarPage";
import BusinessScreeningPage from "./screening/BusinessScreeningPage";
import BusinessPageHeader from "../components/business/BusinessPageHeader";
import { businessDashboardApi } from "../api/businessDashboardApi";

const navigate = (path: string) => {
  history.pushState({}, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
};

function SupplierPage({ businessLine }: { businessLine?: BusinessLine }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    businessDashboardApi.suppliers(businessLine).then(setRows).catch((error) => message.error(error.message));
  }, [businessLine]);
  return <Card title="外包公司招聘贡献"><Table rowKey="supplierId" dataSource={rows} columns={[{ title: "外包公司", dataIndex: "supplier" }, { title: "全部候选人", dataIndex: "candidates" }, { title: "视频", dataIndex: "video" }, { title: "音频", dataIndex: "audio" }, { title: "面试通过", dataIndex: "passed" }, { title: "实际入职", dataIndex: "joined" }, { title: "异常", dataIndex: "abnormal" }]} /></Card>;
}

function BusinessContent({ path }: { path: string }) {
  if (path === "/calendar") return <InterviewerCalendarPage />;
  if (path === "/dashboard") return <CombinedDashboardPage />;
  if (path === "/candidates") return <><BusinessPageHeader businessLine="COMBINED" /><CandidateApplicationListPage /></>;
  if (path === "/interviews") return <><BusinessPageHeader businessLine="COMBINED" /><BusinessInterviewPage /></>;
  if (path === "/suppliers") return <><BusinessPageHeader businessLine="COMBINED" /><SupplierPage /></>;
  const match = path.match(/^\/(video|audio)\/(dashboard|candidates|screening|interviews|onboarding|risks|suppliers)$/);
  if (!match) return <Result status="404" title="页面不存在" extra={<Button onClick={() => navigate("/dashboard")}>返回看板</Button>} />;
  const line = match[1] === "video" ? "VIDEO" : "AUDIO";
  const page = match[2];
  if (page === "dashboard") return line === "VIDEO" ? <VideoDashboardPage /> : <AudioDashboardPage />;
  if (page === "screening") return <BusinessScreeningPage businessLine={line} />;
  if (page === "interviews") return <><BusinessPageHeader businessLine={line} /><BusinessInterviewPage businessLine={line} /></>;
  if (page === "onboarding") return <><BusinessPageHeader businessLine={line} /><CandidateApplicationListPage businessLine={line} status="待入职" /></>;
  if (page === "risks") return <><BusinessPageHeader businessLine={line} /><CandidateApplicationListPage businessLine={line} status="异常" /></>;
  if (page === "suppliers") return <><BusinessPageHeader businessLine={line} /><SupplierPage businessLine={line} /></>;
  return <><BusinessPageHeader businessLine={line} /><CandidateApplicationListPage businessLine={line} /></>;
}

export default function RecruitmentPortalPage() {
  const { user, logout, hasPermission } = useAuth();
  const [path, setPath] = useState(location.pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; businessLines: UserBusinessLine[] }>>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const sync = () => setPath(location.pathname);
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (user?.role === "PLATFORM_ADMIN") api<Array<{ id: string; name: string; businessLines: UserBusinessLine[] }>>("/api/auth/suppliers").then(setSuppliers).catch(() => undefined);
  }, [user?.role]);

  const loadNotifications = () => calendarApi.notifications().then((result) => {
    setNotifications(result.rows);
    setUnread(result.unread);
  }).catch(() => undefined);
  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(loadNotifications, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!user) return null;
  const effectiveLines = user.simulation?.businessLines || user.businessLines;
  const line = path.startsWith("/video/") ? "VIDEO" : path.startsWith("/audio/") ? "AUDIO" : null;
  const combinedPath = ["/dashboard", "/candidates", "/interviews", "/suppliers"].includes(path);
  if (
    (line && !canAccessBusinessLine(user.role, line, effectiveLines)) ||
    (combinedPath && !canAccessCombinedRecruitment(user.role, effectiveLines))
  ) {
    const target = defaultRecruitmentPath(user.role, effectiveLines);
    return <Result status="403" title="403" subTitle="当前账号无权访问此业务部门" extra={<Button type="primary" onClick={() => navigate(target)}>返回可访问页面</Button>} />;
  }

  const items = useMemo(() => {
    const menu: any[] = [];
    const canViewCandidates = hasPermission("CANDIDATE_VIEW");
    const canViewInterviews = hasPermission("INTERVIEW_VIEW") || user.role === "INTERVIEWER";
    if (canViewCandidates && canAccessCombinedRecruitment(user.role, effectiveLines)) {
      menu.push({
        key: "combined",
        icon: <DashboardOutlined />,
        label: "综合招聘",
        children: [
          { key: "/dashboard", label: "综合招聘看板" },
          { key: "/candidates", label: "全部候选人" },
          ...(canViewInterviews ? [{ key: "/interviews", label: "全部面试" }] : []),
          { key: "/suppliers", label: "外包公司总览" },
        ],
      });
    }
    const businessItems = (prefix: string, icon: ReactNode, title: string) => ({
      key: prefix,
      icon,
      label: title,
      children: [
        ...(canViewCandidates ? [
          { key: `/${prefix}/dashboard`, label: `${title}看板` },
          { key: `/${prefix}/candidates`, label: `${title}候选人` },
        ] : []),
        ...(hasPermission("SCREENING_SUBMIT") ? [{ key: `/${prefix}/screening`, label: "简历筛选" }] : []),
        ...(canViewInterviews ? [{ key: `/${prefix}/interviews`, label: "面试记录" }] : []),
        ...(canViewCandidates ? [
          { key: `/${prefix}/onboarding`, label: "待入职" },
          { key: `/${prefix}/risks`, label: "异常人员" },
          { key: `/${prefix}/suppliers`, label: "外包公司分析" },
        ] : []),
      ],
    });
    if (canAccessBusinessLine(user.role, "VIDEO", effectiveLines) && (canViewCandidates || canViewInterviews)) menu.push(businessItems("video", <VideoCameraOutlined />, "视频招聘"));
    if (canAccessBusinessLine(user.role, "AUDIO", effectiveLines) && (canViewCandidates || canViewInterviews)) menu.push(businessItems("audio", <AudioOutlined />, "音频招聘"));
    if (canViewInterviews) menu.unshift({ key: "/calendar", icon: <CalendarOutlined />, label: "面试官时间看板" });
    const systemChildren = [
      ...(!user.simulation && hasPermission("CANDIDATE_IMPORT") ? [{ key: "/auto-dashboard/upload", icon: <UploadOutlined />, label: "Excel 数据导入" }] : []),
      ...(!user.simulation && (user.role === "PLATFORM_ADMIN" || user.isSupplierManager) ? [{ key: "/admin/users", icon: <TeamOutlined />, label: "账号与权限" }] : []),
    ];
    if (systemChildren.length) menu.push({ key: "system", icon: <SafetyOutlined />, label: "系统功能", children: systemChildren });
    return menu;
  }, [effectiveLines, hasPermission, user.isSupplierManager, user.role]);

  const changeSimulation = async (supplierId?: string) => {
    localStorage.removeItem(SIMULATED_SUPPLIER_KEY);
    try {
      await api("/api/auth/simulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId: supplierId || null }),
      });
      if (supplierId) localStorage.setItem(SIMULATED_SUPPLIER_KEY, supplierId);
      const selected = suppliers.find((supplier) => supplier.id === supplierId);
      const target = supplierId
        ? defaultRecruitmentPath(user.role, selected?.businessLines)
        : defaultRecruitmentPath(user.role, user.businessLines);
      location.assign(target);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <Layout className="recruitment-portal">
      <Layout.Sider collapsible collapsed={collapsed} trigger={null} width={238}>
        <div className="portal-logo">{collapsed ? "招" : "招聘管理系统"}</div>
        <Menu theme="dark" mode="inline" selectedKeys={[path]} items={items} onClick={({ key }) => navigate(key)} />
      </Layout.Sider>
      <Layout>
        <Layout.Header className="portal-header">
          <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
          <Space wrap>
            {user.role === "PLATFORM_ADMIN" && (
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="模拟外包公司视角"
                value={user.simulation?.supplierId}
                onChange={(value) => void changeSimulation(value)}
                options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))}
                style={{ width: 210 }}
              />
            )}
            <Badge count={unread} size="small"><Button type="text" icon={<BellOutlined />} onClick={() => setNotificationOpen(true)} /></Badge>
            <Typography.Text>{user.name} · {user.simulation?.supplierName ? `模拟：${user.simulation.supplierName}` : user.supplierName || (user.role === "INTERVIEWER" ? "面试官" : "内部")}</Typography.Text>
            <Button icon={<LogoutOutlined />} onClick={() => void logout()}>退出</Button>
          </Space>
        </Layout.Header>
        {user.simulation && <Alert banner type="warning" showIcon message={`当前正以“${user.simulation.supplierName}”视角只读查看：所有修改操作均已禁用。`} />}
        <Layout.Content className="portal-content"><BusinessContent path={path} /></Layout.Content>
      </Layout>
      <Drawer title="站内通知" open={notificationOpen} onClose={() => setNotificationOpen(false)} width={430} extra={unread > 0 ? <Button onClick={() => void calendarApi.readAllNotifications().then(loadNotifications)}>全部已读</Button> : null}>
        <List
          dataSource={notifications}
          locale={{ emptyText: "暂无通知" }}
          renderItem={(item) => <List.Item onClick={() => !item.readAt && void calendarApi.readNotification(item.id).then(loadNotifications)} style={{ cursor: item.readAt ? "default" : "pointer" }}>
            <List.Item.Meta title={<Space><Badge status={item.readAt ? "default" : "processing"} /><Typography.Text strong={!item.readAt}>{item.title}</Typography.Text></Space>} description={<><div>{item.content}</div><Typography.Text type="secondary">{dayjs(item.createdAt).format("YYYY-MM-DD HH:mm")}</Typography.Text></>} />
          </List.Item>}
        />
      </Drawer>
    </Layout>
  );
}
