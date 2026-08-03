import { BarChartOutlined, CheckCircleFilled, DatabaseOutlined, FileExcelOutlined, InboxOutlined, SafetyCertificateOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Tag, Upload, Typography, message as toast } from "antd";
import { useEffect, useRef, useState } from "react";
import type { UploadFile } from "antd";
import { autoDashboardApi } from "../../api/backend";
import UploadProgress from "./UploadProgress";

export default function AutoDashboardUploader({ onComplete }: { onComplete: (url: string) => void }) {
  const [files, setFiles] = useState<UploadFile[]>([]), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState("等待上传"), [error, setError] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(timer.current), []);
  const upload = async () => {
    const file = files[0]?.originFileObj; if (!file) return setError("请选择 Excel 或 CSV 文件");
    setBusy(true); setError(""); setProgress(5); setStatus("正在上传文件");
    timer.current = window.setInterval(() => setProgress((value) => { const next = Math.min(92, value + (value < 30 ? 7 : 3)); const messages = next < 22 ? "正在读取工作表" : next < 45 ? "正在识别面试数据" : next < 58 ? "正在识别入职数据" : next < 72 ? "正在保存数据" : next < 84 ? "正在计算统计" : "正在生成看板"; setStatus(messages); return next; }), 650);
    try { const result = await autoDashboardApi.upload(file); window.clearInterval(timer.current); setProgress(100); setStatus("文件处理完成，已生成招聘结果看板。"); toast.success("文件处理完成，已生成招聘结果看板。"); if (result.warningCount) toast.warning(`部分数据无法识别，已自动跳过 ${result.warningCount} 行。`); window.setTimeout(() => onComplete(result.redirectUrl), 500); }
    catch (e) { window.clearInterval(timer.current); setError((e as Error).message); setProgress(0); setStatus("处理失败"); setBusy(false); }
  };
  const selectedFile = files[0];
  const beforeUpload = (file: File) => {
    const supported = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!supported) { toast.error("仅支持 .xlsx、.xls 或 .csv 文件"); return Upload.LIST_IGNORE; }
    if (file.size > 15 * 1024 * 1024) { toast.error("文件不能超过 15MB"); return Upload.LIST_IGNORE; }
    return false;
  };
  return <div className="auto-upload-workspace">
    <section className="auto-upload-primary">
      <Card className="auto-upload-card" title={<div><Typography.Title level={4}>选择招聘数据文件</Typography.Title><Typography.Text type="secondary">一次上传一个文件，解析完成后自动进入结果看板</Typography.Text></div>}>
        <Upload.Dragger accept=".xlsx,.xls,.csv" maxCount={1} fileList={files} showUploadList={false} beforeUpload={beforeUpload} onChange={({ fileList }) => { setFiles(fileList.slice(-1)); setError(""); }} disabled={busy}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <Typography.Title level={4}>拖拽文件到这里</Typography.Title>
          <Typography.Text>或 <span className="upload-link-text">点击选择文件</span></Typography.Text>
          <div className="upload-format-row"><Tag>.XLSX</Tag><Tag>.XLS</Tag><Tag>.CSV</Tag><span>最大 15MB</span></div>
        </Upload.Dragger>
        {selectedFile ? <div className="selected-upload-file">
          <div className="selected-file-icon"><FileExcelOutlined /></div>
          <div className="selected-file-main"><strong>{selectedFile.name}</strong><span>{selectedFile.size ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB` : "等待读取"}</span></div>
          <Tag icon={<CheckCircleFilled />} color="success">已就绪</Tag>
          <Button type="link" disabled={busy} onClick={() => setFiles([])}>移除</Button>
        </div> : null}
        <div className="auto-upload-actions">
          <Typography.Text type="secondary">上传后会自动读取工作表，不需要手动配置字段。</Typography.Text>
          <Button type="primary" size="large" icon={<UploadOutlined />} loading={busy} disabled={!selectedFile} onClick={() => void upload()}>上传并生成看板</Button>
        </div>
        {error ? <Alert type="error" showIcon message="文件处理失败" description={error} /> : null}
      </Card>
      {(busy || progress > 0) ? <UploadProgress progress={progress} message={status} /> : null}
    </section>
    <aside className="auto-upload-guide">
      <Card title="三步生成看板" className="upload-guide-card">
        <div className="upload-guide-step"><span>1</span><div><strong>上传文件</strong><p>选择供应商或招聘业务导出的数据文件。</p></div></div>
        <div className="upload-guide-step"><span>2</span><div><strong>智能识别</strong><p>自动识别面试、入职、供应商及候选人信息。</p></div></div>
        <div className="upload-guide-step"><span>3</span><div><strong>生成看板</strong><p>汇总关键指标，并生成招聘结果可视化。</p></div></div>
      </Card>
      <Card title="系统可自动识别" className="upload-recognition-card">
        <div className="recognition-item"><DatabaseOutlined /><span>多工作表与多行表头</span></div>
        <div className="recognition-item"><BarChartOutlined /><span>面试、入职与供应商数据</span></div>
        <div className="recognition-item"><SafetyCertificateOutlined /><span>无法识别的行会提示并跳过</span></div>
      </Card>
      <Alert type="info" showIcon message="文件安全" description="原始文件仅用于数据解析，不会在浏览器中公开展示。" />
    </aside>
  </div>;
}
