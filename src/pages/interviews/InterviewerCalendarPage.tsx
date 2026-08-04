import {
  CalendarOutlined,
  ClockCircleOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  calendarApi,
  type CalendarBoard,
  type CalendarEvent,
  type InterviewerCalendarBlock,
  type InterviewerProfile,
} from "../../api/calendarApi";
import { useAuth, type UserBusinessLine } from "../../auth/AuthContext";

const weekdays = [
  { label: "周日", value: 0 },
  { label: "周一", value: 1 },
  { label: "周二", value: 2 },
  { label: "周三", value: 3 },
  { label: "周四", value: 4 },
  { label: "周五", value: 5 },
  { label: "周六", value: 6 },
];
const lineOptions = [
  { value: "VIDEO", label: "视频" },
  { value: "AUDIO", label: "音频" },
];
const blockTypeOptions = [
  { value: "LEAVE", label: "请假" },
  { value: "INTERNAL_MEETING", label: "内部会议" },
  { value: "TRAINING", label: "培训" },
  { value: "LUNCH_BREAK", label: "午休" },
  { value: "TEMPORARILY_UNAVAILABLE", label: "临时不可用" },
  { value: "OTHER", label: "其他" },
];
const minuteOptions = Array.from({ length: 49 }, (_, index) => index * 30).map((minute) => ({
  value: minute,
  label: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
}));
const timeSlots = minuteOptions.filter(({ value }) => value >= 9 * 60 && value < 21 * 60);

const minuteLabel = (value?: number | null) => {
  if (value === undefined || value === null) return "--:--";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
};

const eventColor = (event: CalendarEvent) => {
  if (event.kind === "FIXED_BREAK") return "#fff7e6";
  if (event.kind === "UNAVAILABLE") return "#fff1f0";
  return event.detailsVisible ? "#e6f4ff" : "#f5f5f5";
};

