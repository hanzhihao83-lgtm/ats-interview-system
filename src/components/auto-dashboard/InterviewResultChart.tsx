import DistributionChart from "./DistributionChart";
export default function InterviewResultChart({ data }: { data: any[] }) { return <DistributionChart title="面试结果分布" data={data} />; }
