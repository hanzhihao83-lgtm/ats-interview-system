import { Card, Progress, Steps, Typography } from "antd";
const stages = ["正在上传文件", "正在读取工作表", "正在识别面试数据", "正在识别入职数据", "正在保存数据", "正在计算统计", "正在生成看板", "已完成"];
export default function UploadProgress({ progress, message }: { progress: number; message: string }) {
  const current = Math.min(stages.length - 1, Math.floor(progress / (100 / (stages.length - 1))));
  return <Card className="upload-progress"><Progress percent={progress} status={progress === 100 ? "success" : "active"} /><Typography.Text>{message}</Typography.Text><Steps size="small" current={current} items={stages.map((title) => ({ title }))} responsive /></Card>;
}
