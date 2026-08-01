import assert from "node:assert/strict";
import { TencentMeetingMockClient } from "./tencentMeetingClient.js";

const client = new TencentMeetingMockClient();
const info = await client.createMeeting({ subject: "招聘面试｜测试候选人", startTime: "2026-08-03T06:00:00.000Z", endTime: "2026-08-03T06:30:00.000Z" });
assert.equal(info.status, "scheduled");
assert.match(info.joinUrl || "", /meeting\.tencent\.com/);
const participants = await client.getParticipants(info.meetingId);
assert.equal(participants.length, 1);
await client.cancelMeeting(info.meetingId, "测试取消");
assert.equal((await client.getMeeting(info.meetingId)).status, "cancelled");
console.log("腾讯会议 Mock 客户端测试通过");
