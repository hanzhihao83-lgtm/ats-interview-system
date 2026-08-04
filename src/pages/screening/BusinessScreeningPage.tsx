import { DeleteOutlined, PlayCircleOutlined, SaveOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Input, message, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { applicationApi } from "../../api/applicationApi";
import { screeningApi, type SavedFilter } from "../../api/workflowApi";
import BusinessPageHeader from "../../components/business/BusinessPageHeader";
import ApplicationWorkflowDrawer from "../../components/workflow/ApplicationWorkflowDrawer";
import { businessLineConfigs } from "../../config/businessLineConfigs";
import type { BusinessLine } from "../../types/businessLine";
import type { CandidateApplication } from "../../types/candidateApplication";

export default function BusinessScreeningPage({ businessLine }: { businessLine: BusinessLine }) {
  const config = businessLineConfigs[businessLine];
  const [rows, setRows] = useState<CandidateApplication[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [filterName, setFilterName] = useState("");
  const [savingFilter, setSavingFilter] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "100", businessLine });
      if (keyword.trim()) params.set("keyword", keyword.trim());
      const [applications, screeningResults, saved] = await Promise.all([
        applicationApi.list(params),
        screeningApi.list(businessLine),
        screeningApi.filters(),
      ]);
      setRows(applications.rows);
      setResults(screeningResults);
      setFilters(saved);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "筛选数据加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [businessLine]);

  const latestByApplication = useMemo(() => {
    const map = new Map<string, any>();
    for (const result of results) if (!map.has(result.applicationId)) map.set(result.applicationId, result);
    return map;
  }, [results]);

  const runScreening = async (applicationId: string) => {
    setRunningId(applicationId);
    try {
      await screeningApi.run(applicationId);
      message.success("AI 辅助筛选已完成并持久化");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "AI 筛选失败");
    } finally {
      setRunningId(null);
    }
  };

  const openSaveFilter = () => {
    if (!keyword.trim()) {
      message.warning("请先填写要保存的搜索条件");
      return;
    }
    setFilterName("");
    setFilterModalOpen(true);
  };

  const saveFilter = async () => {
    if (!filterName.trim()) {
      message.warning("请填写筛选器名称");
      return;
    }
    setSavingFilter(true);
    try {
      await screeningApi.saveFilter(filterName.trim(), { keyword: keyword.trim(), businessLine });
      message.success("筛选条件已保存");
      setFilterModalOpen(false);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存筛选条件失败");
    } finally {
      setSavingFilter(false);
    }
  };

  const applySavedFilter = (id: string) => {
    const selected = filters.find((item) => item.id === id);
    setKeyword(String(selected?.filters.keyword || ""));
  };

  return <>
    <BusinessPageHeader businessLine={businessLine} />
    <Card title={config.screeningTitle}>
      <Alert type="info" showIcon message="AI 仅提供辅助评分与面试问题，不会自动淘汰候选人；结果和筛选条件均保存到平台。" />
      <Typography.Paragraph style={{ marginTop: 16 }}>岗位规则</Typography.Paragraph>
      <Space wrap>{config.featureFields.map((field) => <Tag key={field}>{field}</Tag>)}</Space>
      <Space wrap className="table-toolbar" style={{ marginTop: 20, width: "100%" }}>
        <Input prefix={<SearchOutlined />} allowClear value={keyword} placeholder="姓名、应聘编号或手机后四位" onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => void load()} style={{ width: 280 }} />
        <Button type="primary" onClick={() => void load()}>查询</Button>
        <Button icon={<SaveOutlined />} onClick={openSaveFilter}>保存筛选条件</Button>
        <Select placeholder="加载已保存条件" allowClear style={{ width: 200 }} onChange={applySavedFilter} options={filters.map((item) => ({ value: item.id, label: item.name }))} />
        {filters.length > 0 && <Button danger icon={<DeleteOutlined />} onClick={() => Modal.confirm({ title: "删除全部已保存筛选条件？", onOk: async () => { await Promise.all(filters.map((item) => screeningApi.deleteFilter(item.id))); await load(); } })}>清空已保存条件</Button>}
      </Space>
      <Table rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 20 }} scroll={{ x: 1050 }} columns={[
        { title: "候选人", render: (_, row) => <Button type="link" style={{ padding: 0 }} onClick={() => setSelectedId(row.id)}>{row.candidate.name}</Button> },
        { title: "应聘编号", dataIndex: "applicationNo" },
        { title: "岗位", render: (_, row) => row.position?.name || "—" },
        { title: "状态", dataIndex: "currentStatus", render: (value) => <Tag>{value}</Tag> },
        { title: "AI 分数", render: (_, row) => { const result = latestByApplication.get(row.id); return result ? <b>{result.score}</b> : "—"; } },
        { title: "建议", render: (_, row) => latestByApplication.get(row.id)?.recommendedLevel || "尚未筛选" },
        { title: "缺失/风险项", render: (_, row) => { const result = latestByApplication.get(row.id); return Array.isArray(result?.riskPoints) ? result.riskPoints.slice(0, 3).map((item: string) => <Tag color="orange" key={item}>{item}</Tag>) : "—"; } },
        { title: "操作", fixed: "right", render: (_, row) => <Space><Button icon={<PlayCircleOutlined />} loading={runningId === row.id} onClick={() => void runScreening(row.id)}>{latestByApplication.has(row.id) ? "重新筛选" : "运行筛选"}</Button><Button type="primary" ghost onClick={() => setSelectedId(row.id)}>人工复核</Button></Space> },
      ]} />
    </Card>
    <ApplicationWorkflowDrawer applicationId={selectedId} businessLine={businessLine} onClose={() => setSelectedId(null)} onChanged={() => void load()} />
    <Modal open={filterModalOpen} title="保存筛选条件" okText="保存" cancelText="取消" confirmLoading={savingFilter} onOk={() => void saveFilter()} onCancel={() => setFilterModalOpen(false)}>
      <Input autoFocus value={filterName} placeholder="筛选器名称" maxLength={50} onChange={(event) => setFilterName(event.target.value)} onPressEnter={() => void saveFilter()} />
    </Modal>
  </>;
}
