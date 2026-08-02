import { useState } from "react";
import { Alert, Badge, Button, Card, Descriptions, Empty, Select, Space, Steps, Table, Tag, Typography, Upload, message } from "antd";
import { DownloadOutlined, LeftOutlined, UploadOutlined } from "@ant-design/icons";
import * as XLSX from "xlsx";
import type { Candidate } from "../types/recruitment";
import type { CandidateImportRow, ImportContext } from "../types/candidateImport";
import { candidateFieldAliases, createCandidateFromImport, detectImportDuplicate, downloadImportTemplate, isRecruitmentSummarySheet, mapHeaders, parseRecruitmentSummaryRows, rowsFromSheet, toImportRows, validateCandidateImportRow, validateRecruitmentSummaryRow, type RecruitmentSummaryRow } from "../utils/candidateImport";

interface Props { existing: Candidate[]; onBack: () => void; onImport: (rows: Candidate[]) => void }
const fields = Object.keys(candidateFieldAliases);
const fieldLabels: Record<string, string> = { name: "候选人姓名", phone: "手机号", vendor: "供应商", project: "项目", position: "岗位", university: "大学", major: "专业", resumeSubmitDate: "简历提交日期", currentStatus: "当前状态" };

export default function CandidateImportPage({ existing, onBack, onImport }: Props) {
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState("");
  const [book, setBook] = useState<XLSX.WorkBook>();
  const [sheet, setSheet] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | undefined>>({});
  const [rows, setRows] = useState<CandidateImportRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<RecruitmentSummaryRow[]>([]);
  const [summaryMode, setSummaryMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [api, contextHolder] = message.useMessage();
  const context: ImportContext = { vendors: ["人瑞", "供应商B", "供应商C", "供应商D"], positions: ["AI 数据标注员", "AI 数据质检员", "视频评测工程师", "Caption 标注员", "项目助理"], projects: [], statuses: ["简历待筛选", "简历未通过", "待安排面试", "待面试", "面试待反馈", "面试未通过", "面试通过", "待确认入职", "待入职", "培训中", "项目中", "候选人放弃", "已离职", "异常"], existing, batch: rows };

  const parseSheet = (name: string, workbook = book) => {
    if (!workbook) return;
    const data = rowsFromSheet(workbook.Sheets[name]);
    setSheet(name);
    setHeaders(data.headers);
    if (isRecruitmentSummarySheet(data.headers)) {
      setSummaryMode(true);
      setSummaryRows(parseRecruitmentSummaryRows(data.rows, data.headers));
      setRows([]);
      setStep(2);
      return;
    }
    setSummaryMode(false);
    setSummaryRows([]);
    const nextMapping = mapHeaders(data.headers);
    setMapping(nextMapping);
    setRows(toImportRows(data.rows, nextMapping));
    setStep(1);
  };

  const upload = async (file: File) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return api.error("仅支持 .xlsx、.xls 或 .csv 文件");
    if (file.size > 10 * 1024 * 1024) return api.error("文件不能超过 10MB");
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const workbook = XLSX.read(bytes, { type: "array", cellDates: false, cellNF: false });
      const names = workbook.SheetNames.filter((name) => rowsFromSheet(workbook.Sheets[name]).headers.length);
      if (!names.length) throw new Error("没有识别到表头");
      setBook(workbook);
      setFileName(file.name);
      parseSheet(names[0], workbook);
      api.success(`已读取 ${file.name}`);
    } catch {
      api.error("Excel 读取失败，请确认文件未损坏且包含表头");
    } finally {
      setBusy(false);
    }
  };

  const validate = () => {
    if (summaryMode) {
      setSummaryRows((list) => list.map(validateRecruitmentSummaryRow));
      return;
    }
    const checked = rows.map((row) => validateCandidateImportRow(row, context));
    const withDup = checked.map((row) => ({ ...row, duplicate: detectImportDuplicate(row, { ...context, batch: checked }) }));
    setRows(withDup);
    setStep(2);
  };

  const confirm = () => {
    const valid = rows.filter((row) => row.validationStatus !== "校验失败" && row.action !== "跳过" && row.action !== "待人工复核");
    if (!valid.length) return api.warning("没有可导入的数据");
    onImport(valid.map(createCandidateFromImport));
  };

  const candidateColumns = [
    { title: "行号", dataIndex: "rowNumber" },
    { title: "姓名", dataIndex: "name" },
    { title: "手机号", dataIndex: "phone", render: (v?: string) => v ? `${v.slice(0, 3)}****${v.slice(-4)}` : "—" },
    { title: "供应商", dataIndex: "vendor" },
    { title: "岗位", dataIndex: "position" },
    { title: "状态", dataIndex: "currentStatus" },
    { title: "校验", render: (_: unknown, row: CandidateImportRow) => <Tag color={row.validationStatus === "校验失败" ? "red" : row.validationStatus === "警告" ? "orange" : "green"}>{row.validationStatus}</Tag> },
    { title: "重复风险", render: (_: unknown, row: CandidateImportRow) => row.duplicate?.level && row.duplicate.level !== "无重复" ? <Tag color={row.duplicate.level === "确定重复" ? "red" : "orange"}>{row.duplicate.level}</Tag> : "—" },
    { title: "处理方式", render: (_: unknown, row: CandidateImportRow) => <Select size="small" value={row.action} options={["创建为新候选人", "跳过", "待人工复核"].map((v) => ({ label: v, value: v }))} onChange={(value) => setRows((list) => list.map((item) => item.rowNumber === row.rowNumber ? { ...item, action: value } : item))} /> },
    { title: "问题", render: (_: unknown, row: CandidateImportRow) => [...row.errors, ...row.warnings].join("；") || "—" },
  ];

  const summaryColumns = [
    { title: "行号", dataIndex: "rowNumber", width: 70 },
    { title: "日期", dataIndex: "date", render: (v?: string) => v || "—" },
    { title: "供应商", dataIndex: "vendor", render: (v?: string) => v || "—" },
    { title: "简历筛选量", dataIndex: "resumeScreened", render: (v?: number) => v ?? "—" },
    { title: "简历通过量", dataIndex: "resumePassed", render: (v?: number) => v ?? "—" },
    { title: "面试到场量", dataIndex: "interviewAttended", render: (v?: number) => v ?? "—" },
    { title: "面试通过量", dataIndex: "interviewPassed", render: (v?: number) => v ?? "—" },
    { title: "Offer接受量", dataIndex: "offersAccepted", render: (v?: number) => v ?? "—" },
    { title: "校验结果", render: (_: unknown, row: RecruitmentSummaryRow) => <Tag color={row.validationStatus === "校验失败" ? "red" : row.validationStatus === "警告" ? "orange" : "green"}>{row.validationStatus}</Tag> },
    { title: "错误和警告", render: (_: unknown, row: RecruitmentSummaryRow) => [...row.errors, ...row.warnings].join("；") || "—" },
  ];

  return <div className="content import-page">
    {contextHolder}
    <Space className="screening-header" wrap>
      <Button icon={<LeftOutlined />} onClick={onBack}>返回候选人看板</Button>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>Excel 批量导入</Typography.Title>
        <Typography.Text type="secondary">兼容候选人明细表和招聘数据日报汇总表，系统会先识别格式再执行对应校验。</Typography.Text>
      </div>
      <Button icon={<DownloadOutlined />} onClick={() => downloadImportTemplate(true)}>下载示例模板</Button>
      <Button onClick={() => downloadImportTemplate(false)}>下载空白模板</Button>
    </Space>
    <Steps current={step} items={[{ title: "上传文件" }, { title: "字段映射" }, { title: "校验预览" }, { title: "导入完成" }]} />
    {step === 0 && <Card className="import-upload-card">
      <Upload.Dragger accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={(file) => { void upload(file as unknown as File); return false; }}>
        <p><UploadOutlined style={{ fontSize: 36, color: "#1677ff" }} /></p>
        <p>点击或拖拽 Excel / CSV 文件到这里</p>
        <p className="muted">支持 .xlsx、.xls、.csv，最大 10MB</p>
      </Upload.Dragger>
      <div className="import-native-picker"><Button loading={busy} icon={<UploadOutlined />} onClick={() => document.getElementById("candidate-import-file")?.click()}>选择 Excel 文件</Button><input id="candidate-import-file" type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.currentTarget.value = ""; }} /></div>
      <Alert type="info" showIcon message="系统会自动识别候选人明细或招聘数据日报格式，再执行对应校验。" />
    </Card>}
    {step === 1 && <Card title={summaryMode ? "招聘数据格式识别" : "字段映射"} extra={<Space><Button onClick={() => setStep(0)}>重新上传</Button>{!summaryMode && <Button type="primary" onClick={validate}>开始校验</Button>}</Space>}>
      <Descriptions bordered size="small" column={1} items={[{ key: "file", label: "文件", children: fileName }, { key: "sheet", label: "工作表", children: <Select value={sheet} style={{ width: 280 }} options={(book?.SheetNames || []).map((name) => ({ label: name, value: name }))} onChange={(name) => parseSheet(name)} /> }, { key: "rows", label: "数据行数", children: summaryMode ? summaryRows.length : rows.length }]} />
      {summaryMode ? <Alert style={{ marginTop: 16 }} type="info" showIcon message="已识别为招聘数据日报汇总格式，点击工作表后直接进入校验预览，不会创建候选人明细。" /> : <Table size="small" pagination={false} rowKey="field" dataSource={fields.map((field) => ({ field, header: mapping[field] === undefined ? "未映射" : headers[Number(mapping[field])] }))} columns={[{ title: "系统字段", dataIndex: "field", render: (v: string) => fieldLabels[v] || v }, { title: "Excel列", dataIndex: "header", render: (_: string, record: { field: string }) => <Select allowClear value={mapping[record.field]} style={{ width: 260 }} options={headers.map((header, index) => ({ label: header, value: String(index) }))} onChange={(value) => setMapping((old) => ({ ...old, [record.field]: value }))} /> }]} />}
    </Card>}
    {step === 2 && summaryMode ? <Card title="招聘数据校验预览" extra={<Space><Select size="small" value={sheet} style={{ width: 150 }} options={(book?.SheetNames || []).map((name) => ({ label: name, value: name }))} onChange={(name) => parseSheet(name)} /><Badge count={`共 ${summaryRows.length} 行`} /><Button onClick={() => setStep(0)}>重新上传</Button></Space>}>
      <Alert type="info" showIcon message="已识别为招聘数据日报汇总格式，当前只做数据校验，不会创建候选人明细。" />
      <Table rowKey="rowNumber" columns={summaryColumns} dataSource={summaryRows} pagination={{ pageSize: 10 }} scroll={{ x: 1200 }} rowClassName={(row) => row.validationStatus === "校验失败" ? "risk-row" : row.validationStatus === "警告" ? "warning-row" : ""} />
    </Card> : step === 2 && <Card title="数据校验与导入预览" extra={<Space><Badge count={`共 ${rows.length} 行`} /><Button type="primary" onClick={confirm}>确认导入</Button></Space>}>
      <Alert type="warning" showIcon message="校验失败行不能导入；警告和重复行请确认处理方式。" />
      <Table rowKey="rowNumber" columns={candidateColumns} dataSource={rows} pagination={{ pageSize: 10 }} scroll={{ x: 1200 }} rowClassName={(row) => row.validationStatus === "校验失败" ? "risk-row" : row.validationStatus === "警告" ? "warning-row" : ""} />
    </Card>}
    {step === 3 && <Card title="导入完成"><Empty description="候选人数据已写入看板" /><Button type="primary" onClick={onBack}>返回候选人列表</Button></Card>}
  </div>;
}
