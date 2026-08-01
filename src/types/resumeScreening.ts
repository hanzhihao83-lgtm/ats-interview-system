export type ResumeParseStatus = "待解析" | "解析成功" | "解析失败" | "需人工处理";
export type ResumeReviewStatus = "待复核" | "简历通过" | "待补充信息" | "暂缓" | "简历不通过";
export type DuplicateLevel = "无重复" | "同名不同人" | "疑似重复" | "高度疑似重复" | "确定重复" | "需人工复核";
export type Recommendation = "推荐通过" | "建议人工复核" | "匹配度较低";

export interface EducationExperience { university: string; major?: string; degree?: string; graduationYear?: number }
export interface ResumeProfile {
  id: string; fileId: string; name: string; phone?: string; phoneMasked?: string; email?: string; emailMasked?: string;
  highestEducation?: string; university?: string; universities: EducationExperience[]; major?: string; graduationYear?: number;
  workYears?: number; currentCity?: string; expectedCity?: string; skills: string[]; certificates: string[]; rawText: string;
  extractedAt: string; extractionSource: "rule" | "ai" | "rule_and_ai"; extractionConfidence: number; missingFields: string[]; warnings: string[];
}
export interface ResumeFileRecord {
  id: string; originalFileName: string; fileType: string; fileSize: number; fileHash: string; vendor: string; targetJobId: string;
  parseStatus: ResumeParseStatus; aiStatus: "未筛选" | "筛选中" | "筛选成功" | "筛选失败"; manualReviewStatus: ResumeReviewStatus;
  uploadedAt: string; profile: ResumeProfile; duplicate: ResumeDuplicateResult; match?: ResumeJobMatchResult; manualNote?: string;
}
export interface ResumeDuplicateResult { resumeId: string; level: DuplicateLevel; score: number; matchedResumeIds: string[]; reasons: string[]; differences: string[]; requiresManualReview: boolean }
export interface JobDescription { id: string; jobName: string; projectName: string; requiredEducation: string; preferredMajors: string[]; requiredSkills: string[]; preferredSkills: string[]; minWorkYears: number; freshGraduateAccepted: boolean; status: "启用" | "停用"; originalText: string; updatedAt: string }
export interface MatchEvidence { requirement: string; resumeEvidence?: string; result: "匹配" | "部分匹配" | "不匹配" | "无法判断"; reason: string }
export interface ResumeJobMatchResult {
  id: string; resumeId: string; jobId: string; overallScore: number;
  dimensionScores: { education: number; major: number; experience: number; skills: number; projectExperience: number; certificates: number; location: number; stability: number };
  matchedRequirements: MatchEvidence[]; partiallyMatchedRequirements: MatchEvidence[]; missingRequirements: MatchEvidence[]; riskPoints: MatchEvidence[];
  recommendation: Recommendation; summary: string; interviewQuestions: string[]; promptVersion: string; matchedAt: string; confidence: number; source: "规则筛选" | "AI";
}
