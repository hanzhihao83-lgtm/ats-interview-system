import { useMemo, useState } from "react";
import { Alert, Button, Card, Empty, List, Progress, Space, Steps, Tag, Typography, Upload, message } from "antd";
import { FilePdfOutlined, LeftOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { Candidate } from "../types/recruitment";

type PdfStatus = "待校验" | "上传成功" | "格式错误" | "读取失败";
interface PdfItem { id: string; file: File; status: PdfStatus; note?: string }

interface Props { existing: Candidate[]; onBack: () => void; onImport: (rows: Candidate[]) => void }

const readBytes = (file: File): Promise<ArrayBuffer> => {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error("文件读取结果无效"));
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsArrayBuffer(file);
  });
};

const displayName = (fileName: string) => fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "待补充姓名";

function buildCandidate(item: PdfItem, index: number): Candidate {
  const now = dayjs().format("YYYY-MM-DD HH:mm");
  const id = `PDF-${dayjs().format("YYYYMMDDHHmmss")}-${index + 1}`;
  return {
    id,
    name: displayName(item.file.name), phone: "", vendor: "待补充", project: "待补充", position: "待补充",
    resumeSubmitDate: dayjs().format("YYYY-MM-DD"), resumeResult: "待筛选", interviewScheduled: false,
    interviews: [], offerConfirmed: false, currentStatus: "简历待筛选", updatedAt: now, updatedBy: "PDF简历导入",
    timeline: [{ time: now, action: "上传 PDF 简历，进入人工筛选", operator: "PDF简历导入", remark: item.file.name }],
    statusEvents: [{ id: `SE-${id}`, candidateId: id, status: "简历待筛选", effectiveAt: now, operator: "PDF简历导入", source: "系统" }],
    operationLogs: [{ id: `LOG-${id}`, candidateId: id, module: "候选人", action: "上传 PDF 简历", operator: "PDF简历导入", operatedAt: now, reason: item.file.name }],
  };
}

export default function PdfResumeImportPage({ existing, onBack, onImport }: Props) {
  const [items, setItems] = useState<PdfItem[]>([]);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const validItems = useMemo(() => items.filter((item) => item.status === "上传成功"), [items]);

  const validatePdf = async (file: File): Promise<PdfStatus> => {
    if (!/\.pdf$/i.test(file.name)) return "格式错误";
    if (file.size <= 0 || file.size > 15 * 1024 * 1024) return "格式错误";
    try {
      const bytes = new Uint8Array(await readBytes(file));
      const signature = String.fromCharCode(...bytes.slice(0, 4));
      return signature === "%PDF" ? "上传成功" : "格式错误";
    } catch { return "读取失败"; }
  };

  const addFiles = async (files: File[]) => {
    const pdfs = files.filter((file) => file && /\.pdf$/i.test(file.name));
    if (!pdfs.length) { messageApi.error("请选择 PDF 格式的简历文件"); return; }
    if (items.length + pdfs.length > 100) { messageApi.error("单次最多上传 100 份 PDF 简历"); return; }
    setBusy(true);
    const next = await Promise.all(pdfs.map(async (file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, file, status: await validatePdf(file) })));
    setItems((old) => {
      const merged = [...old];
      next.forEach((item) => { if (!merged.some((prev) => prev.id === item.id)) merged.push(item); });
      return merged;
    });
    setBusy(false);
    const invalid = next.filter((item) => item.status !== "上传成功").length;
    if (invalid) messageApi.warning(`${invalid} 份文件校验失败，请确认是有效 PDF 且不超过 15MB`);
    if (next.some((item) => item.status === "上传成功")) setStep(1);
  };

  const confirmImport = () => {
    if (!validItems.length) { messageApi.error("没有可导入的 PDF 简历"); return; }
    const names = new Set(existing.map((candidate) => candidate.name));
    const rows = validItems.map((item, index) => {
      const candidate = buildCandidate(item, index);
      if (names.has(candidate.name)) candidate.name = `${candidate.name}（PDF待确认）`;
      return candidate;
    });
    onImport(rows);
  };

  return <div className="content import-page">
    {contextHolder}
    <Space className="screening-header" wrap>
      <Button icon={<LeftOutlined />} onClick={onBack}>返回候选人看板</Button>
      <Typography.Title level={3} style={{ margin: 0 }}>PDF 简历导入</Typography.Title>
      <Tag color="blue">仅支持 PDF</Tag>
    </Space>
    <Alert type="info" showIcon message="PDF 简历会先进入人工筛选，不会自动淘汰候选人" description="当前 Demo 校验 PDF 文件并建立待筛选记录；扫描版 PDF、姓名和岗位等信息请在人工筛选时补充。" />
    <Steps current={step} items={[{ title: "上传 PDF" }, { title: "文件预览" }, { title: "确认导入" }]} />
    {step === 0 && <Card className="import-upload-card" title="上传 PDF 简历">
      <Upload.Dragger multiple accept=".pdf,application/pdf" showUploadList={false} beforeUpload={(file) => { void addFiles([file as unknown as File]); return false; }}>
        <p className="ant-upload-drag-icon"><FilePdfOutlined /></p><p className="ant-upload-text">点击或拖拽 PDF 简历到这里</p><p className="ant-upload-hint">单个文件不超过 15MB，单次最多 100 份</p>
      </Upload.Dragger>
      <div className="import-native-picker"><input id="pdf-resume-picker" type="file" accept=".pdf,application/pdf" multiple hidden onChange={(event) => { void addFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} /><Button icon={<UploadOutlined />} loading={busy} onClick={() => document.getElementById("pdf-resume-picker")?.click()}>选择 PDF 文件</Button></div>
    </Card>}
    {step >= 1 && <Card title={`文件预览（${items.length} 份）`} extra={<Space><Button onClick={() => setStep(0)}>继续上传</Button><Button type="primary" disabled={!validItems.length} onClick={() => setStep(2)}>下一步</Button></Space>}>
      <List dataSource={items} locale={{ emptyText: <Empty description="暂无 PDF 文件" /> }} renderItem={(item) => <List.Item><List.Item.Meta avatar={<FilePdfOutlined />} title={item.file.name} description={`${(item.file.size / 1024 / 1024).toFixed(2)} MB`} />{item.status === "上传成功" ? <Tag color="green">可导入</Tag> : <Tag color="red">{item.status === "格式错误" ? "文件格式或大小不符合要求" : "文件读取失败"}</Tag>}</List.Item>} />
    </Card>}
    {step === 2 && <Card title="确认导入" extra={<Button onClick={() => setStep(1)}>返回修改</Button>}>
      <Progress percent={100} status="success" />
      <Alert type="warning" showIcon message={`将新增 ${validItems.length} 条“简历待筛选”记录`} description="PDF 原文不会在浏览器中执行；候选人姓名默认取文件名，供应商、岗位和联系方式请进入详情后补充。" />
      <Button type="primary" size="large" style={{ marginTop: 16 }} onClick={confirmImport}>确认导入并进入人工筛选</Button>
    </Card>}
  </div>;
}
