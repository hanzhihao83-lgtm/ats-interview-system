import { InboxOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Select, Space, Upload, Typography, message as toast } from "antd";
import { useEffect, useRef, useState } from "react";
import type { UploadFile } from "antd";
import { autoDashboardApi } from "../../api/backend";
import UploadProgress from "./UploadProgress";
import { useAuth } from "../../auth/AuthContext";

export default function AutoDashboardUploader({ onComplete }: { onComplete: (url: string) => void }) {
  const { user } = useAuth();
  const forcedLine = user?.role === "VIDEO_RECRUITER" || user?.role === "SUPPLIER_VIDEO_RECRUITER" ? "VIDEO" : user?.role === "AUDIO_RECRUITER" || user?.role === "SUPPLIER_AUDIO_RECRUITER" ? "AUDIO" : undefined;
  const supplierAdmin = user?.role === "SUPPLIER_ADMIN";
  const [files, setFiles] = useState<UploadFile[]>([]), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState("等待上传"), [error, setError] = useState("");
  const [businessLine, setBusinessLine] = useState(forcedLine || (supplierAdmin ? "VIDEO" : "COMBINED"));
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(timer.current), []);
  const upload = async () => {
    const file = files[0]?.originFileObj; if (!file) return setError("请选择 Excel 或 CSV 文件");
    setBusy(true); setError(""); setProgress(5); setStatus("正在上传文件");
    timer.current = window.setInterval(() => setProgress((value) => { const next = Math.min(92, value + (value < 30 ? 7 : 3)); const messages = next < 22 ? "正在读取工作表" : next < 45 ? "正在识别面试数据" : next < 58 ? "正在识别入职数据" : next < 72 ? "正在保存数据" : next < 84 ? "正在计算统计" : "正在生成看板"; setStatus(messages); return next; }), 650);
    try { const result = await autoDashboardApi.upload(file, user?.name, forcedLine || businessLine); window.clearInterval(timer.current); setProgress(100); setStatus("文件处理完成，已生成招聘结果看板。"); toast.success("文件处理完成，已生成招聘结果看板。"); if (result.warningCount) toast.warning(`部分数据无法识别，已自动跳过 ${result.warningCount} 行。`); window.setTimeout(() => onComplete(result.redirectUrl), 500); }
    catch (e) { window.clearInterval(timer.current); setError((e as Error).message); setProgress(0); setStatus("处理失败"); setBusy(false); }
  };
  return <div className="auto-upload-wrap"><Card className="auto-upload-card">{!forcedLine && <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }}><Typography.Text strong>本次文件属于</Typography.Text><Select value={businessLine} onChange={setBusinessLine} options={supplierAdmin ? [{ value: "VIDEO", label: "视频部门" }, { value: "AUDIO", label: "音频部门" }] : [{ value: "COMBINED", label: "综合文件（按工作表自动识别）" }, { value: "VIDEO", label: "视频部门" }, { value: "AUDIO", label: "音频部门" }]} /></Space>}<Alert type="info" showIcon message={forcedLine ? `当前账号已强制绑定${forcedLine === "VIDEO" ? "视频" : "音频"}部门` : businessLine === "COMBINED" ? "综合文件将按工作表名称和岗位关键词自动识别业务线" : `文件内数据将统一写入${businessLine === "VIDEO" ? "视频" : "音频"}部门`} style={{ marginBottom: 16 }} /><Upload.Dragger accept=".xlsx,.xls,.csv" maxCount={1} fileList={files} beforeUpload={() => false} onChange={({ fileList }) => setFiles(fileList.slice(-1))} disabled={busy}><p className="ant-upload-drag-icon"><InboxOutlined /></p><Typography.Title level={4}>上传 Excel 生成看板</Typography.Title><Typography.Text type="secondary">拖拽文件到此处，或点击选择 .xlsx、.xls、.csv 文件（最大 15MB）</Typography.Text></Upload.Dragger><Button block type="primary" size="large" icon={<UploadOutlined />} loading={busy} disabled={!files.length} onClick={() => void upload()} style={{ marginTop: 18 }}>上传并生成看板</Button>{error && <Alert type="error" showIcon message={error} style={{ marginTop: 16 }} />}</Card>{(busy || progress > 0) && <UploadProgress progress={progress} message={status} />}</div>;
}
