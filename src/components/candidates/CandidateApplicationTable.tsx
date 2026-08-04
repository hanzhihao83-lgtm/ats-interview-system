import { Button, Input, Space, Table, Tag } from "antd";
import { DownloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { applicationApi } from "../../api/applicationApi";
import type { CandidateApplication } from "../../types/candidateApplication";
import type { BusinessLine } from "../../types/businessLine";
import BusinessLineBadge from "../business/BusinessLineBadge";
import ApplicationWorkflowDrawer from "../workflow/ApplicationWorkflowDrawer";

export default function CandidateApplicationTable({ businessLine, status }: { businessLine?: BusinessLine; status?: string }) {
  const [rows, setRows] = useState<CandidateApplication[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1), [keyword, setKeyword] = useState(""), [loading, setLoading] = useState(false), [selectedId, setSelectedId] = useState<string | null>(null);
  const load = (next = page) => { const params = new URLSearchParams({ page: String(next), pageSize: "20" }); if (businessLine) params.set("businessLine", businessLine); if (status) params.set("status", status); if (keyword) params.set("keyword", keyword); setLoading(true); applicationApi.list(params).then((r) => { setRows(r.rows); setTotal(r.pagination.total); setPage(next); }).finally(() => setLoading(false)); };
  useEffect(() => { load(1); }, [businessLine, status]);
  const download = async () => { const response = await applicationApi.export(businessLine); const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = `${businessLine || "combined"}-applications.xlsx`; anchor.click(); URL.revokeObjectURL(url); };
  return <>
    <Space className="table-toolbar" wrap><Input allowClear prefix={<SearchOutlined />} placeholder="搜索姓名、应聘编号或手机号后四位" value={keyword} onChange={(e) => setKeyword(e.target.value)} onPressEnter={() => load(1)} /><Button onClick={() => load(1)}>查询</Button><Button icon={<DownloadOutlined />} onClick={() => void download()}>导出 Excel</Button></Space>
    <Table rowKey="id" loading={loading} dataSource={rows} pagination={{ current: page, total, pageSize: 20, onChange: load }} scroll={{ x: 1180 }} columns={[
      { title: "应聘编号", dataIndex: "applicationNo" },
      { title: "候选人", render: (_, r) => <Button type="link" style={{ padding: 0 }} onClick={() => setSelectedId(r.id)}>{r.candidate.name}</Button> },
      { title: "业务部门", render: (_, r) => <BusinessLineBadge businessLine={r.businessLine} /> },
      { title: "供应商", render: (_, r) => r.supplier.name },
      { title: "岗位", render: (_, r) => r.position?.name || "—" },
      { title: "当前状态", dataIndex: "currentStatus", render: (v) => <Tag>{v}</Tag> },
      { title: "简历结果", dataIndex: "resumeResult", render: (v) => v || "—" },
      { title: "面试结果", dataIndex: "interviewResult", render: (v) => v || "—" },
      { title: "面试时间", render: (_, r) => r.interviews?.[0]?.scheduledStartTime?.slice(0, 16).replace("T", " ") || "—" },
      { title: "预计入职", dataIndex: "expectedEntryDate", render: (v) => v?.slice(0, 10) || "—" },
      { title: "实际入职", dataIndex: "actualEntryDate", render: (v) => v?.slice(0, 10) || "—" },
      { title: "操作", fixed: "right", render: (_, r) => <Button type="primary" ghost onClick={() => setSelectedId(r.id)}>办理流程</Button> },
    ]} />
    <ApplicationWorkflowDrawer applicationId={selectedId} businessLine={businessLine} onClose={() => setSelectedId(null)} onChanged={() => load(page)} />
  </>;
}
