import crypto from "node:crypto";
import type { InterviewParticipantRecord, TencentMeetingInfo, TencentMeetingRecording } from "../src/types/tencentMeeting.js";

export interface CreateMeetingInput { subject: string; startTime: string; endTime: string; creatorUserId?: string; hostUserId?: string; timezone?: string; autoRecord?: boolean }
export interface TencentMeetingClient { testConnection(): Promise<{ configured: boolean; mode: "mock" | "api"; message: string }>; createMeeting(input: CreateMeetingInput): Promise<TencentMeetingInfo>; updateMeeting(meetingId: string, input: Partial<CreateMeetingInput>): Promise<TencentMeetingInfo>; cancelMeeting(meetingId: string, reason: string): Promise<void>; getMeeting(meetingId: string): Promise<TencentMeetingInfo>; getParticipants(meetingId: string): Promise<InterviewParticipantRecord[]>; getRecordings(meetingId: string): Promise<TencentMeetingRecording[]> }

type TencentMeetingEnv = NodeJS.ProcessEnv;
type TencentMeetingApiResponse = Record<string, any>;
type FetchLike = typeof fetch;
const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const toUnixSeconds = (value: string) => String(Math.floor(new Date(value).getTime() / 1000));
const fromUnixSeconds = (value: unknown, fallback: string) => value ? new Date(Number(value) * 1000).toISOString() : fallback;

export function createTencentMeetingSignature(secretId: string, secretKey: string, method: string, uri: string, body: string, nonce: string, timestamp: string) {
  const headerString = `X-TC-Key=${secretId}&X-TC-Nonce=${nonce}&X-TC-Timestamp=${timestamp}`;
  const stringToSign = `${method.toUpperCase()}\n${headerString}\n${uri}\n${body}`;
  const hexDigest = crypto.createHmac("sha256", secretKey).update(stringToSign).digest("hex");
  return Buffer.from(hexDigest).toString("base64");
}

export class TencentMeetingMockClient implements TencentMeetingClient {
  private meetings = new Map<string, TencentMeetingInfo>();
  async testConnection(): Promise<{ configured: boolean; mode: "mock" | "api"; message: string }> { return { configured: true, mode: "mock", message: "腾讯会议模拟模式已启用，不会创建真实会议" }; }
  async createMeeting(input: CreateMeetingInput) { const meetingId = `mock-${crypto.randomUUID()}`; const info: TencentMeetingInfo = { meetingId, meetingCode: String(Math.floor(100000000 + Math.random() * 899999999)), subject: input.subject, joinUrl: `https://meeting.tencent.com/mock/${meetingId}`, scheduledStartTime: input.startTime, scheduledEndTime: input.endTime, status: "scheduled", providerCreatedAt: new Date().toISOString(), rawResponseDigest: digest(input) }; this.meetings.set(meetingId, info); return info; }
  async updateMeeting(meetingId: string, input: Partial<CreateMeetingInput>) { const current = await this.getMeeting(meetingId); const next = { ...current, subject: input.subject ?? current.subject, scheduledStartTime: input.startTime ?? current.scheduledStartTime, scheduledEndTime: input.endTime ?? current.scheduledEndTime, rawResponseDigest: digest(input) }; this.meetings.set(meetingId, next); return next; }
  async cancelMeeting(meetingId: string) { const current = await this.getMeeting(meetingId); this.meetings.set(meetingId, { ...current, status: "cancelled" }); }
  async getMeeting(meetingId: string) { const info = this.meetings.get(meetingId); if (!info) throw new Error("TENCENT_MEETING_NOT_FOUND"); return info; }
  async getParticipants(meetingId: string) { const info = await this.getMeeting(meetingId); return [{ id: `P-${meetingId}`, interviewId: meetingId, participantName: "模拟面试官", participantRole: "面试官" as const, joinTime: info.scheduledStartTime, leaveTime: info.scheduledEndTime, durationSeconds: Math.max(0, (new Date(info.scheduledEndTime).getTime() - new Date(info.scheduledStartTime).getTime()) / 1000), joinCount: 1, matchedAutomatically: true, matchConfidence: 100 }]; }
  async getRecordings(meetingId: string) { await this.getMeeting(meetingId); return []; }
}

