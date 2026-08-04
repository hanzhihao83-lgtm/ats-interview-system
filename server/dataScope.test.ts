import test from "node:test";
import assert from "node:assert/strict";
import { BusinessLine, FeaturePermission, UserRole } from "@prisma/client";
import { buildDataScope, ScopeForbiddenError } from "./dataScopeService.js";
import { classifyBusinessLine } from "./importClassificationService.js";
import type { AuthUser } from "./auth.js";

const user = (
  role: UserRole,
  supplierId: string | null = null,
  options: { manager?: boolean; businessLines?: BusinessLine[] } = {},
): AuthUser => ({
  id: role,
  email: `${role}@test.local`,
  name: role,
  role,
  supplierId,
  supplierName: supplierId ? "人瑞" : null,
  isSupplierManager: Boolean(options.manager),
  permissions: Object.values(FeaturePermission),
  businessLines: options.businessLines || [],
  kimUserId: null,
  interviewerProfileId: null,
  simulation: null,
});

test("平台管理员可以查看综合、视频和音频", () => assert.deepEqual(buildDataScope(user(UserRole.PLATFORM_ADMIN), undefined, undefined), {}));
test("视频招聘人员被强制为 VIDEO", () => assert.equal(buildDataScope(user(UserRole.VIDEO_RECRUITER)).businessLine, BusinessLine.VIDEO));
test("音频招聘人员被强制为 AUDIO", () => assert.equal(buildDataScope(user(UserRole.AUDIO_RECRUITER)).businessLine, BusinessLine.AUDIO));
test("视频角色请求音频返回禁止", () => assert.throws(() => buildDataScope(user(UserRole.VIDEO_RECRUITER), undefined, BusinessLine.AUDIO), ScopeForbiddenError));
test("音频角色请求视频返回禁止", () => assert.throws(() => buildDataScope(user(UserRole.AUDIO_RECRUITER), undefined, BusinessLine.VIDEO), ScopeForbiddenError));
test("人瑞视频专员只能看自己负责的人瑞 VIDEO 记录", () => assert.deepEqual(buildDataScope(user(UserRole.SUPPLIER_VIDEO_RECRUITER, "renrui")), { supplierId: "renrui", businessLine: BusinessLine.VIDEO, ownerId: UserRole.SUPPLIER_VIDEO_RECRUITER }));
test("供应商负责人可以选择本公司视频或音频且不受单个负责人限制", () => assert.deepEqual(buildDataScope(user(UserRole.SUPPLIER_ADMIN, "renrui", { manager: true }), "renrui", BusinessLine.AUDIO), { supplierId: "renrui", businessLine: BusinessLine.AUDIO }));
test("外包公司普通账号被限制在管理员配置的业务线", () => assert.throws(() => buildDataScope(user(UserRole.SUPPLIER_RECRUITER, "renrui", { businessLines: [BusinessLine.VIDEO] }), undefined, BusinessLine.AUDIO), ScopeForbiddenError));
test("管理员模拟外包公司时应用公司范围且不应用负责人限制", () => {
  const admin = user(UserRole.PLATFORM_ADMIN);
  admin.simulation = { supplierId: "renrui", supplierName: "人瑞", permissions: [FeaturePermission.CANDIDATE_VIEW], businessLines: [BusinessLine.VIDEO] };
  assert.deepEqual(buildDataScope(admin), { supplierId: "renrui", businessLines: [BusinessLine.VIDEO] });
});
test("供应商传入其他 supplierId 被拒绝", () => assert.throws(() => buildDataScope(user(UserRole.SUPPLIER_ADMIN, "renrui"), "deke"), ScopeForbiddenError));
test("视频工作表识别 VIDEO", () => assert.equal(classifyBusinessLine("视频面试", "数据标注"), BusinessLine.VIDEO));
test("ASR 岗位识别 AUDIO", () => assert.equal(classifyBusinessLine("候选人", "ASR 音频转写"), BusinessLine.AUDIO));
test("无法识别时标记 UNCLASSIFIED", () => assert.equal(classifyBusinessLine("名单", "项目助理"), BusinessLine.UNCLASSIFIED));
test("强制业务线优先于工作表关键词", () => assert.equal(classifyBusinessLine("音频面试", "ASR", BusinessLine.VIDEO), BusinessLine.VIDEO));
