import dayjs from "dayjs";
import type { JobDescription, ResumeDuplicateResult, ResumeFileRecord, ResumeJobMatchResult, ResumeProfile } from "../types/resumeScreening";

export const normalizeCandidateName = (name: string) => name.trim().replace(/[\s　]/g, "").normalize("NFKC").toLowerCase();
const universityAliases: Record<string, string> = { 北大: "北京大学", 北航: "北京航空航天大学", 齐鲁师院: "齐鲁师范学院" };
export const normalizeUniversityName = (name = "") => universityAliases[name.trim()] || name.trim().replace(/[（(].*?[）)]/g, "");
export const maskPhone = (phone?: string) => phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : "—";
const hash = (value: string) => Array.from(value).reduce((total, char) => ((total << 5) - total + char.charCodeAt(0)) | 0, 7).toString(16);

const cleanExtractedField = (value: string) => value.replace(/[\r\n]/g, " ").replace(/[：:|｜,，;；].*$/, "").replace(/(本科|硕士|博士|学历|专业背景).*$/, "").trim();
const extractUniversities = (text: string) => {
  const labeled = text.match(/(?:毕业院校|毕业学校|学校|院校|大学)\s*[:：]?\s*([^\n|｜,，;；]{2,30})/i)?.[1];
  const fromLabel = labeled ? (labeled.match(/[\u4e00-\u9fa5A-Za-z·（）()]{2,24}(?:大学|学院|学校)/)?.[0] || cleanExtractedField(labeled)) : "";
  const all = [...text.matchAll(/[\u4e00-\u9fa5A-Za-z·（）()]{2,24}(?:大学|学院)/g)].map((match) => match[0]);
  return [...new Set([fromLabel, ...all].filter((item) => item && !/教育经历|学校名称|毕业学校名称/.test(item)).map(normalizeUniversityName))];
};
const extractMajor = (text: string) => {
  const labeled = text.match(/(?:所学专业|主修专业|专业名称|专业)\s*[:：]?\s*([^\n|｜,，;；]{2,40})/i)?.[1];
  if (labeled) return cleanExtractedField(labeled);
  return ["计算机科学与技术", "汉语言文学", "数据科学与大数据技术", "软件工程", "视觉传达设计", "数字媒体艺术", "人工智能", "网络与新媒体", "信息管理与信息系统"].find((item) => text.includes(item));
};

export function extractProfile(fileName: string, rawText: string, vendor: string): ResumeProfile {
  const text = rawText.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n");
  const name = text.match(/(?:姓名|名字)[:： ]*([\u4e00-\u9fa5]{2,4})/)?.[1] || fileName.replace(/\.(pdf|docx?|png|jpe?g)$/i, "").split(/[-_ ]/)[0] || "待识别候选人";
  const phone = text.match(/1[3-9]\d{9}/)?.[0];
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  const universities = extractUniversities(text);
  const university = universities[0] || undefined;
  const major = ["计算机科学与技术", "汉语言文学", "数据科学与大数据技术", "软件工程", "视觉传达设计"].find((m) => text.includes(m));
  const graduationYear = Number(text.match(/20(2[0-9])届?/)?.[0]?.slice(0, 4)) || undefined;
  const skills = ["数据标注", "数据质检", "视频评测", "Caption", "Excel", "Python", "Prompt", "图像理解"].filter((skill) => text.toLowerCase().includes(skill.toLowerCase()));
  const warnings: string[] = [];
  if (!university) warnings.push("大学信息缺失，请人工确认");
  if (!major) warnings.push("专业信息缺失，请人工确认");
  if (!phone) warnings.push("手机号未识别");
  return { id: `RP-${hash(fileName + text)}`, fileId: `RF-${hash(fileName)}`, name, phone, phoneMasked: maskPhone(phone), email, emailMasked: email ? `${email.slice(0, 2)}***@${email.split("@")[1]}` : undefined, highestEducation: text.includes("硕士") ? "硕士" : text.includes("本科") ? "本科" : undefined, university, universities: universities.map((u) => ({ university: u, major, graduationYear })), major, graduationYear, workYears: text.match(/(\d+)年工作经验/) ? Number(text.match(/(\d+)年工作经验/)?.[1]) : undefined, skills, certificates: text.includes("证书") ? ["相关技能证书"] : [], rawText: text, extractedAt: dayjs().format("YYYY-MM-DD HH:mm"), extractionSource: "rule_and_ai", extractionConfidence: warnings.length ? 62 : 88, missingFields: warnings.map((w) => w.replace("，请人工确认", "")), warnings };
}

