import { Tag } from "antd";
import type { BusinessLine } from "../../types/businessLine";
export default function BusinessLineBadge({ businessLine }: { businessLine: BusinessLine | "UNCLASSIFIED" }) {
  return <Tag color={businessLine === "VIDEO" ? "blue" : businessLine === "AUDIO" ? "purple" : "default"}>{businessLine === "VIDEO" ? "视频" : businessLine === "AUDIO" ? "音频" : "待归类"}</Tag>;
}
