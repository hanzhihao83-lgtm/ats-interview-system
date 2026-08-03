import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Layout, Typography } from "antd";
import AutoDashboardUploader from "../components/auto-dashboard/AutoDashboardUploader";
const navigate = (url: string) => { window.history.pushState({}, "", url); window.dispatchEvent(new PopStateEvent("popstate")); };
export default function AutoDashboardUploadPage() {
  return <Layout className="auto-dashboard-page auto-upload-page">
    <header className="auto-page-header auto-upload-page-header">
      <div>
        <Typography.Text className="auto-page-eyebrow">自动化工具 / 文件上传</Typography.Text>
        <Typography.Title level={2}>生成招聘结果看板</Typography.Title>
        <Typography.Text type="secondary">上传招聘数据文件，系统会自动完成识别、统计并生成可视化看板。</Typography.Text>
      </div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/")}>返回首页</Button>
    </header>
    <main className="auto-page-content auto-upload-content"><AutoDashboardUploader onComplete={navigate} /></main>
  </Layout>;
}
