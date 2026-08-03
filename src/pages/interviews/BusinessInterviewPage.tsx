import { Card, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import { interviewApi } from "../../api/interviewApi";
import type { BusinessLine } from "../../types/businessLine";
import BusinessLineBadge from "../../components/business/BusinessLineBadge";
export default function BusinessInterviewPage({ businessLine }: { businessLine?: BusinessLine }) {
  const [rows, setRows] = useState<any[]>([]), [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); interviewApi.list(businessLine).then((r) => setRows(r.rows)).finally(() => setLoading(false)); }, [businessLine]);
  return <Card title={businessLine === "VIDEO" ? "视频面试排期" : businessLine === "AUDIO" ? "音频面试排期" : "全部面试"}><Table rowKey="id" loading={loading} dataSource={rows} columns={[{ title: "候选人", render: (_, r) => r.candidate?.name || "—" }, { title: "业务部门", render: (_, r) => r.businessLine ? <BusinessLineBadge businessLine={r.businessLine} /> : "待归类" }, { title: "供应商", render: (_, r) => r.application?.supplier?.name || "—" }, { title: "岗位", render: (_, r) => r.application?.position?.name || "—" }, { title: "面试时间", dataIndex: "scheduledStartTime", render: (v) => v?.slice(0, 16).replace("T", " ") }, { title: "面试官", dataIndex: "interviewer", render: (v) => v || "—" }, { title: "状态", dataIndex: "status", render: (v) => <Tag>{v}</Tag> }, { title: "结果", dataIndex: "result", render: (v) => v || "—" }]} /></Card>;
}
