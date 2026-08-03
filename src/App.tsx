import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  Layout,
  List,
  Modal,
  Progress,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CopyOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  UploadOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import dayjs, { Dayjs } from "dayjs";
import ReactECharts from "echarts-for-react";
import type {
  Candidate,
  CandidateStatus,
  OperationLog,
} from "./types/recruitment";
import { api, authorizedFetch, dashboardApi } from "./api/backend";
import {
  allowedStatusTransitions,
  canTransitionStatus,
} from "./config/statusFlow";
import { getCandidateStatusAtDate } from "./utils/historicalStatus";
import {
  calculateFunnelData,
  calculateOverviewMetrics,
  detectRisks,
  filterCandidates,
  maskPhone,
} from "./utils/statistics";
import { detectDuplicateCandidate } from "./utils/duplicateDetection";
import {
  generateRecruitmentTodos,
  type RecruitmentTodo,
} from "./utils/todoGenerator";
import { validateCandidateConsistency } from "./utils/consistencyValidation";
import { calculateVendorPerformance } from "./utils/vendorPerformance";
import { generateDailyReport } from "./utils/report";
import { exportDashboardExcel } from "./utils/exportExcel";
import { buildRecruitmentSummaryRows } from "./utils/recruitmentSummary";
import ResumeScreeningPage from "./pages/ResumeScreeningPage";
import InterviewBookingButton from "./components/InterviewBookingButton";
import CandidateImportPage from "./pages/CandidateImportPage";
import AutoDashboardUploadPage from "./pages/AutoDashboardUploadPage";
import RecruitmentResultDashboardPage from "./pages/RecruitmentResultDashboardPage";
import { isSupplierRole, roleLabels, useAuth } from "./auth/AuthContext";

class ImportPageErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("PDF 简历导入页面渲染失败", error);
  }
  render() {
    if (this.state.error)
      return (
        <div className="content import-page">
          <Alert
            type="error"
            showIcon
            message="PDF 简历导入页面加载失败"
            description={`请刷新页面后重试：${this.state.error.message || "未知错误"}`}
          />
        </div>
      );
    return this.props.children;
  }
}

const { Header, Content } = Layout;
const vendors = ["全部供应商", "人瑞", "供应商B", "供应商C", "供应商D"];
const positions = [
  "全部岗位",
  "AI 数据标注员",
  "AI 数据质检员",
  "视频评测工程师",
  "Caption 标注员",
  "项目助理",
];
const statuses: CandidateStatus[] = [
  "简历待筛选",
  "简历未通过",
  "待安排面试",
  "待面试",
  "面试待反馈",
  "面试未通过",
  "面试通过",
  "待确认入职",
  "待入职",
  "培训中",
  "培训未通过",
  "项目中",
  "候选人放弃",
  "已离职",
  "异常",
];
const statusColor: Record<string, string> = {
  项目中: "green",
  培训中: "gold",
  培训未通过: "red",
  待入职: "purple",
  待面试: "blue",
  面试待反馈: "orange",
  面试通过: "cyan",
  面试未通过: "red",
  简历未通过: "red",
  候选人放弃: "default",
  异常: "red",
  简历待筛选: "default",
  待安排面试: "geekblue",
  待确认入职: "purple",
  已离职: "default",
};
const toCandidate = (row: any): Candidate => ({
  id: row.id,
  name: row.name,
  phone: row.phoneMasked || "",
  vendor: row.supplier?.name || "—",
  project: row.projectName || "—",
  position: row.position?.name || "—",
  resumeSubmitDate: row.resumeSubmitDate?.slice(0, 10) || "",
  resumeResult: row.resumeResult || "待筛选",
  interviewScheduled: false,
  interviews: [],
  offerConfirmed: ["待入职", "培训中", "项目中"].includes(row.currentStatus),
  expectedEntryDate: row.expectedEntryDate?.slice(0, 10),
  actualEntryDate: row.actualEntryDate?.slice(0, 10),
  leaveDate: row.leaveDate?.slice(0, 10),
  currentStatus: row.currentStatus,
  updatedAt: row.updatedAt?.slice(0, 16).replace("T", " ") || "",
  updatedBy: "数据库",
  timeline: [],
  statusEvents: [],
  operationLogs: [],
});