export function detectResumeDuplicates(target: ResumeProfile, all: ResumeProfile[]): ResumeDuplicateResult {
  const matched = all.filter((other) => other.id !== target.id && normalizeCandidateName(other.name) === normalizeCandidateName(target.name));
  if (!matched.length) return { resumeId: target.id, level: "无重复", score: 0, matchedResumeIds: [], reasons: [], differences: [], requiresManualReview: false };
  const exact = matched.filter((other) => target.phone && other.phone && target.phone === other.phone);
  if (exact.length) return { resumeId: target.id, level: "确定重复", score: 100, matchedResumeIds: exact.map((x) => x.id), reasons: ["姓名和完整手机号一致"], differences: [], requiresManualReview: true };
  const sameUniversity = matched.filter((other) => target.university && other.university && normalizeUniversityName(target.university) === normalizeUniversityName(other.university));
  const sameMajor = matched.filter((other) => target.major && other.major && target.major === other.major);
  if (sameUniversity && sameUniversity.length && sameMajor.length) return { resumeId: target.id, level: "高度疑似重复", score: 86, matchedResumeIds: sameUniversity.map((x) => x.id), reasons: ["姓名、大学和专业均一致，建议核对手机号"], differences: ["手机号或邮箱不一致"], requiresManualReview: true };
  if (matched.some((x) => x.university && target.university && normalizeUniversityName(x.university) !== normalizeUniversityName(target.university))) return { resumeId: target.id, level: "同名不同人", score: 15, matchedResumeIds: matched.map((x) => x.id), reasons: ["姓名相同但大学不同，初步判断为同名不同人"], differences: ["大学不同", "可能存在专业或毕业年份差异"], requiresManualReview: false };
  return { resumeId: target.id, level: target.university ? "疑似重复" : "需人工复核", score: target.university ? 65 : 40, matchedResumeIds: matched.map((x) => x.id), reasons: [target.university ? "姓名相同，其他身份信息不足" : "姓名相同且大学缺失"], differences: [], requiresManualReview: true };
}

export const defaultJobs: JobDescription[] = [
  { id: "J001", jobName: "AI 数据标注员", projectName: "多模态数据项目", requiredEducation: "本科", preferredMajors: ["计算机科学与技术", "数据科学"], requiredSkills: ["数据标注", "Excel"], preferredSkills: ["图像理解", "Prompt"], minWorkYears: 0, freshGraduateAccepted: true, status: "启用", originalText: "负责图像、视频和文本数据标注，要求细致、熟悉 Excel，接受应届生。", updatedAt: "2026-08-01" },
  { id: "J002", jobName: "视频评测工程师", projectName: "视频评测项目", requiredEducation: "本科", preferredMajors: ["计算机科学与技术", "视觉传达设计"], requiredSkills: ["视频评测", "数据质检"], preferredSkills: ["Prompt", "图像理解"], minWorkYears: 1, freshGraduateAccepted: true, status: "启用", originalText: "负责视频质量评估、Badcase 归因和数据质检。", updatedAt: "2026-08-01" },
  { id: "J003", jobName: "Caption 标注员", projectName: "Caption 数据项目", requiredEducation: "本科", preferredMajors: ["汉语言文学"], requiredSkills: ["Caption", "数据标注"], preferredSkills: ["Excel"], minWorkYears: 0, freshGraduateAccepted: true, status: "启用", originalText: "负责视频 Caption 描述、文本理解和标注规则执行。", updatedAt: "2026-08-01" },
];

