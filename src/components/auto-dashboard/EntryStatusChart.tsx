import DistributionChart from "./DistributionChart";
export default function EntryStatusChart({ data }: { data: any[] }) { return <DistributionChart title="入职状态分布" data={data} />; }
