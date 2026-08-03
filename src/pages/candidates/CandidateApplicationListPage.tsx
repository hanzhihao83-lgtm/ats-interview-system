import { Card } from "antd";
import CandidateApplicationTable from "../../components/candidates/CandidateApplicationTable";
import type { BusinessLine } from "../../types/businessLine";
export default function CandidateApplicationListPage({ businessLine, status }: { businessLine?: BusinessLine; status?: string }) { return <Card title={businessLine === "VIDEO" ? "视频候选人" : businessLine === "AUDIO" ? "音频候选人" : "全部候选人"}><CandidateApplicationTable businessLine={businessLine} status={status} /></Card>; }
