import type { Candidate } from "../types/recruitment";
import type { RecruitmentSummaryRow } from "./candidateImport";

/** 将候选人明细按“日期 + 供应商”汇总成招聘数据表格式。每个候选人只在对应业务日期贡献一次数量。 */
export function buildRecruitmentSummaryRows(candidates: Candidate[]): RecruitmentSummaryRow[] {
  const groups = new Map<string, Candidate[]>();
  candidates.forEach((candidate) => {
    const date = candidate.resumeSubmitDate?.slice(0, 10);
    if (!date) return;
    const key = `${date}__${candidate.vendor}`;
    groups.set(key, [...(groups.get(key) || []), candidate]);
  });

  return [...groups.entries()].map(([key, list], index) => {
    const [date, vendor] = key.split("__");
    const resumeScreened = list.length;
    const resumePassed = list.filter((c) => c.resumeResult === "通过").length;
    const interviewRows = list.filter((c) => c.interviewDate?.slice(0, 10) === date);
    const interviewAbsent = interviewRows.filter((c) => c.interviewResult === "未到场").length;
    const interviewAttended = interviewRows.filter((c) => c.interviewResult && c.interviewResult !== "未到场" && c.interviewResult !== "待面试").length;
    const interviewPassed = interviewRows.filter((c) => c.interviewResult === "通过").length;
    const offerRows = list.filter((c) => c.offerConfirmedDate?.slice(0, 10) === date);
    const offersSent = offerRows.length;
    const offersAccepted = offerRows.filter((c) => c.offerConfirmed).length;
    const offerGhosted = list.filter((c) => c.currentStatus === "候选人放弃" && c.offerConfirmedDate?.slice(0, 10) === date).length;
    const rate = (a: number, b: number) => b ? Math.round((a / b) * 1000) / 1000 : undefined;
    return {
      rowNumber: index + 2,
      date,
      vendor,
      resumeScreened,
      resumePassed,
      resumePassRate: rate(resumePassed, resumeScreened),
      interviewAttended,
      interviewAbsent,
      interviewPassed,
      interviewPassRate: rate(interviewPassed, interviewAttended),
      offersSent,
      offersAccepted,
      offerGhosted,
      offerAcceptanceRate: rate(offersAccepted, offersSent),
      targetHC: undefined,
      remainingGap: undefined,
      totalRecruitment: list.filter((c) => c.actualEntryDate?.slice(0, 10) === date).length,
      errors: [],
      warnings: [],
      validationStatus: "校验通过" as const,
    };
  }).sort((a, b) => `${a.date}${a.vendor}`.localeCompare(`${b.date}${b.vendor}`));
}
