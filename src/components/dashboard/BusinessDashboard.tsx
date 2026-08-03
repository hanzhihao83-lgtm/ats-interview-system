import { Alert, Card, Col, Row, Skeleton, Statistic, Table, Typography } from "antd";
import ReactECharts from "echarts-for-react";
import { useEffect, useState } from "react";
import { businessDashboardApi } from "../../api/businessDashboardApi";
import { businessLineConfigs } from "../../config/businessLineConfigs";
import type { BusinessLine } from "../../types/businessLine";

export default function BusinessDashboard({ businessLine }: { businessLine: BusinessLine }) {
  const [data, setData] = useState<any>(null), [error, setError] = useState("");
  useEffect(() => { setData(null); setError(""); Promise.all([businessDashboardApi.overview(businessLine), businessDashboardApi.funnel(businessLine), businessDashboardApi.suppliers(businessLine), businessDashboardApi.trends(businessLine, 30), businessDashboardApi.risks(businessLine)]).then(([overview, funnel, suppliers, trends, risks]) => setData({ overview, funnel, suppliers, trends, risks })).catch((e) => setError(e.message)); }, [businessLine]);
  if (error) return <Alert type="error" showIcon message="看板加载失败" description={error} />;
  if (!data) return <Skeleton active />;
  const { overview, funnel, suppliers, trends, risks } = data, label = businessLineConfigs[businessLine].shortName;
  const cards = [[`${label}候选人总数`, overview.total], [`${label}简历通过`, overview.resumePassed], [`${label}待面试`, overview.pendingInterview], [`${label}面试通过`, overview.interviewPassed], [`${label}待入职`, overview.pendingEntry], [`${label}已入职`, overview.actualEntry], [`${label}培训中`, overview.training], [`${label}项目中`, overview.project], [`${label}异常`, overview.abnormal]];
  const stages = funnel.stages || [];
  return <div className="business-dashboard"><Row gutter={[12, 12]}>{cards.map(([title, value]) => <Col xs={12} md={8} xl={4} key={title}><Card size="small"><Statistic title={title} value={value ?? "—"} /></Card></Col>)}</Row><Row gutter={[16, 16]} className="business-chart-row"><Col xs={24} xl={12}><Card title={`${label}招聘漏斗`}><ReactECharts style={{ height: 300 }} option={{ tooltip: {}, xAxis: { type: "category", data: stages.map((s: any) => s.name) }, yAxis: { type: "value" }, series: [{ type: "bar", data: stages.map((s: any) => s.count), itemStyle: { color: businessLine === "VIDEO" ? "#1677ff" : "#722ed1" } }] }} /></Card></Col><Col xs={24} xl={12}><Card title={`${label}近30天趋势`}><ReactECharts style={{ height: 300 }} option={{ tooltip: { trigger: "axis" }, xAxis: { type: "category", data: trends.map((r: any) => r.date.slice(5)) }, yAxis: { type: "value" }, series: [{ type: "line", smooth: true, data: trends.map((r: any) => businessLine === "VIDEO" ? r.video : r.audio) }] }} /></Card></Col></Row><Row gutter={[16, 16]}><Col xs={24} xl={16}><Card title={`${label}供应商分析`}><Table size="small" rowKey="supplierId" pagination={false} dataSource={suppliers} columns={[{ title: "供应商", dataIndex: "supplier" }, { title: "候选人", dataIndex: "candidates" }, { title: "面试通过", dataIndex: "passed" }, { title: "实际入职", dataIndex: "joined" }, { title: "异常", dataIndex: "abnormal" }]} /></Card></Col><Col xs={24} xl={8}><Card title={`${label}风险`}><Statistic title="异常与待反馈" value={risks.total ?? 0} /><Typography.Text type="secondary">异常 {risks.abnormal ?? 0} · 待反馈 {risks.feedback ?? 0}</Typography.Text></Card></Col></Row></div>;
}