export default function App() {
  const { user, logout } = useAuth();
  const [pathname, setPathname] = useState(window.location.pathname);
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [vendor, setVendor] = useState("全部供应商");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [position, setPosition] = useState("全部岗位");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Candidate[]>([]);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [serverMetrics, setServerMetrics] = useState<Record<string, number>>(
    {},
  );
  const [serverFunnel, setServerFunnel] = useState<Record<string, number>>({});
  const [serverRisk, setServerRisk] = useState<Record<string, number>>({});
  const [serverVendors, setServerVendors] = useState<
    ReturnType<typeof calculateVendorPerformance>
  >([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [performanceVendor, setPerformanceVendor] = useState<string | null>(
    null,
  );
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusForm] = Form.useForm();
  const [todoFilter, setTodoFilter] = useState("全部");
  const [completedTodos, setCompletedTodos] = useState<string[]>([]);
  const [screeningOpen, setScreeningOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [detailView, setDetailView] = useState<"candidate" | "summary">(
    "candidate",
  );
  const dateText = date.format("YYYY-MM-DD");
  const visibleVendors = isSupplierRole(user?.role) && user?.supplierName ? [user.supplierName] : vendors;
  const loadCandidates = useCallback(
    async (page = 1) => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      });
      if (search) params.set("keyword", search);
      if (vendor !== "全部供应商") params.set("supplier", vendor);
      if (position !== "全部岗位") params.set("position", position);
      if (statusFilter[0]) params.set("currentStatus", statusFilter[0]);
      setCandidateLoading(true);
      setCandidateError("");
      try {
        const result = await api<{
          rows: any[];
          pagination: { total: number };
        }>(`/api/candidates?${params}`);
        setRows(result.rows.map(toCandidate));
        setCandidateTotal(result.pagination.total);
        setCandidatePage(page);
      } catch (error) {
        setCandidateError((error as Error).message);
      } finally {
        setCandidateLoading(false);
      }
    },
    [search, vendor, position, statusFilter],
  );
  const loadDashboard = useCallback(async () => {
    const params = new URLSearchParams({ selectedDate: dateText });
    if (vendor !== "全部供应商") params.set("supplier", vendor);
    if (position !== "全部岗位") params.set("position", position);
    try {
      const [overview, funnelData, vendorData, riskData] = await Promise.all([
        dashboardApi.overview(params),
        dashboardApi.funnel(params),
        dashboardApi.vendors(params) as Promise<
          ReturnType<typeof calculateVendorPerformance>
        >,
        dashboardApi.risks(params),
      ]);
      setServerMetrics(overview);
      setServerFunnel(funnelData);
      setServerVendors(vendorData);
      setServerRisk(riskData);
    } catch {
      /* 候选人列表会显示统一重试入口 */
    }
  }, [dateText, vendor, position]);
  useEffect(() => {
    void loadCandidates(1);
  }, [loadCandidates]);
  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);
  useEffect(() => {
    const onLocation = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onLocation);
    return () => window.removeEventListener("popstate", onLocation);
  }, []);
  useEffect(() => { if (isSupplierRole(user?.role) && user?.supplierName) setVendor(user.supplierName); }, [user]);
  if (pathname === "/auto-dashboard/upload") return <AutoDashboardUploadPage />;
  const autoDashboardMatch = pathname.match(/^\/dashboards\/([^/]+)$/);
  if (autoDashboardMatch) return <RecruitmentResultDashboardPage dashboardId={autoDashboardMatch[1]} />;
  if (screeningOpen)
    return (
      <ResumeScreeningPage
        onBack={() => setScreeningOpen(false)}
        onTransfer={(candidate) => {
          void api("/api/candidates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: candidate.name,
              phone: candidate.phone || null,
              supplierName: candidate.vendor,
              positionName: candidate.position,
              projectName: candidate.project,
              currentStatus: candidate.currentStatus,
              resumeSubmitDate: candidate.resumeSubmitDate,
              operator: "AI简历筛选",
            }),
          })
            .then(() => {
              setScreeningOpen(false);
              void loadCandidates(1);
              void loadDashboard();
              message.success("候选人已写入数据库");
            })
            .catch((error) => message.error((error as Error).message));
        }}
      />
    );
  if (importOpen)
    return (
      <ImportPageErrorBoundary>
        <CandidateImportPage
          onBack={() => setImportOpen(false)}
          onComplete={() => {
            void loadCandidates(1);
            void loadDashboard();
          }}
        />
      </ImportPageErrorBoundary>
    );
  const filtered = rows;
  const historicalRows = filtered.map((c) => ({
    ...c,
    currentStatus: getCandidateStatusAtDate(c, dateText) || c.currentStatus,
  }));
  const localMetrics = calculateOverviewMetrics(historicalRows, dateText);
  const metrics = { ...localMetrics, ...serverMetrics };
  const funnel = [
    serverFunnel.submitted || 0,
    serverFunnel.screened || 0,
    serverFunnel.interviewed || 0,
    serverFunnel.passed || 0,
    serverFunnel.pending || 0,
    serverFunnel.joined || 0,
  ];
  const risks = detectRisks(historicalRows, dateText);
  const todos = generateRecruitmentTodos(historicalRows, dateText)
    .filter((t) => todoFilter === "全部" || t.type === todoFilter)
    .map((t) => ({ ...t, completed: completedTodos.includes(t.id) }));
  const performances = serverVendors;
  const summaryRows = buildRecruitmentSummaryRows(filtered);
  const report = generateDailyReport(historicalRows, dateText);
  const reset = () => {
    setVendor("全部供应商");
    setStatusFilter([]);
    setPosition("全部岗位");
    setSearch("");
  };
  const refresh = () => {
    void loadCandidates(candidatePage);
    void loadDashboard();
    message.success("已从数据库刷新");
  };
  const updateStatus = async (values: {
    status: CandidateStatus;
    remark: string;
    date?: string;
  }) => {
    if (!selected || !values.remark.trim())
      return message.error("状态变更必须填写备注");
    const from = selected.currentStatus;
    if (!canTransitionStatus(from, values.status))
      return message.error(`不允许从“${from}”直接变更为“${values.status}”`);
    try {
      await api(`/api/candidates/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentStatus: values.status,
          remark: values.remark,
          operator: "招聘人员",
        }),
      });
      setStatusOpen(false);
      statusForm.resetFields();
      setSelected(null);
      await loadCandidates(candidatePage);
      await loadDashboard();
      message.success("状态已写入数据库并记录日志");
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const toggleTodo = (todo: RecruitmentTodo) =>
    setCompletedTodos((list) =>
      todo.completed ? list.filter((id) => id !== todo.id) : [...list, todo.id],
    );
  const localRiskTotal = Object.values(risks).reduce(
    (sum, list) => sum + list.length,
    0,
  );
  const riskTotal = serverRisk.total ?? localRiskTotal;
  const riskCards = [
    ["面试结果待反馈", risks.feedback, "面试结束超过24小时，结果仍未反馈。"],
    ["面试未到场", risks.absent, "候选人未按时参加面试，请供应商确认原因。"],
    ["预计入职逾期", risks.overdue, "预计入职日期已过，候选人尚未完成报到。"],
    ["入职延期", risks.delayed, "候选人预计入职日期发生延期。"],
    ["候选人放弃", risks.giveup, "候选人已明确放弃本次机会。"],
    ["供应商反馈超时", risks.vendor, "候选人处于待处理状态超过48小时。"],
  ] as const;
  const funnelOption = {
    tooltip: {
      trigger: "item",
      formatter: (p: { name: string; value: number }) =>
        `${p.name}<br/>人数：${p.value}`,
    },
    series: [
      {
        type: "funnel",
        left: "8%",
        top: 8,
        bottom: 8,
        width: "84%",
        min: 0,
        max: Math.max(...funnel, 1),
        minSize: "10%",
        maxSize: "100%",
        sort: "descending",
        gap: 5,
        label: {
          show: true,
          position: "inside",
          color: "#fff",
          formatter: (p: { name: string; value: number }) =>
            `${p.name} ${p.value}`,
        },
        data: [
          "提交简历",
          "简历通过",
          "已安排面试",
          "面试通过",
          "确认入职",
          "实际入职",
        ].map((name, i) => ({ name, value: funnel[i] })),
      },
    ],
  };
  const columns = [
    {
      title: "候选人",
      dataIndex: "name",
      render: (v: string, c: Candidate) => (
        <a onClick={() => setSelected(c)}>{v}</a>
      ),
    },
    {
      title: "联系方式",
      render: (_: unknown, c: Candidate) => maskPhone(c.phone),
    },
    { title: "供应商", dataIndex: "vendor" },
    { title: "岗位", dataIndex: "position" },
    {
      title: "状态",
      dataIndex: "currentStatus",
      render: (v: string) => <Tag color={statusColor[v]}>{v}</Tag>,
    },
    {
      title: "重复风险",
      render: (_: unknown, c: Candidate) =>
        c.duplicateCheck?.isDuplicate ? (
          <Tag
            color={c.duplicateCheck.level === "确定重复" ? "red" : "orange"}
            onClick={() => message.info(c.duplicateCheck?.reasons.join("；"))}
          >
            {c.duplicateCheck.level}
          </Tag>
        ) : (
          <span>—</span>
        ),
    },
    {
      title: "数据质量",
      render: (_: unknown, c: Candidate) => {
        const issues = validateCandidateConsistency(c);
        return issues.length ? (
          <Tag
            color={issues.some((i) => i.level === "严重") ? "red" : "orange"}
          >
            {issues.length} 项问题
          </Tag>
        ) : (
          <Tag color="green">正常</Tag>
        );
      },
    },
    {
      title: "面试",
      render: (_: unknown, c: Candidate) => `${c.interviews.length} 轮`,
    },
    {
      title: "预计入职",
      dataIndex: "expectedEntryDate",
      render: (v?: string) => v || "—",
    },
    { title: "更新时间", dataIndex: "updatedAt" },
  ];
  const summaryColumns = [
    { title: "日期", dataIndex: "date" },
    { title: "供应商", dataIndex: "vendor" },
    { title: "简历筛选量", dataIndex: "resumeScreened" },
    { title: "简历通过量", dataIndex: "resumePassed" },
    {
      title: "简历通过率",
      dataIndex: "resumePassRate",
      render: (v?: number) =>
        v === undefined ? "—" : `${Math.round(v * 100)}%`,
    },
    { title: "面试到场量", dataIndex: "interviewAttended" },
    { title: "面试未到场", dataIndex: "interviewAbsent" },
    { title: "面试通过量", dataIndex: "interviewPassed" },
    {
      title: "面试通过率",
      dataIndex: "interviewPassRate",
      render: (v?: number) =>
        v === undefined ? "—" : `${Math.round(v * 100)}%`,
    },
    { title: "当天Offer发出量", dataIndex: "offersSent" },
    { title: "当天接受Offer量", dataIndex: "offersAccepted" },
    { title: "当天鸽Offer量", dataIndex: "offerGhosted" },
    {
      title: "Offer接受率",
      dataIndex: "offerAcceptanceRate",
      render: (v?: number) =>
        v === undefined ? "—" : `${Math.round(v * 100)}%`,
    },
    {
      title: "目标HC",
      dataIndex: "targetHC",
      render: (v?: number) => v ?? "—",
    },
    {
      title: "剩余缺口",
      dataIndex: "remainingGap",
      render: (v?: number) => v ?? "—",
    },
    { title: "总招聘人数（含已入职人数）", dataIndex: "totalRecruitment" },
  ];
  return (
    <Layout className="shell">
      <Header className="top-header">
        <div>
          <Typography.Title level={3}>人员招聘与入职日报</Typography.Title>
          <Typography.Text>
            统一追踪供应商简历、面试、入职和人员状态
          </Typography.Text>
        </div>
        <Space wrap>
          <Tag color="blue">{user?.supplierName || (user ? roleLabels[user.role] : "")}</Tag>
          {user && ["PLATFORM_ADMIN", "SUPPLIER_ADMIN"].includes(user.role) && <Button icon={<SettingOutlined />} onClick={() => { history.pushState({}, "", "/admin/users"); window.dispatchEvent(new PopStateEvent("popstate")); }}>账号管理</Button>}
          <Button
            icon={<FileSearchOutlined />}
            onClick={() => setScreeningOpen(true)}
          >
            AI简历筛选
          </Button>
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
            Excel导入
          </Button>
          <KimStatusPanel />
          <TencentMeetingStatusPanel />
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            刷新
          </Button>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => setReportOpen(true)}
          >
            预览日报
          </Button>
          <Button
            icon={<CopyOutlined />}
            onClick={() => {
              navigator.clipboard?.writeText(report);
              message.success("日报已复制");
            }}
          >
            复制日报
          </Button>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={() => exportDashboardExcel(historicalRows, dateText)}
          >
            导出 Excel
          </Button>
          <Button icon={<LogoutOutlined />} onClick={() => void logout()}>退出</Button>
        </Space>
      </Header>
      <Content className="content">
        <Card className="auto-dashboard-entry">
          <div>
            <Typography.Title level={4}>文件生成看板</Typography.Title>
            <Typography.Text type="secondary">上传招聘Excel，系统自动读取面试、入职和供应商数据，并生成招聘结果看板。</Typography.Text>
          </div>
          <Button type="primary" icon={<UploadOutlined />} onClick={() => { window.history.pushState({}, "", "/auto-dashboard/upload"); window.dispatchEvent(new PopStateEvent("popstate")); }}>立即上传</Button>
        </Card>
        <Card className="filter-card">
          <Space wrap>
            <DatePicker
              value={date}
              onChange={(v) => v && setDate(v)}
              allowClear={false}
            />
            <Select
              value={vendor}
              options={visibleVendors.map((v) => ({ label: v, value: v }))}
              onChange={setVendor}
              style={{ width: 140 }}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="全部状态"
              value={statusFilter}
              options={statuses.map((v) => ({ label: v, value: v }))}
              onChange={setStatusFilter}
              style={{ width: 250 }}
            />
            <Select
              value={position}
              options={positions.map((v) => ({ label: v, value: v }))}
              onChange={setPosition}
              style={{ width: 180 }}
            />
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索姓名、手机号后四位、供应商或岗位"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 280 }}
            />
            <Button onClick={reset}>重置筛选</Button>
          </Space>
        </Card>
        <div className="metric-grid">
          {[
            ["项目中", metrics.project, "当前在岗"],
            ["培训中", metrics.training, "已入职未完成培训"],
            ["待入职", metrics.pending, "已确认 Offer"],
            ["当日提交简历", metrics.submitted, "所选日期新增"],
            ["当日面试通过", metrics.interviewPassed, "反馈日期命中"],
            ["当日实际入职", metrics.joined, "完成报到"],
          ].map(([name, value, desc]) => (
            <Card
              className="metric-card"
              key={name as string}
              onClick={() => setStatusFilter([name as string])}
            >
              <Statistic title={name as string} value={value as number} />
              <span>{desc as string}</span>
            </Card>
          ))}
        </div>
        <Card
          title={
            <span>
              今日待办{" "}
              <Badge count={todos.filter((t) => !t.completed).length} />
            </span>
          }
        >
          <List
            dataSource={todos.slice(0, 6)}
            locale={{ emptyText: <Empty description="当前没有待处理任务" /> }}
            renderItem={(todo) => (
              <List.Item
                actions={[
                  <Button size="small" onClick={() => toggleTodo(todo)}>
                    {todo.completed ? "已完成" : "标记完成"}
                  </Button>,
                  <Button
                    size="small"
                    onClick={() =>
                      setSelected(
                        rows.find((c) => c.id === todo.candidateId) || null,
                      )
                    }
                  >
                    查看
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={todo.title}
                  description={todo.description}
                />
              </List.Item>
            )}
          />
        </Card>
        <div className="main-grid">
          <Card title="招聘转化漏斗">
            <ReactECharts option={funnelOption} style={{ height: 280 }} />
          </Card>
          <Card title="重点风险" extra={<Badge count={riskTotal} />}>
            <div className="risk-grid">
              {riskCards.map(([title, list, desc]) => (
                <div className="risk-item" key={title}>
                  <Badge count={list.length} />
                  <strong>{title}</strong>
                  <p>{list.length ? desc : "当前暂无风险"}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <Card
          title="供应商绩效"
          extra={
            <span className="muted">
              简历到达数量 50% · 简历质量 40% · Offer 接收率 10%
            </span>
          }
        >
          <Table
            rowKey="vendor"
            pagination={false}
            dataSource={performances}
            columns={[
              { title: "供应商", dataIndex: "vendor" },
              {
                title: "综合得分",
                dataIndex: "totalScore",
                render: (v: number, r: any) => (
                  <a onClick={() => setPerformanceVendor(r.vendor)}>{v} 分</a>
                ),
              },
              {
                title: "评级",
                dataIndex: "level",
                render: (v: string) => <Tag>{v}</Tag>,
              },
              {
                title: "简历到达",
                render: (_: unknown, r: any) => `${r.metrics.resumeCount} 份`,
              },
              {
                title: "简历质量",
                render: (_: unknown, r: any) =>
                  r.metrics.resumePassRate === null
                    ? "—"
                    : `${r.metrics.resumePassRate}%`,
              },
              {
                title: "Offer 接收率",
                render: (_: unknown, r: any) =>
                  r.metrics.offerAcceptanceRate === null
                    ? "—"
                    : `${r.metrics.offerAcceptanceRate}%`,
              },
            ]}
          />
        </Card>
        <Card
          title="候选人明细"
          extra={
            <Space>
              <Select
                size="small"
                value={detailView}
                options={[
                  { label: "候选人明细", value: "candidate" },
                  { label: "招聘数据表格式", value: "summary" },
                ]}
                onChange={setDetailView}
              />
              <span className="muted">
                {detailView === "candidate"
                  ? `当前筛选结果共 ${candidateTotal} 人`
                  : `汇总 ${summaryRows.length} 行`}
              </span>
            </Space>
          }
        >
          {detailView === "candidate" ? (
            <>
              {candidateError && (
                <Alert
                  type="error"
                  showIcon
                  message="候选人数据加载失败"
                  description={candidateError}
                  action={
                    <Button onClick={() => void loadCandidates(candidatePage)}>
                      重试
                    </Button>
                  }
                />
              )}
              <Table
                rowKey="id"
                loading={candidateLoading}
                columns={columns}
                dataSource={filtered}
                pagination={{
                  current: candidatePage,
                  pageSize: 20,
                  total: candidateTotal,
                  showSizeChanger: false,
                  showTotal: (t) => `共 ${t} 人`,
                  onChange: (value) => void loadCandidates(value),
                }}
                scroll={{ x: 1200 }}
              />
            </>
          ) : (
            <>
              <Alert
                type="info"
                showIcon
                message="已按招聘数据表格式汇总当前筛选结果，统计口径与 Excel 导入校验一致。"
              />
              <Table
                rowKey="rowNumber"
                columns={summaryColumns}
                dataSource={summaryRows}
                pagination={{ pageSize: 10 }}
                scroll={{ x: 1800 }}
              />
            </>
          )}
        </Card>
      </Content>
      <Drawer
        title="候选人详情"
        width={520}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <Descriptions
            column={1}
            bordered
            items={[
              { key: "name", label: "姓名", children: selected.name },
              {
                key: "phone",
                label: "手机号",
                children: maskPhone(selected.phone),
              },
              { key: "vendor", label: "供应商", children: selected.vendor },
              { key: "position", label: "岗位", children: selected.position },
              {
                key: "status",
                label: "当前状态",
                children: (
                  <Tag color={statusColor[selected.currentStatus]}>
                    {selected.currentStatus}
                  </Tag>
                ),
              },
            ]}
          />
        )}
      </Drawer>
      <Modal
        title={`${dateText} 人员招聘与入职日报`}
        open={reportOpen}
        onCancel={() => setReportOpen(false)}
        footer={null}
      >
        <pre className="report">{report}</pre>
      </Modal>
      <Modal
        title="供应商绩效详情"
        open={Boolean(performanceVendor)}
        onCancel={() => setPerformanceVendor(null)}
        footer={null}
      >
        {performanceVendor && (
          <VendorPerformanceView
            vendor={performances.find((v) => v.vendor === performanceVendor)!}
          />
        )}
      </Modal>
    </Layout>
  );
}
function VendorPerformanceView({
  vendor,
}: {
  vendor: ReturnType<typeof calculateVendorPerformance>[number];
}) {
  const dims = [
    ["简历到达数量", vendor.resumeVolumeScore],
    ["简历质量", vendor.resumeQualityScore],
    ["Offer 接收率", vendor.offerAcceptanceScore],
  ];
  return (
    <div>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          本期共到达简历 {vendor.metrics.resumeCount} 份
        </Typography.Text>
        {dims.map(([name, value]) => (
          <div className="performance-row" key={name as string}>
            <span>{name}</span>
            <Progress
              percent={value as number}
              status={(value as number) < 60 ? "exception" : "active"}
            />
          </div>
        ))}
        <Alert
          type={vendor.level === "高风险" ? "error" : "info"}
          message={`${vendor.vendor}本期综合评级为${vendor.level}，评分权重为简历到达数量50%、简历质量40%、Offer接收率10%。`}
        />
      </Space>
    </div>
  );
}

function KimStatusPanel() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{
    configured: boolean;
    message: string;
  } | null>(null);
  useEffect(() => {
    authorizedFetch("/api/kim/status")
      .then((res) => res.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, message: "Kim服务未启动" }));
  }, []);
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        Kim提醒：{status?.configured ? "已配置" : "未配置"}
      </Button>
      <Modal
        title="Kim机器人状态"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
      >
        <Alert
          type={status?.configured ? "success" : "warning"}
          message={status?.message || "检测中"}
          description={
            status?.configured
              ? "面试创建后将按提醒节点发送消息。"
              : "请在服务端 .env 配置 KIM_WEBHOOK_URL；未配置时不影响面试数据保存。"
          }
        />
        <Divider />
        <Button
          onClick={() =>
            authorizedFetch("/api/interview-reminders/scan", { method: "POST" })
              .then(() => message.success("已触发提醒扫描"))
              .catch(() => message.error("提醒服务未启动"))
          }
        >
          立即扫描提醒任务
        </Button>
      </Modal>
    </>
  );
}
function TencentMeetingStatusPanel() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{
    data?: { mode: string; message: string };
  } | null>(null);
  useEffect(() => {
    authorizedFetch("/api/tencent-meeting/status")
      .then((res) => res.json())
      .then(setStatus)
      .catch(() =>
        setStatus({ data: { mode: "unknown", message: "会议服务未启动" } }),
      );
  }, []);
  const mode = status?.data?.mode;
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        腾讯会议：
        {mode === "mock" ? "模拟模式" : mode === "api" ? "真实模式" : "未连接"}
      </Button>
      <Modal
        title="腾讯会议连接状态"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
      >
        <Alert
          type={
            mode === "mock" ? "info" : mode === "api" ? "success" : "warning"
          }
          message={status?.data?.message || "检测中"}
          description={
            mode === "mock"
              ? "当前不会创建真实会议，适合演示和联调。"
              : "真实 API 参数和鉴权需按腾讯会议官方文档配置。"
          }
        />
        <Divider />
        <Button
          onClick={() =>
            authorizedFetch("/api/tencent-meeting/test", { method: "POST" })
              .then((res) => res.json())
              .then((body) =>
                message.info(
                  body.data?.message || body.message || "已完成测试",
                ),
              )
          }
        >
          测试连接
        </Button>
      </Modal>
    </>
  );
}
