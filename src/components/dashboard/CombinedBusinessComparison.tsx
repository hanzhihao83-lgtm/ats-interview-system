import { Alert, Card, Col, Row, Skeleton, Statistic, Table } from "antd";
import ReactECharts from "echarts-for-react";
import { useEffect, useState } from "react";
import { businessDashboardApi } from "../../api/businessDashboardApi";
import { useAuth } from "../../auth/AuthContext";

const go = (line: string) => { history.pushState({}, "", `/${line.toLowerCase()}/candidates`); dispatchEvent(new PopStateEvent("popstate")); };
export default function CombinedBusinessComparison() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null), [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      businessDashboardApi.overview(),
      businessDashboardApi.overview("VIDEO"),
      businessDashboardApi.overview("AUDIO"),
      user?.role === "PLATFORM_ADMIN" && !user.simulation ? businessDashboardApi.duplicateRisks() : Promise.resolve(null),
    ]).then(([all, video, audio, duplicates]) => setData({ all, video, audio, duplicates })).catch((e) => setError(e.message));
  }, [user?.role, user?.simulation]);
  if (error) return <Alert type="error" showIcon message={error} />;
  if (!data) return <Skeleton active />;
  const metrics = [{ key: "total", name: "简历提交" }, { key: "resumePassed", name: "简历通过" }, { key: "scheduled", name: "已安排面试" }, { key: "interviewPassed", name: "面试通过" }, { key: "pendingEntry", name: "确认入职" }, { key: "actualEntry", name: "实际入职" }, { key: "training", name: "培训中" }, { key: "project", name: "项目中" }];
  const rows = metrics.map((m) => ({ ...m, video: data.video[m.key] ?? 0, audio: data.audio[m.key] ?? 0, total: (data.video[m.key] ?? 0) + (data.audio[m.key] ?? 0) }));
  return <>{data.duplicates?.total > 0 && <Alert type="warning" showIcon message={`发现 ${data.duplicates.total} 组跨外包公司重复风险`} description="各公司仍只能看到自己提交的应聘记录；该提示仅平台管理员可见。" style={{ marginBottom: 16 }} />}<Row gutter={[12, 12]}>{[["全部候选人", data.all.total], ["视频候选人", data.video.total], ["音频候选人", data.audio.total], ["全部简历通过", data.all.resumePassed], ["全部面试通过", data.all.interviewPassed], ["全部待入职", data.all.pendingEntry], ["全部实际入职", data.all.actualEntry], ["全部异常", data.all.abnormal]].map(([title, value]) => <Col xs={12} md={6} key={title}><Card hoverable onClick={() => title === "视频候选人" ? go("video") : title === "音频候选人" ? go("audio") : undefined}><Statistic title={title} value={value ?? "—"} /></Card></Col>)}</Row><Row gutter={[16, 16]} className="business-chart-row"><Col xs={24} xl={12}><Card title="视频与音频对比"><Table rowKey="key" pagination={false} dataSource={rows} columns={[{ title: "指标", dataIndex: "name" }, { title: "视频", dataIndex: "video" }, { title: "音频", dataIndex: "audio" }, { title: "合计", dataIndex: "total" }]} /></Card></Col><Col xs={24} xl={12}><Card title="业务线招聘结果"><ReactECharts style={{ height: 360 }} option={{ tooltip: { trigger: "axis" }, legend: { data: ["视频", "音频"] }, xAxis: { type: "category", data: metrics.slice(0, 6).map((m) => m.name) }, yAxis: { type: "value" }, series: [{ name: "视频", type: "bar", data: rows.slice(0, 6).map((r) => r.video) }, { name: "音频", type: "bar", data: rows.slice(0, 6).map((r) => r.audio) }] }} /></Card></Col></Row></>;
}
