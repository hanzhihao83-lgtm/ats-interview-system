import { AudioOutlined, AppstoreOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { Space, Tag, Typography } from "antd";
import { useAuth } from "../../auth/AuthContext";
import type { BusinessLineFilter } from "../../types/businessLine";

export default function BusinessPageHeader({ businessLine, subtitle }: { businessLine: BusinessLineFilter; subtitle?: string }) {
  const { user } = useAuth(), Icon = businessLine === "VIDEO" ? VideoCameraOutlined : businessLine === "AUDIO" ? AudioOutlined : AppstoreOutlined;
  const title = businessLine === "VIDEO" ? "视频招聘中心" : businessLine === "AUDIO" ? "音频招聘中心" : "综合招聘管理";
  const scope = businessLine === "COMBINED" ? "视频 + 音频" : businessLine === "VIDEO" ? "视频部门" : "音频部门";
  return <div className="business-page-header"><Space align="start"><Icon className="business-page-icon" /><div><Typography.Title level={2}>{title}</Typography.Title><Space wrap><Tag>{scope}</Tag><Tag>{user?.supplierName || "全部供应商"}</Tag></Space>{subtitle && <Typography.Paragraph type="secondary">{subtitle}</Typography.Paragraph>}</div></Space></div>;
}
