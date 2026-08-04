import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  message,
  Modal,
  Select,
  Space,
  Spin,
  Steps,
  Tag,
  Timeline,
  Typography,
} from "antd";
import {
  CalendarOutlined,
  CheckCircleOutlined,
  FileDoneOutlined,
  GiftOutlined,
  LinkOutlined,
  ReloadOutlined,
  SendOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { workflowApi, type WorkflowDetail, type WorkflowInterview, type WorkflowLevelAdjustment } from "../../api/workflowApi";

const defaultFeedbackDimensions = ["专业能力", "沟通能力", "岗位匹配度"];
const offerLabels = {
  PENDING_INITIATION: "待发起",
  SENT: "已发出",
  CANDIDATE_CONFIRMED: "候选人已确认",
  REJECTED: "已拒绝",
  EXPIRED: "已失效",
};
const levelLabels = { PENDING: "待审批", APPROVED: "已同意", REJECTED: "已拒绝", WITHDRAWN: "已撤回" };
const workflowSteps = ["简历待筛选", "待安排面试", "待面试", "面试待反馈", "面试通过", "待确认入职", "待入职", "培训中", "项目中"];
const internalRoles = new Set(["PLATFORM_ADMIN", "DEPARTMENT_MANAGER", "INTERNAL_RECRUITER", "VIDEO_RECRUITER", "AUDIO_RECRUITER"]);
const managerRoles = new Set(["PLATFORM_ADMIN", "DEPARTMENT_MANAGER"]);

interface Props {
  applicationId?: string | null;
  businessLine?: string;
  onClose: () => void;
  onChanged?: () => void;
}

export default function ApplicationWorkflowDrawer({ applicationId, businessLine, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedulingRequestOpen, setSchedulingRequestOpen] = useState(false);
  const [bookingUrl, setBookingUrl] = useState("");
  const [feedbackInterview, setFeedbackInterview] = useState<WorkflowInterview | null>(null);
  const [concludeOpen, setConcludeOpen] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);
  const [reviewAdjustment, setReviewAdjustment] = useState<WorkflowLevelAdjustment | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [scheduleForm] = Form.useForm();
  const [schedulingRequestForm] = Form.useForm();
  const [feedbackForm] = Form.useForm();
  const [conclusionForm] = Form.useForm();
  const [levelForm] = Form.useForm();
  const [reviewForm] = Form.useForm();
  const [onboardingForm] = Form.useForm();
  const isInternal = Boolean(user && internalRoles.has(user.role));
  const isManager = Boolean(user && managerRoles.has(user.role));
  const feedbackTemplate = useMemo(() => {
    const configured = detail?.position?.feedbackTemplate as { version?: unknown; dimensions?: unknown } | null | undefined;
    const dimensions = Array.isArray(configured?.dimensions)
      ? [...new Set(configured.dimensions.map((item) => String(item).trim()).filter(Boolean))].slice(0, 10)
      : [];
    return {
      version: typeof configured?.version === "string" && configured.version.trim() ? configured.version.trim() : "default-v1",
      dimensions: dimensions.length ? dimensions : defaultFeedbackDimensions,
    };
  }, [detail?.position?.feedbackTemplate]);

  const load = async () => {
    if (!applicationId) return;
    setLoading(true);
    try {
      setDetail(await workflowApi.detail(applicationId, businessLine));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "流程详情加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setDetail(null);
    if (applicationId) void load();
  }, [applicationId, businessLine]);

  const run = async (successText: string, task: () => Promise<unknown>) => {
    setActing(true);
    try {
      await task();
      message.success(successText);
      await load();
      onChanged?.();
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
      return false;
    } finally {
      setActing(false);
    }
  };

  const currentStep = useMemo(() => {
    if (!detail) return 0;
    const index = workflowSteps.indexOf(detail.currentStatus);
    return index < 0 ? 0 : index;
  }, [detail]);

  const latestOffer = detail?.offers[0];
  const activeInterviews = detail?.interviews.filter((item) => !["已取消", "取消"].includes(item.status)) || [];
  const canConclude = activeInterviews.length > 0
    && activeInterviews.every((item) => item.feedbackRecord?.status === "SUBMITTED");

  const transition = (targetStatus: string, reason: string, title: string) => {
    if (!detail) return;
    Modal.confirm({
      title,
      content: reason,
      okText: "确认",
      cancelText: "取消",
      onOk: () => run("状态已更新", () => workflowApi.transition(detail.id, targetStatus, reason)),
    });
  };

  const submitSchedule = async () => {
    const values = await scheduleForm.validateFields();
    const range = values.timeRange as [Dayjs, Dayjs];
    const ok = await run("面试已排期并生成会议记录", () => workflowApi.scheduleInterview(detail!.id, {
      scheduledStartTime: range[0].toISOString(),
      scheduledEndTime: range[1].toISOString(),
      round: values.round,
      roundName: values.roundName,
      interviewer: values.interviewer,
    }));
    if (ok) {
      setScheduleOpen(false);
      scheduleForm.resetFields();
    }
  };

  const submitSchedulingRequest = async () => {
    const values = await schedulingRequestForm.validateFields();
    const ranges = [values.slot1, values.slot2, values.slot3] as Array<[Dayjs, Dayjs]>;
    setActing(true);
    const result = await workflowApi.createSchedulingRequest(detail!.id, {
      interviewer: values.interviewer,
      round: values.round,
      roundName: values.roundName,
      slots: ranges.map((range) => ({ start: range[0].toISOString(), end: range[1].toISOString() })),
      expiresInHours: 72,
    }).catch((error) => {
      message.error(error instanceof Error ? error.message : "自助约面链接生成失败");
      return null;
    });
    if (result) {
      setBookingUrl(result.bookingUrl);
      message.success("候选人自助选时段链接已生成");
      await load();
    }
    setActing(false);
  };

  const submitFeedback = async () => {
    const values = await feedbackForm.validateFields();
    const scores = Object.fromEntries(feedbackTemplate.dimensions.map((dimension) => [dimension, values[dimension]]));
    const ok = await run("面评已提交", () => workflowApi.submitFeedback(feedbackInterview!.id, { templateVersion: feedbackTemplate.version, dimensionScores: scores, comment: values.comment }));
    if (ok) {
      setFeedbackInterview(null);
      feedbackForm.resetFields();
    }
  };

  const submitConclusion = async () => {
    const values = await conclusionForm.validateFields();
    const ok = await run("面试结论已生成", () => workflowApi.conclude(detail!.id, values));
    if (ok) {
      setConcludeOpen(false);
      conclusionForm.resetFields();
    }
  };

  const submitLevel = async () => {
    const values = await levelForm.validateFields();
    const ok = await run("职级调整已提交审批", () => workflowApi.requestLevelAdjustment(detail!.id, values.requestedLevel, values.reason));
    if (ok) {
      setLevelOpen(false);
      levelForm.resetFields();
    }
  };

  const submitReview = async () => {
    const values = await reviewForm.validateFields();
    const ok = await run("职级调整已审批", () => workflowApi.reviewLevelAdjustment(reviewAdjustment!.id, values.decision, values.comment));
    if (ok) {
      setReviewAdjustment(null);
      reviewForm.resetFields();
    }
  };

  const submitOnboarding = async () => {
    const values = await onboardingForm.validateFields();
    const result = values.result as "CONFIRMED" | "DECLINED";
    const ok = await run(result === "CONFIRMED" ? "入职日期已确认，接待任务已自动生成" : "已回写不入职结果", () =>
      workflowApi.confirmOnboarding(detail!.id, {
        result,
        entryDate: values.entryDate?.toISOString(),
        assigneeName: values.assigneeName,
        note: values.note,
      }));
    if (ok) {
      setOnboardingOpen(false);
      onboardingForm.resetFields();
    }
  };

  const openFeedback = (interview: WorkflowInterview) => {
    setFeedbackInterview(interview);
    feedbackForm.setFieldsValue({ ...interview.feedbackRecord?.dimensionScores, comment: interview.feedbackRecord?.comment });
  };

  return <>
    <Drawer
      open={Boolean(applicationId)}
      onClose={onClose}
      width={920}
      destroyOnClose
      title={detail ? `${detail.candidate.name} · ${detail.applicationNo}` : "招聘流程详情"}
      extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>}
    >
      {loading && !detail ? <div style={{ textAlign: "center", padding: 80 }}><Spin size="large" /></div> : detail ? <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card size="small">
          <Descriptions size="small" column={3}>
            <Descriptions.Item label="候选人">{detail.candidate.name}</Descriptions.Item>
            <Descriptions.Item label="业务部门">{detail.businessLine === "VIDEO" ? "视频" : detail.businessLine === "AUDIO" ? "音频" : "待归类"}</Descriptions.Item>
            <Descriptions.Item label="当前状态"><Tag color="blue">{detail.currentStatus}</Tag></Descriptions.Item>
            <Descriptions.Item label="供应商">{detail.supplier.name}</Descriptions.Item>
            <Descriptions.Item label="岗位">{detail.position?.name || "—"}</Descriptions.Item>
            <Descriptions.Item label="联系方式">{detail.candidate.phoneMasked || detail.candidate.emailMasked || "—"}</Descriptions.Item>
          </Descriptions>
          <Steps size="small" current={currentStep} items={workflowSteps.map((title) => ({ title }))} style={{ marginTop: 20, overflowX: "auto" }} />
          {isInternal && detail.currentStatus === "简历待筛选" && <Space style={{ marginTop: 18 }}>
            <Button type="primary" onClick={() => transition("待安排面试", "人工确认简历通过", "确认简历通过？")}>简历通过</Button>
            <Button danger onClick={() => transition("简历未通过", "人工确认简历不通过", "确认淘汰该简历？")}>简历不通过</Button>
          </Space>}
        </Card>

        <Card title={<><CalendarOutlined /> 面试排期与面评</>} size="small" extra={
          ["待安排面试", "待面试", "面试待反馈"].includes(detail.currentStatus)
            ? <Space>
              <Button icon={<LinkOutlined />} onClick={() => { setBookingUrl(""); schedulingRequestForm.setFieldsValue({ round: detail.interviews.length + 1, roundName: `第${detail.interviews.length + 1}轮` }); setSchedulingRequestOpen(true); }}>邀请候选人选时段</Button>
              <Button type="primary" onClick={() => { scheduleForm.setFieldsValue({ round: detail.interviews.length + 1, roundName: `第${detail.interviews.length + 1}轮` }); setScheduleOpen(true); }}>直接安排面试</Button>
            </Space>
            : null
        }>
          {detail.interviews.length ? <List
            dataSource={detail.interviews}
            renderItem={(interview) => <List.Item actions={[
              <Button key="feedback" type={interview.feedbackRecord?.status === "SUBMITTED" ? "default" : "primary"} onClick={() => openFeedback(interview)}>
                {interview.feedbackRecord?.status === "SUBMITTED" ? "查看/更新面评" : "提交面评"}
              </Button>,
            ]}>
              <List.Item.Meta
                title={<Space><Typography.Text strong>{interview.roundName || `第${interview.round}轮`}</Typography.Text><Tag>{interview.status}</Tag>{interview.feedbackRecord?.status === "OVERDUE" && <Tag color="red">面评超时</Tag>}</Space>}
                description={<Space direction="vertical" size={2}>
                  <span>{dayjs(interview.scheduledStartTime).format("YYYY-MM-DD HH:mm")} – {interview.scheduledEndTime ? dayjs(interview.scheduledEndTime).format("HH:mm") : "未设置"} · 面试官：{interview.interviewer || "—"}</span>
                  <span>面评截止：{interview.feedbackDueAt ? dayjs(interview.feedbackDueAt).format("YYYY-MM-DD HH:mm") : "—"}{interview.feedbackRecord?.submittedByName ? ` · ${interview.feedbackRecord.submittedByName} 已提交` : ""}</span>
                  {interview.meetingUrl && <Typography.Link href={interview.meetingUrl} target="_blank">进入腾讯会议</Typography.Link>}
                </Space>}
              />
            </List.Item>}
          /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未安排面试" />}
          {isInternal && ["待面试", "面试待反馈", "面试通过"].includes(detail.currentStatus) && <Button icon={<FileDoneOutlined />} disabled={!canConclude} title={!canConclude ? "所有有效面试轮次提交完整面评后才可生成结论" : undefined} onClick={() => setConcludeOpen(true)}>生成最终结论</Button>}
          {isInternal && activeInterviews.length > 0 && !canConclude && <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>所有有效面试轮次提交完整面评后，才可生成最终结论。</Typography.Paragraph>}
          {detail.conclusion && <Alert style={{ marginTop: 12 }} type={detail.conclusion.finalResult === "通过" ? "success" : "error"} showIcon message={`最终结论：${detail.conclusion.finalResult}${detail.conclusion.finalLevel ? ` · ${detail.conclusion.finalLevel}` : ""}`} description={`${detail.conclusion.decidedByName} · ${dayjs(detail.conclusion.decidedAt).format("YYYY-MM-DD HH:mm")}`} />}
        </Card>

        <Card title={<><GiftOutlined /> Offer 状态机</>} size="small" extra={isInternal && detail.currentStatus === "面试通过" && !["PENDING_INITIATION", "SENT"].includes(latestOffer?.status || "") ? <Button type="primary" onClick={() => void run("Offer 已发起", () => workflowApi.createOffer(detail.id))}>发起 Offer</Button> : null}>
          {latestOffer ? <Descriptions size="small" column={2}>
            <Descriptions.Item label="状态"><Tag color={latestOffer.status === "CANDIDATE_CONFIRMED" ? "green" : latestOffer.status === "REJECTED" || latestOffer.status === "EXPIRED" ? "red" : "blue"}>{offerLabels[latestOffer.status]}</Tag></Descriptions.Item>
            <Descriptions.Item label="发起人">{latestOffer.initiatedByName}</Descriptions.Item>
            <Descriptions.Item label="发出时间">{latestOffer.sentAt ? dayjs(latestOffer.sentAt).format("YYYY-MM-DD HH:mm") : "—"}</Descriptions.Item>
            <Descriptions.Item label="候选人反馈">{latestOffer.candidateRespondedAt ? dayjs(latestOffer.candidateRespondedAt).format("YYYY-MM-DD HH:mm") : "—"}</Descriptions.Item>
          </Descriptions> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未发起 Offer" />}
          {latestOffer && <Space wrap>
            {isInternal && latestOffer.status === "PENDING_INITIATION" && <Button type="primary" icon={<SendOutlined />} onClick={() => void run("Offer 已发出", () => workflowApi.sendOffer(latestOffer.id))}>标记已发出</Button>}
            {latestOffer.status === "SENT" && <>
              <Button type="primary" onClick={() => void run("已记录候选人接受 Offer", () => workflowApi.respondOffer(latestOffer.id, "CONFIRMED"))}>候选人接受</Button>
              <Button danger onClick={() => Modal.confirm({ title: "记录候选人拒绝 Offer？", onOk: () => run("已记录候选人拒绝", () => workflowApi.respondOffer(latestOffer.id, "REJECTED", "候选人拒绝 Offer")) })}>候选人拒绝</Button>
              {isInternal && <Button onClick={() => void run("Offer 已失效", () => workflowApi.expireOffer(latestOffer.id))}>标记失效</Button>}
            </>}
          </Space>}
        </Card>

        <Card title="职级调整审批" size="small" extra={<Button onClick={() => setLevelOpen(true)}>申请调整职级</Button>}>
          {detail.levelAdjustments.length ? <List dataSource={detail.levelAdjustments} renderItem={(item) => <List.Item actions={isManager && item.status === "PENDING" ? [<Button key="review" onClick={() => setReviewAdjustment(item)}>审批</Button>] : []}>
            <List.Item.Meta title={<Space><b>{item.requestedLevel}</b><Tag>{levelLabels[item.status]}</Tag></Space>} description={`${item.requestedByName}：${item.reason}${item.reviewComment ? `；审批意见：${item.reviewComment}` : ""}`} />
          </List.Item>} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无职级调整" />}
        </Card>

        <Card title={<><TeamOutlined /> 入职确认与接待闭环</>} size="small" extra={latestOffer?.status === "CANDIDATE_CONFIRMED" && !detail.onboarding ? <Button type="primary" onClick={() => { onboardingForm.setFieldsValue({ result: "CONFIRMED", assigneeName: "入职接待同学" }); setOnboardingOpen(true); }}>确认入职结果</Button> : null}>
          {detail.onboarding ? <Alert showIcon type={detail.onboarding.result === "CONFIRMED" ? "success" : "warning"} message={detail.onboarding.result === "CONFIRMED" ? `已确认入职：${dayjs(detail.onboarding.entryDate).format("YYYY-MM-DD")}` : "候选人确认不入职"} description={`${detail.onboarding.confirmedByName}${detail.onboarding.note ? ` · ${detail.onboarding.note}` : ""}`} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Offer 接受后可确认入职日期" />}
          {detail.receptionTask && <Card type="inner" title={`接待任务 · ${detail.receptionTask.assigneeName || "待指派"}`} extra={<Tag color={detail.receptionTask.status === "COMPLETED" ? "green" : "blue"}>{detail.receptionTask.status}</Tag>} style={{ marginTop: 12 }}>
            <Typography.Paragraph type="secondary">计划入职：{dayjs(detail.receptionTask.dueAt).format("YYYY-MM-DD HH:mm")}</Typography.Paragraph>
            <Space direction="vertical">
              {detail.receptionTask.checklist.map((item) => <Checkbox key={item.id} checked={item.completed} disabled={detail.receptionTask?.status === "COMPLETED" || acting} onChange={(event) => void run("接待清单已更新", () => workflowApi.toggleChecklist(detail.receptionTask!.id, item.id, event.target.checked))}>{item.title}{item.required ? "（必填）" : ""}</Checkbox>)}
            </Space>
            {detail.receptionTask.status !== "COMPLETED" && <div style={{ marginTop: 16 }}><Button type="primary" icon={<CheckCircleOutlined />} disabled={detail.receptionTask.checklist.some((item) => item.required && !item.completed)} onClick={() => void run("接待已完成，候选人进入培训中", () => workflowApi.completeReception(detail.receptionTask!.id))}>完成接待并回执</Button></div>}
          </Card>}
        </Card>

        <Card title="状态变更留痕" size="small">
          {detail.statusEvents.length ? <Timeline items={detail.statusEvents.slice().reverse().map((event) => ({ children: <><b>{event.fromStatus ? `${event.fromStatus} → ` : ""}{event.toStatus}</b><br /><Typography.Text type="secondary">{dayjs(event.occurredAt).format("YYYY-MM-DD HH:mm")} · {event.operatorName}{event.reason ? ` · ${event.reason}` : ""}</Typography.Text></> }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无状态变更记录" />}
        </Card>
      </Space> : null}
    </Drawer>

    <Modal open={scheduleOpen} title="安排面试" onCancel={() => setScheduleOpen(false)} onOk={() => void submitSchedule()} confirmLoading={acting} destroyOnClose>
      <Form form={scheduleForm} layout="vertical">
        <Form.Item name="timeRange" label="面试时间" rules={[{ required: true, message: "请选择开始和结束时间" }]}><DatePicker.RangePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} /></Form.Item>
        <Space align="start" style={{ width: "100%" }}>
          <Form.Item name="round" label="轮次" rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item>
          <Form.Item name="roundName" label="轮次名称" rules={[{ required: true }]}><Input placeholder="例如：业务复试" /></Form.Item>
        </Space>
        <Form.Item name="interviewer" label="面试官" rules={[{ required: true, message: "请填写面试官" }]}><Input placeholder="同一面试官冲突时段将被拦截" /></Form.Item>
      </Form>
    </Modal>

    <Modal open={schedulingRequestOpen} title="邀请候选人自助选择面试时段" width={650} onCancel={() => setSchedulingRequestOpen(false)} onOk={bookingUrl ? () => setSchedulingRequestOpen(false) : () => void submitSchedulingRequest()} okText={bookingUrl ? "完成" : "生成邀请链接"} confirmLoading={acting} destroyOnClose>
      {bookingUrl ? <Alert type="success" showIcon message="一次性预约链接已生成（72 小时有效）" description={<Space.Compact style={{ width: "100%", marginTop: 8 }}><Input value={bookingUrl} readOnly /><Button onClick={() => void navigator.clipboard.writeText(bookingUrl).then(() => message.success("链接已复制")).catch(() => message.warning("浏览器未授权自动复制，请手工复制链接"))}>复制</Button></Space.Compact>} /> : <>
        <Alert type="info" showIcon message="候选人将在公开页面中看到三个可选时段；提交时平台会再次校验面试官日历，避免并发冲突。" style={{ marginBottom: 16 }} />
        <Form form={schedulingRequestForm} layout="vertical">
          <Space align="start"><Form.Item name="round" label="轮次" rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item><Form.Item name="roundName" label="轮次名称" rules={[{ required: true }]}><Input /></Form.Item></Space>
          <Form.Item name="interviewer" label="面试官" rules={[{ required: true, message: "请填写面试官" }]}><Input /></Form.Item>
          {[1, 2, 3].map((index) => <Form.Item key={index} name={`slot${index}`} label={`候选时段 ${index}`} rules={[{ required: true, message: "请选择完整时段" }]}><DatePicker.RangePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} /></Form.Item>)}
        </Form>
      </>}
    </Modal>

    <Modal open={Boolean(feedbackInterview)} title={`提交面评 · ${feedbackInterview?.roundName || "面试"}`} onCancel={() => setFeedbackInterview(null)} onOk={() => void submitFeedback()} confirmLoading={acting} destroyOnClose>
      <Alert type="info" showIcon message="所有维度均为必填，面评提交后才允许生成最终结论；结束 24 小时未提交将触发催办。" style={{ marginBottom: 16 }} />
      <Form form={feedbackForm} layout="vertical">
        <Space wrap>{feedbackTemplate.dimensions.map((dimension) => <Form.Item key={dimension} name={dimension} label={dimension} rules={[{ required: true, message: "请评分" }]}><InputNumber min={1} max={5} precision={0} addonAfter="/ 5" /></Form.Item>)}</Space>
        <Form.Item name="comment" label="面试评语" rules={[{ required: true }, { min: 5, message: "评语不少于 5 个字" }]}><Input.TextArea rows={4} maxLength={1000} showCount /></Form.Item>
      </Form>
    </Modal>

    <Modal open={concludeOpen} title="生成最终面试结论" onCancel={() => setConcludeOpen(false)} onOk={() => void submitConclusion()} confirmLoading={acting} destroyOnClose>
      <Form form={conclusionForm} layout="vertical">
        <Form.Item name="finalResult" label="结论" rules={[{ required: true }]}><Select options={[{ value: "通过", label: "通过" }, { value: "不通过", label: "不通过" }]} /></Form.Item>
        <Form.Item noStyle shouldUpdate={(previous, current) => previous.finalResult !== current.finalResult}>{({ getFieldValue }) => getFieldValue("finalResult") === "通过" ? <Form.Item name="finalLevel" label="定级" rules={[{ required: true, message: "面试通过必须定级" }]}><Input placeholder="例如：P5" /></Form.Item> : null}</Form.Item>
        <Form.Item name="reason" label="决策说明" rules={[{ required: true }, { min: 2 }]}><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>

    <Modal open={levelOpen} title="申请调整职级" onCancel={() => setLevelOpen(false)} onOk={() => void submitLevel()} confirmLoading={acting} destroyOnClose>
      <Form form={levelForm} layout="vertical"><Form.Item name="requestedLevel" label="申请职级" rules={[{ required: true }]}><Input placeholder="例如：P6" /></Form.Item><Form.Item name="reason" label="申请理由" rules={[{ required: true }, { min: 2 }]}><Input.TextArea rows={4} /></Form.Item></Form>
    </Modal>

    <Modal open={Boolean(reviewAdjustment)} title={`审批职级调整 · ${reviewAdjustment?.requestedLevel || ""}`} onCancel={() => setReviewAdjustment(null)} onOk={() => void submitReview()} confirmLoading={acting} destroyOnClose>
      <Form form={reviewForm} layout="vertical"><Form.Item name="decision" label="审批结果" rules={[{ required: true }]}><Select options={[{ value: "APPROVED", label: "同意" }, { value: "REJECTED", label: "拒绝" }]} /></Form.Item><Form.Item name="comment" label="审批意见" rules={[{ required: true }, { min: 2 }]}><Input.TextArea rows={4} /></Form.Item></Form>
    </Modal>

    <Modal open={onboardingOpen} title="回写入职确认结果" onCancel={() => setOnboardingOpen(false)} onOk={() => void submitOnboarding()} confirmLoading={acting} destroyOnClose>
      <Form form={onboardingForm} layout="vertical">
        <Form.Item name="result" label="确认结果" rules={[{ required: true }]}><Select options={[{ value: "CONFIRMED", label: "确认入职" }, { value: "DECLINED", label: "确认不入职" }]} /></Form.Item>
        <Form.Item noStyle shouldUpdate={(previous, current) => previous.result !== current.result}>{({ getFieldValue }) => getFieldValue("result") === "CONFIRMED" ? <>
          <Form.Item name="entryDate" label="入职日期" rules={[{ required: true }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="assigneeName" label="接待负责人" rules={[{ required: true }]}><Input /></Form.Item>
        </> : null}</Form.Item>
        <Form.Item name="note" label="备注"><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
  </>;
}