export class TencentMeetingApiClient implements TencentMeetingClient {
  private readonly baseUrl: string;
  private readonly appId: string;
  private readonly sdkId: string;
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly creatorUserId: string;
  private readonly instanceId: number;

  constructor(private readonly env: TencentMeetingEnv = process.env, private readonly fetchImpl: FetchLike = fetch) {
    this.baseUrl = (env.TENCENT_MEETING_API_BASE_URL || "https://api.meeting.qq.com").replace(/\/$/, "");
    this.appId = env.TENCENT_MEETING_APP_ID || "";
    this.sdkId = env.TENCENT_MEETING_SDK_ID || "";
    this.secretId = env.TENCENT_MEETING_SECRET_ID || "";
    this.secretKey = env.TENCENT_MEETING_SECRET_KEY || "";
    this.creatorUserId = env.TENCENT_MEETING_CREATOR_USER_ID || "";
    this.instanceId = Number(env.TENCENT_MEETING_CREATOR_INSTANCE_ID || 1);
  }

  private missingConfig() {
    return [
      ["TENCENT_MEETING_APP_ID", this.appId],
      ["TENCENT_MEETING_SECRET_ID", this.secretId],
      ["TENCENT_MEETING_SECRET_KEY", this.secretKey],
      ["TENCENT_MEETING_CREATOR_USER_ID", this.creatorUserId],
    ].filter(([, value]) => !value).map(([name]) => name);
  }

