import type { Candidate } from "../types/recruitment";

/** 供应商绩效只保留业务最关心的三个维度。 */
export interface VendorPerformance {
  vendor: string;
  /** 简历到达数量相对本期最高供应商的标准化得分 */
  resumeVolumeScore: number;
  /** 简历通过率，作为简历质量得分 */
  resumeQualityScore: number;
  /** Offer 接收率得分 */
  offerAcceptanceScore: number;
  totalScore: number;
  level: "优秀" | "良好" | "需关注" | "高风险";
  metrics: {
    resumeCount: number;
    resumePassRate: number | null;
    offerAcceptanceRate: number | null;
  };
}

const percentage = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? Math.round((numerator / denominator) * 100) : null;

const safeScore = (value: number | null): number => (value === null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value)));

export function calculateVendorPerformance(rows: Candidate[]): VendorPerformance[] {
  const vendorNames = [...new Set(rows.map((candidate) => candidate.vendor))];
  const counts = new Map(vendorNames.map((name) => [name, rows.filter((candidate) => candidate.vendor === name).length]));
  const maxResumeCount = Math.max(...counts.values(), 0);

  return vendorNames.map((vendor) => {
    const vendorRows = rows.filter((candidate) => candidate.vendor === vendor);
    const resumeCount = vendorRows.length;
    const passedResumes = vendorRows.filter((candidate) => candidate.resumeResult === "通过").length;
    const passedInterviews = vendorRows.filter((candidate) => candidate.interviewResult === "通过").length;
    const acceptedOffers = vendorRows.filter((candidate) => candidate.offerConfirmed).length;
    const resumePassRate = percentage(passedResumes, resumeCount);
    const offerAcceptanceRate = percentage(acceptedOffers, passedInterviews);

    // 数量维度按本期最高简历到达量归一化，避免大供应商因绝对量被直接忽略。
    const resumeVolumeScore = maxResumeCount > 0 ? Math.round((resumeCount / maxResumeCount) * 100) : 0;
    const resumeQualityScore = safeScore(resumePassRate);
    const offerAcceptanceScore = safeScore(offerAcceptanceRate);
    // 三项权重：简历到达数量 50%，简历质量 40%，Offer 接收率 10%。
    const totalScore = Math.round(resumeVolumeScore * 0.5 + resumeQualityScore * 0.4 + offerAcceptanceScore * 0.1);
    const level = totalScore >= 85 ? "优秀" : totalScore >= 70 ? "良好" : totalScore >= 60 ? "需关注" : "高风险";

    return { vendor, resumeVolumeScore, resumeQualityScore, offerAcceptanceScore, totalScore, level, metrics: { resumeCount, resumePassRate, offerAcceptanceRate } };
  });
}
