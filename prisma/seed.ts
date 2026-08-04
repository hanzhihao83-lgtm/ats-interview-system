import { BusinessLine, FeaturePermission, PrismaClient, UserRole } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
const prisma = new PrismaClient();
const suppliers = ["人瑞", "德科", "供应商B", "供应商C", "供应商D"];
const positions = [
  "AI 数据标注员",
  "AI 数据质检员",
  "视频评测工程师",
  "Caption 标注员",
  "项目助理",
  "音频数据标注员",
  "ASR 质检员",
];
const allPermissions = Object.values(FeaturePermission);
const internalPermissions = allPermissions.filter(
  (permission) => permission !== FeaturePermission.SUPPLIER_ACCOUNT_MANAGE,
);
const supplierManagerPermissions = allPermissions.filter(
  (permission) => permission !== FeaturePermission.DATA_EXPORT,
);
const supplierRecruiterPermissions = [
  FeaturePermission.CANDIDATE_VIEW,
  FeaturePermission.CANDIDATE_CREATE,
  FeaturePermission.CANDIDATE_IMPORT,
  FeaturePermission.CANDIDATE_EDIT,
  FeaturePermission.SCREENING_SUBMIT,
  FeaturePermission.INTERVIEW_VIEW,
  FeaturePermission.INTERVIEW_SCHEDULE,
  FeaturePermission.FEEDBACK_VIEW,
  FeaturePermission.FEEDBACK_SUBMIT,
  FeaturePermission.LEVEL_ADJUSTMENT_REQUEST,
  FeaturePermission.OFFER_MANAGE,
  FeaturePermission.ONBOARDING_CONFIRM,
  FeaturePermission.RECEPTION_VIEW,
];
async function main() {
  const supplierRecords = new Map<string, string>();
  for (const [index, name] of suppliers.entries())
    supplierRecords.set(name, (await prisma.supplier.upsert({
      where: { code: `SUP-${index + 1}` },
      update: { name, permissionCap: allPermissions, businessLines: [BusinessLine.VIDEO, BusinessLine.AUDIO] },
      create: { code: `SUP-${index + 1}`, name, permissionCap: allPermissions, businessLines: [BusinessLine.VIDEO, BusinessLine.AUDIO] },
    })).id);
  for (const name of positions) {
    const found = await prisma.jobPosition.findFirst({ where: { name } });
    if (!found) await prisma.jobPosition.create({ data: { name } });
  }
  const hash = (password: string) => {
    const salt = randomBytes(16).toString("hex");
    return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
  };
  const demoPassword = process.env.DEMO_ACCOUNT_PASSWORD;
  const accounts = [
    { email: "admin@recruitment.local", name: "平台管理员", role: UserRole.PLATFORM_ADMIN, supplierId: null, isSupplierManager: false, permissions: allPermissions, businessLines: [BusinessLine.VIDEO, BusinessLine.AUDIO] },
    { email: "manager@recruitment.local", name: "大部门负责人", role: UserRole.DEPARTMENT_MANAGER, supplierId: null, isSupplierManager: false, permissions: internalPermissions, businessLines: [BusinessLine.VIDEO, BusinessLine.AUDIO] },
    { email: "video@recruitment.local", name: "视频招聘人员", role: UserRole.VIDEO_RECRUITER, supplierId: null, isSupplierManager: false, permissions: internalPermissions, businessLines: [BusinessLine.VIDEO] },
    { email: "audio@recruitment.local", name: "音频招聘人员", role: UserRole.AUDIO_RECRUITER, supplierId: null, isSupplierManager: false, permissions: internalPermissions, businessLines: [BusinessLine.AUDIO] },
    { email: "renrui.admin@recruitment.local", name: "人瑞负责人", role: UserRole.SUPPLIER_ADMIN, supplierId: supplierRecords.get("人瑞")!, isSupplierManager: true, permissions: supplierManagerPermissions, businessLines: [BusinessLine.VIDEO, BusinessLine.AUDIO] },
    { email: "renrui.video@recruitment.local", name: "人瑞视频专员", role: UserRole.SUPPLIER_RECRUITER, supplierId: supplierRecords.get("人瑞")!, isSupplierManager: false, permissions: supplierRecruiterPermissions, businessLines: [BusinessLine.VIDEO] },
    { email: "renrui.audio@recruitment.local", name: "人瑞音频专员", role: UserRole.SUPPLIER_RECRUITER, supplierId: supplierRecords.get("人瑞")!, isSupplierManager: false, permissions: supplierRecruiterPermissions, businessLines: [BusinessLine.AUDIO] },
    { email: "deke.admin@recruitment.local", name: "德科负责人", role: UserRole.SUPPLIER_ADMIN, supplierId: supplierRecords.get("德科")!, isSupplierManager: true, permissions: supplierManagerPermissions, businessLines: [BusinessLine.VIDEO, BusinessLine.AUDIO] },
    { email: "deke.video@recruitment.local", name: "德科视频专员", role: UserRole.SUPPLIER_RECRUITER, supplierId: supplierRecords.get("德科")!, isSupplierManager: false, permissions: supplierRecruiterPermissions, businessLines: [BusinessLine.VIDEO] },
    { email: "deke.audio@recruitment.local", name: "德科音频专员", role: UserRole.SUPPLIER_RECRUITER, supplierId: supplierRecords.get("德科")!, isSupplierManager: false, permissions: supplierRecruiterPermissions, businessLines: [BusinessLine.AUDIO] },
  ];
  for (const account of accounts) {
    const existing = await prisma.user.findUnique({ where: { email: account.email } });
    if (!existing && !demoPassword) continue;
    await prisma.user.upsert({
      where: { email: account.email },
      update: { name: account.name, role: account.role, supplierId: account.supplierId, isSupplierManager: account.isSupplierManager, permissions: account.permissions, businessLines: account.businessLines },
      create: { email: account.email, name: account.name, role: account.role, supplierId: account.supplierId, isSupplierManager: account.isSupplierManager, permissions: account.permissions, businessLines: account.businessLines, passwordHash: hash(demoPassword!) },
    });
    if (!existing) console.log(`已创建演示账号：${account.email}`);
  }
  if (!demoPassword) console.log("未设置 DEMO_ACCOUNT_PASSWORD：已跳过新增 Demo 账号，未在源码中使用默认密码");

  const videoPosition = await prisma.jobPosition.findFirstOrThrow({ where: { name: "视频评测工程师" } });
  const audioPosition = await prisma.jobPosition.findFirstOrThrow({ where: { name: "音频数据标注员" } });
  const interviewerProfiles = new Map<BusinessLine, string>();
  if (demoPassword) {
    for (const [line, name, email] of [
      [BusinessLine.VIDEO, "视频面试官", "video.interviewer@recruitment.local"],
      [BusinessLine.AUDIO, "音频面试官", "audio.interviewer@recruitment.local"],
    ] as const) {
      const interviewer = await prisma.user.upsert({
        where: { email },
        update: { name, role: UserRole.INTERVIEWER, permissions: [FeaturePermission.INTERVIEW_VIEW, FeaturePermission.FEEDBACK_VIEW, FeaturePermission.FEEDBACK_SUBMIT], businessLines: [line] },
        create: { email, name, role: UserRole.INTERVIEWER, passwordHash: hash(demoPassword), permissions: [FeaturePermission.INTERVIEW_VIEW, FeaturePermission.FEEDBACK_VIEW, FeaturePermission.FEEDBACK_SUBMIT], businessLines: [line], kimUserId: `${line.toLowerCase()}-interviewer` },
      });
      const profile = await prisma.interviewerProfile.upsert({
        where: { userId: interviewer.id },
        update: { businessLines: [line], workingDays: [1, 2, 3, 4, 5], workStartMinute: 540, workEndMinute: 1260 },
        create: { userId: interviewer.id, department: line === BusinessLine.VIDEO ? "视频业务" : "音频业务", businessLines: [line], workingDays: [1, 2, 3, 4, 5], workStartMinute: 540, workEndMinute: 1260 },
      });
      interviewerProfiles.set(line, profile.id);
    }
  }
  const demos = [
    { no: "DEMO-RR-V", name: "人瑞视频候选人", supplier: "人瑞", line: BusinessLine.VIDEO, positionId: videoPosition.id, status: "待面试" },
    { no: "DEMO-RR-A", name: "人瑞音频候选人", supplier: "人瑞", line: BusinessLine.AUDIO, positionId: audioPosition.id, status: "待入职" },
    { no: "DEMO-DK-V", name: "德科视频候选人", supplier: "德科", line: BusinessLine.VIDEO, positionId: videoPosition.id, status: "面试通过" },
    { no: "DEMO-DK-A", name: "德科音频候选人", supplier: "德科", line: BusinessLine.AUDIO, positionId: audioPosition.id, status: "培训中" },
  ];
  for (const demo of demos) {
    const supplierId = supplierRecords.get(demo.supplier)!;
    const owner = await prisma.user.findFirst({ where: { supplierId, isSupplierManager: true } });
    const candidate = await prisma.candidate.upsert({ where: { candidateNo: demo.no }, update: {}, create: { candidateNo: demo.no, name: demo.name, normalizedName: demo.name, supplierId, positionId: demo.positionId, currentStatus: demo.status, source: "DEMO" } });
    const application = await prisma.candidateApplication.upsert({ where: { applicationNo: `APP-${demo.no}` }, update: { currentStatus: demo.status, ownerId: owner?.id }, create: { applicationNo: `APP-${demo.no}`, candidateId: candidate.id, supplierId, businessLine: demo.line, positionId: demo.positionId, currentStatus: demo.status, resumeResult: "通过", interviewResult: demo.status === "面试通过" || demo.status === "培训中" ? "通过" : null, expectedEntryDate: demo.status === "待入职" ? new Date(Date.now() + 3 * 86400000) : null, actualEntryDate: demo.status === "培训中" ? new Date() : null, ownerId: owner?.id, createdById: owner?.id } });
    const interviewId = `demo-interview-${demo.no.toLowerCase()}`;
    await prisma.interview.upsert({ where: { id: interviewId }, update: { interviewerProfileId: interviewerProfiles.get(demo.line) }, create: { id: interviewId, candidateId: candidate.id, applicationId: application.id, supplierId, businessLine: demo.line, scheduledStartTime: new Date(Date.now() + (demo.line === BusinessLine.VIDEO ? 1 : 2) * 86400000), scheduledEndTime: new Date(Date.now() + (demo.line === BusinessLine.VIDEO ? 1 : 2) * 86400000 + 30 * 60_000), status: "待面试", interviewer: demo.line === BusinessLine.VIDEO ? "视频面试官" : "音频面试官", interviewerProfileId: interviewerProfiles.get(demo.line) } });
  }
}
main().finally(() => prisma.$disconnect());