  private async request(method: string, uri: string, payload?: Record<string, unknown>) {
    const missing = this.missingConfig();
    if (missing.length) throw new Error(`TENCENT_MEETING_CONFIG_MISSING:${missing.join(",")}`);
    const body = payload ? JSON.stringify(payload) : "";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = String(crypto.randomInt(100000, 999999999));
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-TC-Key": this.secretId,
      "X-TC-Timestamp": timestamp,
      "X-TC-Nonce": nonce,
      "X-TC-Signature": createTencentMeetingSignature(this.secretId, this.secretKey, method, uri.split("?")[0], body, nonce, timestamp),
      "AppId": this.appId,
      "X-TC-Registered": "1",
    };
    if (this.sdkId) headers.SdkId = this.sdkId;
    const response = await this.fetchImpl(`${this.baseUrl}${uri}`, { method, headers, body: body || undefined, signal: AbortSignal.timeout(Number(this.env.TENCENT_MEETING_TIMEOUT_MS || 10000)) });
    const text = await response.text();
    let data: TencentMeetingApiResponse = {};
    if (text) { try { data = JSON.parse(text); } catch { data = { message: text }; } }
    if (!response.ok || data.error_info || data.errorInfo) {
      const error = data.error_info || data.errorInfo || data;
      throw new Error(`TENCENT_MEETING_API_ERROR:${error.error_code || error.code || response.status}:${error.message || error.error_message || response.statusText}`);
    }
    return data;
  }

  private mapMeeting(data: TencentMeetingApiResponse, fallback: Partial<CreateMeetingInput> = {}): TencentMeetingInfo {
    const item = data.meeting_info_list?.[0] || data.meeting_info || data;
    if (!item.meeting_id) throw new Error("TENCENT_MEETING_INVALID_RESPONSE");
    return {
      meetingId: String(item.meeting_id), meetingCode: item.meeting_code ? String(item.meeting_code) : undefined,
      subject: item.subject || fallback.subject || "腾讯会议", joinUrl: item.join_url, hostJoinUrl: item.host_join_url,
      password: item.password, scheduledStartTime: fromUnixSeconds(item.start_time, fallback.startTime || new Date().toISOString()),
      scheduledEndTime: fromUnixSeconds(item.end_time, fallback.endTime || new Date().toISOString()),
      status: "scheduled", providerCreatedAt: new Date().toISOString(), rawResponseDigest: digest(item),
    };
  }

  async testConnection(): Promise<{ configured: boolean; mode: "api"; message: string }> {
    const missing = this.missingConfig();
    if (missing.length) return { configured: false, mode: "api", message: `真实模式待配置：${missing.join("、")}` };
    try {
      const query = new URLSearchParams({ userid: this.creatorUserId, instanceid: String(this.instanceId) });
      await this.request("GET", `/v1/meetings?${query.toString()}`);
      return { configured: true, mode: "api", message: "腾讯会议真实 API 连接成功" };
    } catch (error) {
      return { configured: false, mode: "api", message: error instanceof Error ? `腾讯会议连接失败：${error.message}` : "腾讯会议连接失败" };
    }
  }

  async createMeeting(input: CreateMeetingInput) {
    const userid = input.creatorUserId || this.creatorUserId;
    const payload: Record<string, unknown> = { userid, instanceid: this.instanceId, subject: input.subject, type: 0, start_time: toUnixSeconds(input.startTime), end_time: toUnixSeconds(input.endTime), settings: { mute_enable_join: false, allow_unmute_self: true } };
    if (input.hostUserId) payload.hosts = [userid, input.hostUserId].filter((value, index, values) => values.indexOf(value) === index);
    const data = await this.request("POST", "/v1/meetings", payload);
    return this.mapMeeting(data, input);
  }

  async updateMeeting(meetingId: string, input: Partial<CreateMeetingInput>) {
    const payload: Record<string, unknown> = { userid: input.creatorUserId || this.creatorUserId, instanceid: this.instanceId };
    if (input.subject) payload.subject = input.subject;
    if (input.startTime) payload.start_time = toUnixSeconds(input.startTime);
    if (input.endTime) payload.end_time = toUnixSeconds(input.endTime);
    if (input.hostUserId) payload.hosts = [payload.userid, input.hostUserId].filter((value, index, values) => values.indexOf(value) === index);
    const data = await this.request("PUT", `/v1/meetings/${encodeURIComponent(meetingId)}`, payload);
    return this.mapMeeting(data, input);
  }

  async cancelMeeting(meetingId: string, reason: string) {
    await this.request("POST", `/v1/meetings/${encodeURIComponent(meetingId)}/cancel`, { userid: this.creatorUserId, instanceid: this.instanceId, reason_code: 1, reason_detail: reason || "招聘面试取消" });
  }

  async getMeeting(meetingId: string) {
    const query = new URLSearchParams({ userid: this.creatorUserId, instanceid: String(this.instanceId) });
    return this.mapMeeting(await this.request("GET", `/v1/meetings/${encodeURIComponent(meetingId)}?${query.toString()}`));
  }

  async getParticipants(meetingId: string): Promise<InterviewParticipantRecord[]> {
    const query = new URLSearchParams({ userid: this.creatorUserId, instanceid: String(this.instanceId) });
    const data = await this.request("GET", `/v1/meetings/${encodeURIComponent(meetingId)}/participants?${query.toString()}`);
    return (data.participants || []).map((item: TencentMeetingApiResponse, index: number) => ({ id: String(item.uuid || item.userid || `P-${meetingId}-${index}`), interviewId: meetingId, participantName: item.user_name || "腾讯会议参会者", participantRole: "其他" as const, joinTime: item.join_time ? fromUnixSeconds(item.join_time, "") : undefined, leaveTime: item.left_time ? fromUnixSeconds(item.left_time, "") : undefined, durationSeconds: Number(item.duration || 0), joinCount: Number(item.join_count || 1), matchedAutomatically: false }));
  }

  async getRecordings(_meetingId: string): Promise<TencentMeetingRecording[]> { return []; }
}

export function createTencentMeetingClient(env = process.env): TencentMeetingClient { return env.TENCENT_MEETING_MODE === "api" ? new TencentMeetingApiClient(env) : new TencentMeetingMockClient(); }
