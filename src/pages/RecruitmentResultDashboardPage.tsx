import { ArrowLeftOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Layout, Skeleton, Space, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { autoDashboardApi } from "../api/backend";
import DashboardOverview from "../components/auto-dashboard/DashboardOverview";
import RecruitmentFunnel from "../components/auto-dashboard/RecruitmentFunnel";
import BusinessComparisonChart from "../components/auto-dashboard/BusinessComparisonChart";
import SupplierResultChart from "../components/auto-dashboard/SupplierResultChart";
import SupplierResultTable from "../components/auto-dashboard/SupplierResultTable";
import LevelDistributionChart from "../components/auto-dashboard/LevelDistributionChart";
import InterviewResultChart from "../components/auto-dashboard/InterviewResultChart";
import EntryStatusChart from "../components/auto-dashboard/EntryStatusChart";
import RecentInterviewTable from "../components/auto-dashboard/RecentInterviewTable";
import CandidateDetailTable from "../components/auto-dashboard/CandidateDetailTable";
const navigate = (url: string) => { window.history.pushState({}, "", url); window.dispatchEvent(new PopStateEvent("popstate")); };
export default function RecruitmentResultDashboardPage({ dashboardId }: { dashboardId: string }) {
  const [data, setData] = useState<any>(), [sections, setSections] = useState<any>(), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { const [detail, funnel, business, suppliers, levels, results, entries, interviews] = await Promise.all([autoDashboardApi.detail(dashboardId), autoDashboardApi.section(dashboardId, "funnel"), autoDashboardApi.section(dashboardId, "business-comparison"), autoDashboardApi.section(dashboardId, "suppliers"), autoDashboardApi.section(dashboardId, "levels"), autoDashboardApi.section(dashboardId, "interview-results"), autoDashboardApi.section(dashboardId, "entry-status"), autoDashboardApi.section(dashboardId, "interviews")]); setData(detail); setSections({ funnel, business, suppliers, levels, results, entries, interviews }); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }, [dashboardId]);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <Layout className="auto-dashboard-page"><main className="auto-page-content"><Skeleton active paragraph={{ rows: 12 }} /></main></Layout>;
  if (error || !data) return <Layout className="auto-dashboard-page"><main className="auto-page-content"><Alert type="error" showIcon message="看板加载失败" description={error} action={<Button onClick={() => void load()}>重试</Button>} /></main></Layout>;
  const d = data.dataset;
  return <Layout className="auto-dashboard-page"><header className="auto-page-header"><div><Typography.Title level={2}>招聘结果看板</Typography.Title><Typography.Text type="secondary">招聘 Excel 自动识别与统计结果</Typography.Text></div><Space><Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/")}>首页</Button><Button icon={<UploadOutlined />} onClick={() => navigate("/auto-dashboard/upload")}>上传新文件</Button><Button icon={<ReloadOutlined />} onClick={() => { void load(); message.success("看板已刷新"); }}>刷新</Button></Space></header><main className="auto-page-content">{d.warningCount > 0 && <Alert type="warning" showIcon message={`部分数据无法识别，已自动跳过 ${d.warningCount} 行。`} style={{ marginBottom: 16 }} />}<Descriptions bordered column={{ xs: 1, sm: 2, lg: 3 }} className="dataset-meta" items={[{ label: "数据来源文件", children: d.originalFileName }, { label: "上传时间", children: new Date(d.createdAt).toLocaleString() }, { label: "已读取工作表数量", children: d.processedSheets }, { label: "候选人记录数", children: d.candidateCount }, { label: "供应商数量", children: d.supplierCount }, { label: "最近更新时间", children: new Date(d.updatedAt).toLocaleString() }]} /><Typography.Title level={3}>核心指标</Typography.Title><DashboardOverview data={data.overview} /><div className="auto-two-column"><RecruitmentFunnel data={sections.funnel} /><BusinessComparisonChart data={sections.business} /></div><SupplierResultChart data={sections.suppliers} /><SupplierResultTable data={sections.suppliers} /><div className="auto-three-column"><LevelDistributionChart data={sections.levels} /><InterviewResultChart data={sections.results} /><EntryStatusChart data={sections.entries} /></div><RecentInterviewTable data={sections.interviews} /><CandidateDetailTable dashboardId={dashboardId} suppliers={sections.suppliers.map((x: any) => x.supplier)} /></main></Layout>;
}
