import * as XLSX from "xlsx";
import type { JobDescription, ResumeFileRecord } from "../types/resumeScreening";

export function exportResumeScreeningExcel(records: ResumeFileRecord[], job: JobDescription) {
  const rows = records.map((record) => ({
    候选人姓名: record.profile.name,
    大学: record.profile.university || "",
    专业: record.profile.major || "",
    学历: record.profile.highestEducation || "",
    毕业年份: record.profile.graduationYear || "",
    手机号后四位: record.profile.phone?.slice(-4) || "",
    供应商: record.vendor,
    简历文件名: record.originalFileName,
    同名数量: records.filter((item) => item.profile.name === record.profile.name).length,
    重复风险: record.duplicate.level,
    重复分数: record.duplicate.score,
    重复判断理由: record.duplicate.reasons.join("；"),
    目标岗位: job.jobName,
    JD匹配总分: record.match?.overallScore ?? "",
    学历匹配分: record.match?.dimensionScores.education ?? "",
    专业匹配分: record.match?.dimensionScores.major ?? "",
    工作经验分: record.match?.dimensionScores.experience ?? "",
    技能匹配分: record.match?.dimensionScores.skills ?? "",
    项目经历分: record.match?.dimensionScores.projectExperience ?? "",
    主要匹配点: record.match?.matchedRequirements.map((x) => x.requirement).join("、") || "",
    主要缺失点: record.match?.missingRequirements.map((x) => x.requirement).join("、") || "",
    AI推荐结果: record.match?.recommendation || "",
    AI置信度: record.match?.confidence ?? "",
    人工复核结果: record.manualReviewStatus,
    人工复核备注: record.manualNote || "",
    上传时间: record.uploadedAt,
    筛选时间: record.match?.matchedAt || "",
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "AI筛选结果");
  XLSX.writeFile(workbook, `AI简历筛选结果_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