export function ruleBasedJobMatch(resume: ResumeProfile, job: JobDescription): ResumeJobMatchResult {
  const education = resume.highestEducation === job.requiredEducation ? 100 : resume.highestEducation ? 60 : 40;
  const majorHit = job.preferredMajors.some((m) => resume.major?.includes(m) || m.includes(resume.major || ""));
  const major = majorHit ? 100 : resume.major ? 45 : 40;
  const skillHits = job.requiredSkills.filter((s) => resume.skills.some((x) => x.toLowerCase().includes(s.toLowerCase())));
  const skills = job.requiredSkills.length ? Math.round((skillHits.length / job.requiredSkills.length) * 100) : 60;
  const experience = (resume.workYears || 0) >= job.minWorkYears || (job.freshGraduateAccepted && !resume.workYears) ? 100 : 45;
  const projectExperience = resume.rawText.length > 120 ? 75 : 35;
  const certificate = resume.certificates.length ? 80 : 50;
  const location = 70; const stability = resume.workYears && resume.workYears >= 2 ? 85 : 65;
  const overallScore = Math.round(education * .1 + major * .1 + experience * .2 + skills * .25 + projectExperience * .15 + certificate * .05 + location * .05 + stability * .1);
  const missingRequirements = job.requiredSkills.filter((s) => !skillHits.includes(s)).map((requirement) => ({ requirement, result: "不匹配" as const, reason: "简历中未明确提及该技能" }));
  const matchedRequirements = skillHits.map((requirement) => ({ requirement, resumeEvidence: requirement, result: "匹配" as const, reason: "简历中明确提及" }));
  const recommendation = overallScore >= 80 && !resume.warnings.length ? "推荐通过" : overallScore >= 60 ? "建议人工复核" : "匹配度较低";
  return { id: `MATCH-${resume.id}-${job.id}`, resumeId: resume.id, jobId: job.id, overallScore, dimensionScores: { education, major, experience, skills, projectExperience, certificates: certificate, location, stability }, matchedRequirements, partiallyMatchedRequirements: [], missingRequirements, riskPoints: resume.warnings.map((requirement) => ({ requirement, result: "无法判断" as const, reason: "结构化信息缺失" })), recommendation, summary: `规则筛选：匹配度${overallScore}分，${matchedRequirements.length}项技能匹配，${missingRequirements.length}项技能待确认。`, interviewQuestions: ["请介绍一段与岗位最相关的项目经历。", "你如何保证标注或评测结果的一致性？"], promptVersion: "rule-v1", matchedAt: dayjs().format("YYYY-MM-DD HH:mm"), confidence: resume.extractionConfidence, source: "规则筛选" };
}

export function createMockResumes(): ResumeFileRecord[] {
  const samples = [
    ["张伟", "山东大学", "计算机科学与技术", "2025", "13812344521", "数据标注 Excel 图像理解"], ["张伟", "青岛大学", "汉语言文学", "2026", "18634567826", "Caption 数据标注"], ["张伟", "山东大学", "计算机科学与技术", "2025", "13812344521", "数据标注 Excel"], ["李娜", "北京大学", "数据科学与大数据技术", "2025", "15922333368", "Python Prompt 数据质检"], ["王强", "中国海洋大学", "软件工程", "2024", "17755669214", "视频评测 数据质检"], ["刘洋", "", "", "", "", ""], ["赵敏", "齐鲁师范学院", "视觉传达设计", "2026", "13500001234", "视频评测 Caption"], ["陈晨", "哈尔滨工业大学", "计算机科学与技术", "2023", "13900004321", "Python 数据质检 图像理解"],
  ];
  const rows = samples.map((s, index) => { const text = `姓名：${s[0]}\n大学：${s[1]}\n专业：${s[2]}\n${s[3]}届\n手机号：${s[4]}\n技能：${s[5]}\n有多模态数据项目和实习经历。`; const profile = extractProfile(`候选人${s[0]}${index + 1}.pdf`, text, "人瑞"); const record: ResumeFileRecord = { id: `RF-${String(index + 1).padStart(3, "0")}`, originalFileName: `候选人${s[0]}${index + 1}.pdf`, fileType: "application/pdf", fileSize: 420000 + index * 3000, fileHash: hash(text), vendor: index % 2 ? "供应商B" : "人瑞", targetJobId: index % 3 === 1 ? "J003" : "J001", parseStatus: index === 5 ? "需人工处理" : "解析成功", aiStatus: "未筛选", manualReviewStatus: "待复核", uploadedAt: dayjs("2026-08-01").subtract(index, "hour").format("YYYY-MM-DD HH:mm"), profile, duplicate: { resumeId: profile.id, level: "无重复", score: 0, matchedResumeIds: [], reasons: [], differences: [], requiresManualReview: false } }; return record; });
  return rows.map((record) => ({ ...record, duplicate: detectResumeDuplicates(record.profile, rows.map((item) => item.profile)) }));
}
