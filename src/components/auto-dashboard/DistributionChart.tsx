import { Card } from "antd"; import ReactECharts from "echarts-for-react";
export default function DistributionChart({ title, data }: { title: string; data: any[] }) { return <Card title={title}><ReactECharts option={{ tooltip: { trigger: "item" }, legend: { bottom: 0 }, series: [{ type: "pie", radius: ["42%", "68%"], data, label: { formatter: "{b}: {c}" } }] }} /></Card>; }
