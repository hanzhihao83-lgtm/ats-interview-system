import { CalendarOutlined, ClockCircleOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Radio, Result, Space, Spin, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { useEffect, useState } from "react";
import { publicSchedulingApi, type PublicSchedulingDetail } from "../../api/workflowApi";

dayjs.locale("zh-cn");

export default function CandidateInterviewBookingPage({ token }: { token: string }) {
  const [detail, setDetail] = useState<PublicSchedulingDetail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState<{ meetingUrl?: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setDetail(await publicSchedulingApi.detail(token));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "预约链接加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [token]);

  const book = async () => {
    if (selected === null) return message.warning("请选择一个可用时段");
    setBooking(true);
    try {
      const result = await publicSchedulingApi.book(token, selected);
      setCompleted({ meetingUrl: result.meeting?.meetingUrl });
    } catch (bookError) {
      message.error(bookError instanceof Error ? bookError.message : "预约失败，请刷新后重试");
      await load();
    } finally {
      setBooking(false);
    }
  };

  if (loading) return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f4f7fb" }}><Spin size="large" tip="正在加载可选时段" /></main>;
  if (error) return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f4f7fb", padding: 24 }}><Result status="warning" title="暂时无法预约" subTitle={error} extra={<Button onClick={() => void load()}>重新加载</Button>} /></main>;
  if (completed) return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f4f7fb", padding: 24 }}><Result status="success" title="面试时间已确认" subTitle="招聘团队和面试官已收到平台回写，请按确认时间参加面试。" extra={completed.meetingUrl ? <Button type="primary" href={completed.meetingUrl} target="_blank">查看腾讯会议</Button> : null} /></main>;
  if (!detail) return null;

  return <main style={{ minHeight: "100vh", background: "#f4f7fb", padding: "48px 20px" }}>
    <Card style={{ maxWidth: 720, margin: "0 auto", boxShadow: "0 12px 40px rgba(15, 34, 58, .08)" }}>
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <div><Typography.Title level={2} style={{ marginBottom: 4 }}>请选择面试时间</Typography.Title><Typography.Text type="secondary">{detail.candidateName}，请选择一个方便参加的时段。</Typography.Text></div>
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="岗位">{detail.positionName}</Descriptions.Item>
          <Descriptions.Item label="轮次">{detail.roundName}</Descriptions.Item>
          <Descriptions.Item label="面试官"><UserOutlined /> {detail.interviewer}</Descriptions.Item>
          <Descriptions.Item label="邀请方">{detail.supplierName}</Descriptions.Item>
        </Descriptions>
        <Alert type="info" showIcon message={`请在 ${dayjs(detail.expiresAt).format("YYYY-MM-DD HH:mm")} 前完成选择。平台会在提交时再次检查面试官日历。`} />
        <Radio.Group value={selected} onChange={(event) => setSelected(event.target.value)} style={{ width: "100%" }}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {detail.slots.map((slot) => <Card key={slot.index} size="small" styles={{ body: { padding: 16 } }} style={{ opacity: slot.available ? 1 : .55, borderColor: selected === slot.index ? "#1677ff" : undefined }}>
              <Radio value={slot.index} disabled={!slot.available}>
                <Space size={16}><CalendarOutlined /><b>{dayjs(slot.start).format("YYYY年MM月DD日 dddd")}</b><ClockCircleOutlined />{dayjs(slot.start).format("HH:mm")} – {dayjs(slot.end).format("HH:mm")}{slot.available ? <Tag color="green">可预约</Tag> : <Tag>已占用</Tag>}</Space>
              </Radio>
            </Card>)}
          </Space>
        </Radio.Group>
        <Button type="primary" size="large" block disabled={selected === null} loading={booking} onClick={() => void book()}>确认所选面试时间</Button>
        <Typography.Text type="secondary" style={{ textAlign: "center" }}>确认后该邀请链接将失效，如需修改请联系招聘人员。</Typography.Text>
      </Space>
    </Card>
  </main>;
}
