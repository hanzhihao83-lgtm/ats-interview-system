import { useState } from "react";
import { Alert, Button, DatePicker, Input, Modal, Space, Typography, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import type { Candidate } from "../types/recruitment";
import { apiUrl } from "../api/backend";

export default function InterviewBookingButton({ candidate }: { candidate: Candidate }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<Dayjs | null>(null);
  const [interviewer, setInterviewer] = useState("Kim");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!start) return message.warning("请选择面试时间");
    setSaving(true);
    const startTime = start.toISOString();
    const endTime = start.add(30, "minute").toISOString();
    try {
      const response = await fetch(apiUrl("/api/interviews"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId: candidate.id, candidateName: candidate.name, vendor: candidate.vendor, project: candidate.project, position: candidate.position, round: 1, roundName: "第一轮", scheduledStartTime: startTime, scheduledEndTime: endTime, interviewer, interviewerName: interviewer, recruiterName: "招聘专员", status: "待创建会议", result: "待反馈", interviewType: "腾讯会议", reminderSettings: { enabled: true, notifyOnCreated: true, reminder24Hours: true, reminder2Hours: true, reminder30Minutes: false } }) });
      const created = await response.json();
      if (!created.success) return message.error(created.message || "面试保存失败");
      const meetingResponse = await fetch(apiUrl(`/api/interviews/${created.data.id}/create-meeting`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startTime, endTime, subject: `招聘面试｜${candidate.name}｜${candidate.position}｜第一轮` }) });
      const meeting = await meetingResponse.json();
      if (!meeting.success) return message.warning("面试已保存，但腾讯会议创建失败");
      message.success(meeting.data.mode === "mock" ? "面试已预约（模拟会议）" : "腾讯会议已创建");
      setOpen(false);
    } catch { message.error("面试服务未启动"); } finally { setSaving(false); }
  };
  return <><Button type="primary" onClick={() => setOpen(true)}>预约腾讯会议面试</Button><Modal title={`预约${candidate.name}的面试`} open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={saving}><Space direction="vertical" style={{ width: "100%" }}><Typography.Text>岗位：{candidate.position} · 项目：{candidate.project}</Typography.Text><DatePicker showTime value={start} onChange={setStart} style={{ width: "100%" }} placeholder="选择面试开始时间"/><Input value={interviewer} onChange={(event) => setInterviewer(event.target.value)} placeholder="面试官姓名"/><Alert type="info" message={`默认30分钟，当前时间：${dayjs().format("YYYY-MM-DD HH:mm")}`} /></Space></Modal></>;
}
