import { Card, Table } from "antd";
const columns = [["supplier", "供应商"], ["candidates", "候选人数"], ["passed", "面试通过"], ["failed", "面试不通过"], ["joined", "已入职"], ["abandoned", "已放弃"], ["videoPassed", "视频通过"], ["audioPassed", "音频通过"]].map(([dataIndex, title]) => ({ dataIndex, title }));
export default function SupplierResultTable({ data }: { data: any[] }) { return <Card title="供应商汇总表"><Table rowKey="supplier" dataSource={data} columns={columns} pagination={false} scroll={{ x: 900 }} /></Card>; }
