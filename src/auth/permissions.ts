import type { FeaturePermission } from "./AuthContext";

export const permissionLabels: Record<FeaturePermission, string> = {
  CANDIDATE_VIEW: "查看候选人",
  CANDIDATE_CREATE: "新增候选人",
  CANDIDATE_IMPORT: "导入候选人",
  CANDIDATE_EDIT: "修改候选人基本资料",
  CANDIDATE_CONTACT_VIEW: "查看候选人联系方式",
  SCREENING_SUBMIT: "提交简历筛选结果",
  INTERVIEW_VIEW: "查看面试和时间看板",
  INTERVIEW_SCHEDULE: "安排、改期或取消面试",
  FEEDBACK_VIEW: "查看面评",
  FEEDBACK_SUBMIT: "填写面评",
  LEVEL_ADJUSTMENT_REQUEST: "发起职级调整",
  OFFER_MANAGE: "沟通和更新 Offer 状态",
  ONBOARDING_CONFIRM: "确认入职日期",
  RECEPTION_VIEW: "查看接待和入职任务",
  DATA_EXPORT: "导出数据",
  SUPPLIER_ACCOUNT_MANAGE: "管理本公司账号",
};

export const allPermissions = Object.keys(permissionLabels) as FeaturePermission[];