export default function InterviewerCalendarPage() {
  const { user } = useAuth();
  const userLines = user?.simulation?.businessLines || user?.businessLines || [];
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [viewMode, setViewMode] = useState<"DAY" | "WEEK">("DAY");
  const [line, setLine] = useState<UserBusinessLine | undefined>(
    userLines.length === 1 ? userLines[0] : undefined,
  );
  const [selectedInterviewerIds, setSelectedInterviewerIds] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<InterviewerProfile[]>([]);
  const [board, setBoard] = useState<CalendarBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [interviewerOpen, setInterviewerOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<InterviewerProfile | null>(null);
  const [blockProfile, setBlockProfile] = useState<InterviewerProfile | null>(null);
  const [blocks, setBlocks] = useState<InterviewerCalendarBlock[]>([]);
  const [editingBlock, setEditingBlock] = useState<InterviewerCalendarBlock | null>(null);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [interviewerForm] = Form.useForm();
  const [blockForm] = Form.useForm();
  const blockRecurrence = Form.useWatch("recurrence", blockForm) || "SINGLE";
  const isAdmin = user?.role === "PLATFORM_ADMIN" && !user.simulation;

  const weekStart = useMemo(() => {
    const day = date.day();
    return date.subtract(day === 0 ? 6 : day - 1, "day").startOf("day");
  }, [date]);

  const tableRows = useMemo(() => {
    const dates = viewMode === "DAY"
      ? [date.startOf("day")]
      : Array.from({ length: 7 }, (_, index) => weekStart.add(index, "day"));
    return dates.flatMap((rowDate) => timeSlots.map((slot) => ({
      key: `${rowDate.format("YYYY-MM-DD")}-${slot.value}`,
      dateKey: rowDate.format("YYYY-MM-DD"),
      weekday: rowDate.day(),
      value: slot.value,
      label: viewMode === "DAY"
        ? slot.label
        : `${rowDate.format("MM-DD")} ${weekdays.find((item) => item.value === rowDate.day())?.label} ${slot.label}`,
    })));
  }, [date, viewMode, weekStart]);

  const load = useCallback(async () => {
    const start = viewMode === "DAY" ? date.startOf("day") : weekStart;
    const end = viewMode === "DAY" ? start.add(1, "day") : start.add(7, "day");
    setLoading(true);
    try {
      const [interviewers, data] = await Promise.all([
        calendarApi.interviewers(line),
        calendarApi.board(start.toISOString(), end.toISOString(), line, selectedInterviewerIds),
      ]);
      setProfiles(interviewers);
      setBoard(data);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [date, line, selectedInterviewerIds, viewMode, weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  const eventsByCell = useMemo(() => {
    const result = new Map<string, CalendarEvent[]>();
    for (const event of board?.events || []) {
      const start = dayjs(event.start);
      const end = dayjs(event.end);
      for (const slot of tableRows) {
        const slotStart = dayjs(`${slot.dateKey}T00:00:00`).add(slot.value, "minute");
        const slotEnd = slotStart.add(30, "minute");
        const bufferedEventEnd = event.kind === "INTERVIEW" ? end.add(10, "minute") : end;
        if (start.isBefore(slotEnd.add(10, "minute")) && bufferedEventEnd.isAfter(slotStart)) {
          const key = `${event.interviewerId}-${slot.key}`;
          result.set(key, [...(result.get(key) || []), event]);
        }
      }
    }
    return result;
  }, [board?.events, tableRows]);

  const saveInterviewer = async () => {
    const values = await interviewerForm.validateFields();
    try {
      if (editingProfile) {
        const body = { ...values };
        delete body.email;
        if (!body.password) delete body.password;
        await calendarApi.updateInterviewer(editingProfile.id, body);
        message.success("面试官配置已更新");
      } else {
        await calendarApi.createInterviewer(values);
        message.success("面试官账号和日历档案已创建");
      }
      setInterviewerOpen(false);
      setEditingProfile(null);
      interviewerForm.resetFields();
      await load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const saveBlock = async () => {
    if (!blockProfile) return;
    const values = await blockForm.validateFields();
    try {
      let payload: Record<string, unknown>;
      if (values.recurrence === "WEEKLY") {
        const effectiveRange = values.effectiveRange as [Dayjs, Dayjs] | undefined;
        payload = {
          recurrence: "WEEKLY",
          type: values.type,
          title: values.title,
          reason: values.reason,
          weekday: values.weekday,
          startMinute: values.startMinute,
          endMinute: values.endMinute,
          effectiveFrom: effectiveRange?.[0]?.startOf("day").toISOString(),
          effectiveTo: effectiveRange?.[1]?.endOf("day").toISOString(),
        };
      } else {
        const range = values.range as [Dayjs, Dayjs];
        payload = {
          recurrence: "SINGLE",
          type: values.type,
          title: values.title,
          reason: values.reason,
          startAt: range[0].toISOString(),
          endAt: range[1].toISOString(),
        };
      }
      if (editingBlock) await calendarApi.updateBlock(editingBlock.id, payload);
      else await calendarApi.createBlock(blockProfile.id, payload);
      message.success(editingBlock ? "不可用时间已更新" : "不可用时间已锁定");
      setEditingBlock(null);
      blockForm.resetFields();
      blockForm.setFieldsValue({ recurrence: "SINGLE", type: "TEMPORARILY_UNAVAILABLE", title: "管理员锁定" });
      setBlocks(await calendarApi.blocks(blockProfile.id));
      await load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const openInterviewer = (profile?: InterviewerProfile) => {
    const editing = profile || null;
    setEditingProfile(editing);
    interviewerForm.resetFields();
    interviewerForm.setFieldsValue(editing ? {
      name: editing.user.name,
      email: editing.user.email,
      department: editing.department,
      kimUserId: editing.user.kimUserId,
      businessLines: editing.businessLines,
      workingDays: editing.workingDays,
      workStartMinute: editing.workStartMinute,
      workEndMinute: editing.workEndMinute,
      positionIds: editing.positionIds,
    } : {
      businessLines: ["VIDEO", "AUDIO"],
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 540,
      workEndMinute: 1260,
      positionIds: [],
    });
    setInterviewerOpen(true);
  };

  const openBlocks = async (profile: InterviewerProfile) => {
    setBlockProfile(profile);
    setBlocks([]);
    setEditingBlock(null);
    blockForm.resetFields();
    blockForm.setFieldsValue({ recurrence: "SINGLE", type: "TEMPORARILY_UNAVAILABLE", title: "管理员锁定" });
    setBlocksLoading(true);
    try {
      setBlocks(await calendarApi.blocks(profile.id));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBlocksLoading(false);
    }
  };

  const editBlock = (block: InterviewerCalendarBlock) => {
    setEditingBlock(block);
    blockForm.resetFields();
    blockForm.setFieldsValue(block.recurrence === "WEEKLY" ? {
      recurrence: "WEEKLY",
      type: block.type,
      title: block.title,
      reason: block.reason,
      weekday: block.weekday,
      startMinute: block.startMinute,
      endMinute: block.endMinute,
      effectiveRange: block.effectiveFrom && block.effectiveTo
        ? [dayjs(block.effectiveFrom), dayjs(block.effectiveTo)]
        : undefined,
    } : {
      recurrence: "SINGLE",
      type: block.type,
      title: block.title,
      reason: block.reason,
      range: block.startAt && block.endAt ? [dayjs(block.startAt), dayjs(block.endAt)] : undefined,
    });
  };

  const removeBlock = async (id: string) => {
    if (!blockProfile) return;
    try {
      await calendarApi.removeBlock(id);
      message.success("不可用时间已取消");
      setBlocks(await calendarApi.blocks(blockProfile.id));
      await load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const columns: any[] = [
    {
      title: "时间",
      dataIndex: "label",
      width: 86,
      fixed: "left",
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    ...(board?.profiles || []).map((profile) => ({
      title: (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{profile.user.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{profile.department || "未设部门"}</Typography.Text>
          {isAdmin && <Space size={0}>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openInterviewer(profile)}>配置</Button>
            <Button type="link" size="small" icon={<StopOutlined />} onClick={() => void openBlocks(profile)}>不可用时间</Button>
          </Space>}
        </Space>
      ),
      key: profile.id,
      width: 200,
      render: (_: unknown, row: { key: string; dateKey: string; weekday: number; value: number }) => {
        const events = eventsByCell.get(`${profile.id}-${row.key}`) || [];
        const withinWorkingTime = profile.workingDays.includes(row.weekday)
          && row.value >= profile.workStartMinute
          && row.value + 30 <= profile.workEndMinute;
        if (!events.length)
          return withinWorkingTime
            ? <Typography.Text type="success">可预约</Typography.Text>
            : <Typography.Text type="secondary">不可预约</Typography.Text>;
        return (
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            {events.map((event) => {
              const slotStart = dayjs(`${row.dateKey}T00:00:00`).add(row.value, "minute");
              const slotEnd = slotStart.add(30, "minute");
              const actualEvent = dayjs(event.start).isBefore(slotEnd) && dayjs(event.end).isAfter(slotStart);
              return (
              <div
                key={event.id}
                style={{ background: eventColor(event), border: "1px solid #d9d9d9", borderRadius: 6, padding: "4px 7px" }}
                title={event.detailsVisible ? [event.supplierName, event.positionName, event.ownerName].filter(Boolean).join(" · ") : "其他外包公司的安排仅显示忙碌"}
              >
                <Typography.Text style={{ fontSize: 12 }}>{actualEvent ? event.title : "缓冲时间"}</Typography.Text>
              </div>
              );
            })}
          </Space>
        );
      },
    })),
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
          <div>
            <Typography.Title level={3} style={{ margin: 0 }}><CalendarOutlined /> 面试官时间看板</Typography.Title>
            <Typography.Text type="secondary">跨外包公司统一占用面试官时间；其他公司的安排只显示“已占用”。</Typography.Text>
          </div>
          <Space wrap>
            <Segmented
              value={viewMode}
              onChange={(value) => setViewMode(value as "DAY" | "WEEK")}
              options={[{ value: "DAY", label: "日视图" }, { value: "WEEK", label: "周视图" }]}
            />
            <DatePicker value={date} onChange={(value) => value && setDate(value)} allowClear={false} />
            <Select
              allowClear
              placeholder="全部业务线"
              value={line}
              onChange={(value) => { setLine(value); setSelectedInterviewerIds([]); }}
              options={lineOptions.filter((option) => !userLines.length || userLines.includes(option.value as UserBusinessLine))}
              style={{ width: 150 }}
            />
            <Select
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              placeholder="全部面试官"
              value={selectedInterviewerIds}
              onChange={setSelectedInterviewerIds}
              options={profiles.map((profile) => ({ value: profile.id, label: profile.user.name }))}
              style={{ minWidth: 180, maxWidth: 320 }}
            />
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
            {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => openInterviewer()}>新增面试官</Button>}
          </Space>
        </Space>
      </Card>

      <Alert
        type="info"
        showIcon
        message="统一排期规则"
        description="每场固定 30 分钟，前后排期至少间隔 10 分钟。工作日默认 09:00–21:00；11:50–13:30 和 18:00–18:30 固定不接受预约。"
      />

      <Card bodyStyle={{ padding: 0 }}>
        {board?.profiles.length ? (
          <Table
            rowKey="key"
            loading={loading}
            dataSource={tableRows}
            columns={columns}
            pagination={false}
            size="small"
            bordered
            scroll={{ x: Math.max(900, board.profiles.length * 200 + 90), y: 620 }}
          />
        ) : (
          <Alert type="warning" showIcon message="当前业务线尚未配置可用面试官" />
        )}
      </Card>

      <Modal
        title={editingProfile ? `编辑面试官 · ${editingProfile.user.name}` : "新增面试官"}
        open={interviewerOpen}
        onCancel={() => { setInterviewerOpen(false); setEditingProfile(null); }}
        onOk={() => void saveInterviewer()}
        width={720}
        destroyOnClose
      >
        <Form form={interviewerForm} layout="vertical">
          <Space wrap align="start">
            <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input style={{ width: 180 }} /></Form.Item>
            <Form.Item name="email" label="登录邮箱" rules={editingProfile ? [] : [{ required: true, type: "email" }]}>
              <Input style={{ width: 250 }} disabled={Boolean(editingProfile)} />
            </Form.Item>
            <Form.Item
              name="password"
              label={editingProfile ? "重置密码（选填）" : "初始密码"}
              rules={editingProfile ? [{ min: 8 }] : [{ required: true, min: 8 }]}
            ><Input.Password style={{ width: 200 }} /></Form.Item>
          </Space>
          <Space wrap align="start">
            <Form.Item name="department" label="部门"><Input style={{ width: 200 }} /></Form.Item>
            <Form.Item name="kimUserId" label="Kim 用户 ID"><Input style={{ width: 220 }} /></Form.Item>
            <Form.Item name="businessLines" label="可面试业务线" rules={[{ required: true }]}><Checkbox.Group options={lineOptions} /></Form.Item>
          </Space>
          <Form.Item name="workingDays" label="工作日" rules={[{ required: true }]}><Checkbox.Group options={weekdays} /></Form.Item>
          <Space align="start">
            <Form.Item name="workStartMinute" label="工作开始" rules={[{ required: true }]}><Select style={{ width: 130 }} options={minuteOptions} /></Form.Item>
            <Form.Item name="workEndMinute" label="工作结束" rules={[{ required: true }]}><Select style={{ width: 130 }} options={minuteOptions} /></Form.Item>
            <Form.Item name="positionIds" label="岗位 ID 限制"><Select mode="tags" style={{ width: 280 }} placeholder="留空表示不限岗位" /></Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={`管理不可用时间 · ${blockProfile?.user.name || ""}`}
        open={Boolean(blockProfile)}
        onCancel={() => { setBlockProfile(null); setEditingBlock(null); }}
        onOk={() => void saveBlock()}
        okText={editingBlock ? "保存修改" : "新增锁定"}
        width={720}
        destroyOnClose
      >
        <Form form={blockForm} layout="vertical">
          <Form.Item name="recurrence" label="锁定方式" rules={[{ required: true }]}>
            <Select options={[{ value: "SINGLE", label: "一次性" }, { value: "WEEKLY", label: "每周重复" }]} />
          </Form.Item>
          <Form.Item name="type" label="不可用类型" rules={[{ required: true }]}>
            <Select options={blockTypeOptions} />
          </Form.Item>
          {blockRecurrence === "WEEKLY" ? <>
            <Space wrap align="start">
              <Form.Item name="weekday" label="每周" rules={[{ required: true }]}><Select options={weekdays} style={{ width: 130 }} /></Form.Item>
              <Form.Item name="startMinute" label="开始时间" rules={[{ required: true }]}><Select options={minuteOptions} style={{ width: 130 }} /></Form.Item>
              <Form.Item name="endMinute" label="结束时间" rules={[{ required: true }]}><Select options={minuteOptions} style={{ width: 130 }} /></Form.Item>
            </Space>
            <Form.Item name="effectiveRange" label="生效日期范围（留空表示长期生效）">
              <DatePicker.RangePicker style={{ width: "100%" }} />
            </Form.Item>
          </> : (
            <Form.Item name="range" label="不可用时间" rules={[{ required: true }]}>
              <DatePicker.RangePicker showTime={{ minuteStep: 10 }} format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} />
            </Form.Item>
          )}
          <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input prefix={<ClockCircleOutlined />} /></Form.Item>
          <Form.Item name="reason" label="原因"><Input.TextArea rows={3} /></Form.Item>
        </Form>
        <Divider>当前有效锁定</Divider>
        <Table
          rowKey="id"
          size="small"
          loading={blocksLoading}
          pagination={false}
          dataSource={blocks}
          locale={{ emptyText: "暂无管理员锁定" }}
          columns={[
            { title: "标题", dataIndex: "title" },
            {
              title: "时间",
              render: (_: unknown, row: InterviewerCalendarBlock) => row.recurrence === "WEEKLY"
                ? `${weekdays.find((item) => item.value === row.weekday)?.label || "每周"} ${minuteLabel(row.startMinute)}–${minuteLabel(row.endMinute)}`
                : `${dayjs(row.startAt).format("YYYY-MM-DD HH:mm")}–${dayjs(row.endAt).format("YYYY-MM-DD HH:mm")}`,
            },
            {
              title: "操作",
              width: 130,
              render: (_: unknown, row: InterviewerCalendarBlock) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => editBlock(row)}>编辑</Button>
                  <Popconfirm title="确认取消该锁定？" onConfirm={() => void removeBlock(row.id)}>
                    <Button type="link" danger size="small">取消</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Modal>
    </Space>
  );
}
