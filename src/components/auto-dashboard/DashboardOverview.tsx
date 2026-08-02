import { Card, Statistic } from "antd";
const fields = [["candidateTotal", "候选人总数"], ["videoCandidates", "视频候选人数"], ["audioCandidates", "音频候选人数"], ["interviewPassed", "面试通过人数"], ["interviewFailed", "面试不通过人数"], ["interviewPending", "待反馈人数"], ["joined", "已入职人数"], ["pendingEntry", "待入职人数"], ["abandoned", "已放弃人数"], ["left", "已离职人数"]];
export default function DashboardOverview({ data }: { data: Record<string, number | null> }) { return <div className="auto-metric-grid">{fields.map(([field, title]) => <Card key={field}><Statistic title={title} value={data[field] ?? "—"} /></Card>)}</div>; }
