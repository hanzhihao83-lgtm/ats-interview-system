import XLSX from "xlsx";

export type BusinessType = "视频" | "音频" | "未知";
export type SheetKind = "supplier" | "interview" | "grouped" | "summary" | "entry" | "unknown";
export interface ParsedCandidate {
  name: string; supplier: string; businessType: BusinessType; resumeFile?: string;
  interviewTimeRaw?: string; interviewStartTime?: Date; interviewEndTime?: Date;
  meetingCode?: string; meetingUrl?: string; meetingTextRaw?: string;
  interviewResult: string; level: string; interviewer?: string; interviewComment?: string;
  entryDate?: Date; entryStatus: string; sourceSheet: string; sourceRow: number;
}
export interface ParsedSupplier {
  supplier: string; videoResumeCount?: number; audioResumeCount?: number;
  videoInterviewPassed?: number; videoConfirmedEntry?: number; videoActualEntry?: number;
  audioInterviewPassed?: number; audioConfirmedEntry?: number; audioActualEntry?: number;
  status?: string; remark?: string; sourceSheet: string;
}
export interface ParseResult { candidates: ParsedCandidate[]; suppliers: ParsedSupplier[]; processedSheets: string[]; ignoredSheets: string[]; warningCount: number; }

const text = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/[ \t]+/g, " ");
const key = (value: unknown) => text(value).replace(/[\s:：()（）/_-]/g, "").toLowerCase();
const number = (value: unknown): number | undefined => {
  const match = text(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Math.round(Number(match[0])) : undefined;
};
const at = (row: unknown[], index: number | undefined) => index === undefined ? "" : row[index];
const invalidSheetNames = /^(info|配置|说明|示例|字段说明)$/i;
const headerWords = ["姓名", "候选人", "供应商", "面试时间", "腾讯会议", "是否通过", "通过", "定级", "面试官", "入职时间", "入职", "岗位", "状态", "简历", "数量", "进度"];

export function detectHeaderRow(rows: unknown[][]): number {
  let best = -1, bestScore = 1;
  rows.slice(0, 10).forEach((row, index) => {
    const cells = row.map(key);
    const score = headerWords.filter((word) => cells.some((cell) => cell.includes(key(word)))).length;
    if (score > bestScore) { best = index; bestScore = score; }
  });
  return best;
}

export function parseTencentMeeting(value: unknown) {
  const originalMeetingText = text(value);
  const meetingCode = originalMeetingText.match(/(?<!\d)(\d{3}-\d{3}-\d{3})(?!\d)/)?.[1];
  const meetingUrl = originalMeetingText.match(/https?:\/\/meeting\.tencent\.com\/[^\s，,；;]+/i)?.[0];
  return { meetingCode, meetingUrl, originalMeetingText: originalMeetingText || undefined };
}

export function normalizeDateValue(value: unknown, referenceYear = new Date().getFullYear()) {
  const raw = text(value).replace(/：/g, ":").replace(/\s*(GMT[+-]?\d*:?[0-9]*|中国标准时间).*$/i, "").trim();
  if (!raw) return { raw: "" };
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) {
      const start = new Date(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, Math.floor(d.S || 0));
      const dateText = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
      const timeText = d.H || d.M || d.S ? ` ${String(d.H || 0).padStart(2, "0")}:${String(d.M || 0).padStart(2, "0")}` : "";
      return { raw: `${dateText}${timeText}`, start, end: undefined as Date | undefined };
    }
  }
  const normalized = raw.replace(/[—–~～至]/g, "-").replace(/年|\//g, "-").replace(/月/g, "-").replace(/日/g, " ").replace(/\./g, "-");
  const dateMatch = normalized.match(/(?:(\d{4})-)?(\d{1,2})-(\d{1,2})/);
  if (!dateMatch) return { raw };
  const year = Number(dateMatch[1] || referenceYear), month = Number(dateMatch[2]), day = Number(dateMatch[3]);
  const rest = normalized.slice((dateMatch.index || 0) + dateMatch[0].length);
  const times = [...rest.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const valid = (h: number, m: number) => h >= 0 && h < 24 && m >= 0 && m < 60;
  const [sh = 0, sm = 0] = times[0] || [];
  if (times.length && !valid(sh, sm)) return { raw };
  const start = new Date(year, month - 1, day, sh, sm);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) return { raw };
  const [eh, em] = times[1] || [];
  const end = eh !== undefined && valid(eh, em) ? new Date(year, month - 1, day, eh, em) : undefined;
  return { raw, start, end };
}

const resultAliases: Record<string, string> = { "是": "通过", "已通过": "通过", "通过": "通过", "否": "不通过", "未通过": "不通过", "不通过": "不通过", "待定": "待反馈", "待反馈": "待反馈", "取消": "取消", "已取消": "取消" };
export const normalizeInterviewResult = (value: unknown) => resultAliases[text(value)] || (text(value) ? "未知" : "待反馈");
const entryAliases: Record<string, string> = { "已入职": "已入职", "待入职": "待入职", "已放弃": "已放弃", "放弃": "已放弃", "已离职": "已离职", "离职": "已离职" };
export const normalizeEntryStatus = (value: unknown) => entryAliases[text(value)] || "未知";
const businessFrom = (...values: unknown[]): BusinessType => {
  const all = values.map(text).join(" ");
  return all.includes("视频") ? "视频" : all.includes("音频") ? "音频" : "未知";
};

function indexOf(headers: unknown[], aliases: string[], start = 0, end = headers.length) {
  const normalized = headers.map(key);
  const found = normalized.slice(start, end).findIndex((header) => aliases.some((alias) => header.includes(key(alias))));
  return found < 0 ? undefined : found + start;
}
function classifySheet(name: string, rows: unknown[][], headerRow: number): SheetKind {
  const n = key(name), h = headerRow >= 0 ? rows[headerRow].map(text).join("|") : "";
  if (/已通过|面试通过|招聘汇总|通过汇总/.test(n) || (/视频面试通过/.test(h) && /音频面试通过/.test(h))) return "summary";
  if (/待入职|入职名单|人员入职/.test(n) || (/入职时间/.test(h) && /是否入职|入职状态/.test(h))) return "entry";
  if (/各供应商简历|供应商简历|简历汇总|供应商日报/.test(n) || (/视频数量|视频简历/.test(h) && /音频数量|音频简历/.test(h))) return "supplier";
  if (/视频侧面试|音频侧面试|面试安排|视频面试进度|音频面试进度/.test(n)) return "interview";
  if (/^(视频|音频|视频面试|音频面试)$/.test(n)) return "grouped";
  if (headerRow >= 0 && /姓名|候选人/.test(h) && /面试时间|是否通过|腾讯会议/.test(h)) return "interview";
  return "unknown";
}

function baseCandidate(row: unknown[], headers: unknown[], sheet: string, sourceRow: number, direction?: BusinessType, bounds?: [number, number]): ParsedCandidate | null {
  const [start, end] = bounds || [0, headers.length];
  const nameIndex = indexOf(headers, ["候选人姓名", "人选姓名", "姓名", "候选人"], start, end);
  const name = text(at(row, nameIndex)); if (!name || /^(总计|合计|说明|备注)$/.test(name)) return null;
  const supplier = text(at(row, indexOf(headers, ["供应商名称", "供应商", "外包公司"], start, end))) || "未知供应商";
  const timeValue = at(row, indexOf(headers, ["面试时间", "日期", "时间"], start, end));
  const parsedTime = normalizeDateValue(timeValue);
  const meetingValue = at(row, indexOf(headers, ["腾讯会议", "会议号", "会议信息"], start, end));
  const meeting = parseTencentMeeting(meetingValue);
  return {
    name, supplier, businessType: direction || businessFrom(sheet, at(row, indexOf(headers, ["业务方向", "方向", "类型"], start, end))),
    resumeFile: text(at(row, indexOf(headers, ["简历名称", "简历", "简历链接"], start, end))) || undefined,
    interviewTimeRaw: parsedTime.raw || undefined, interviewStartTime: parsedTime.start, interviewEndTime: parsedTime.end,
    meetingCode: meeting.meetingCode, meetingUrl: meeting.meetingUrl, meetingTextRaw: meeting.originalMeetingText,
    interviewResult: normalizeInterviewResult(at(row, indexOf(headers, ["是否通过", "面试结果", "结果"], start, end))),
    level: text(at(row, indexOf(headers, ["岗位定级", "定级", "评级", "岗位"], start, end))) || "未定级",
    interviewer: text(at(row, indexOf(headers, ["面试官"], start, end))) || undefined,
    interviewComment: text(at(row, indexOf(headers, ["面评", "备注", "评价"], start, end))) || undefined,
    entryStatus: "未知", sourceSheet: sheet, sourceRow,
  };
}

function parseInterview(rows: unknown[][], headerRow: number, sheet: string, grouped: boolean, warnings: { count: number }) {
  const headers = rows[headerRow], result: ParsedCandidate[] = []; let currentSupplier = "";
  rows.slice(headerRow + 1).forEach((row, offset) => {
    try {
      const nonEmpty = row.map(text).filter(Boolean);
      if (!nonEmpty.length) return;
      if (grouped && nonEmpty.length === 1) { currentSupplier = nonEmpty[0]; return; }
      const candidate = baseCandidate(row, headers, sheet, headerRow + offset + 2, businessFrom(sheet));
      if (!candidate) { warnings.count++; return; }
      if (grouped && currentSupplier && candidate.supplier === "未知供应商") candidate.supplier = currentSupplier;
      result.push(candidate);
    } catch { warnings.count++; }
  });
  return result;
}

function parseEntry(rows: unknown[][], headerRow: number, sheet: string, warnings: { count: number }) {
  const headers = rows[headerRow], names = headers.map((h, i) => /^(姓名|候选人姓名|人选姓名)$/.test(text(h)) ? i : -1).filter((i) => i >= 0);
  const anchors = names.length ? names : [indexOf(headers, ["姓名", "候选人"]) ?? 0];
  const result: ParsedCandidate[] = [];
  rows.slice(headerRow + 1).forEach((row, offset) => anchors.forEach((start, group) => {
    try {
      const end = anchors[group + 1] ?? headers.length;
      const candidate = baseCandidate(row, headers, sheet, headerRow + offset + 2, businessFrom(headers.slice(Math.max(0, start - 1), end).join(" "), group === 0 && anchors.length > 1 ? "视频" : group === 1 ? "音频" : sheet), [start, end]);
      if (!candidate) return;
      const dateValue = at(row, indexOf(headers, ["入职时间", "入职日期", "到岗时间"], start, end));
      candidate.entryDate = normalizeDateValue(dateValue).start;
      candidate.entryStatus = normalizeEntryStatus(at(row, indexOf(headers, ["是否入职", "入职状态", "状态", "离职状态", "放弃状态"], start, end)));
      candidate.interviewResult = "未知";
      result.push(candidate);
    } catch { warnings.count++; }
  }));
  return result;
}

function parseSuppliers(rows: unknown[][], headerRow: number, sheet: string, summary: boolean, warnings: { count: number }) {
  const h = rows[headerRow], result: ParsedSupplier[] = [];
  rows.slice(headerRow + 1).forEach((row) => {
    try {
      const supplier = text(at(row, indexOf(h, ["供应商名称", "供应商", "外包公司"])));
      if (!supplier || /总计|合计|说明|提醒/.test(supplier) || row.map(text).filter(Boolean).length < 2) return;
      const val = (aliases: string[]) => number(at(row, indexOf(h, aliases)));
      result.push({ supplier, videoResumeCount: val(["视频简历数量", "视频数量", "视频简历"]), audioResumeCount: val(["音频简历数量", "音频数量", "音频简历"]),
        videoInterviewPassed: val(["视频面试通过", "视频通过"]), videoConfirmedEntry: val(["视频确认入职"]), videoActualEntry: val(["视频已入职或爬坡", "视频已入职"]),
        audioInterviewPassed: val(["音频面试通过", "音频通过"]), audioConfirmedEntry: val(["音频确认入职"]), audioActualEntry: val(["音频已入职或爬坡", "音频已入职"]),
        status: text(at(row, indexOf(h, ["供应商状态", "当前进度", "状态"]))) || undefined, remark: text(at(row, indexOf(h, ["供应商备注", "备注"]))) || undefined, sourceSheet: sheet });
    } catch { warnings.count++; }
  });
  return result;
}

function mergeCandidates(rows: ParsedCandidate[]) {
  const map = new Map<string, ParsedCandidate>();
  for (const row of rows) {
    const identity = `${key(row.name)}|${key(row.supplier)}|${row.businessType}`;
    const existing = map.get(identity);
    if (!existing) { map.set(identity, row); continue; }
    for (const [field, value] of Object.entries(row)) if ((existing as any)[field] === undefined || ["未知", "待反馈", "未定级"].includes(String((existing as any)[field]))) (existing as any)[field] = value;
  }
  return [...map.values()];
}

export function parseWorkbook(workbook: XLSX.WorkBook, maxRows = 10_000): ParseResult {
  const candidates: ParsedCandidate[] = [], suppliers: ParsedSupplier[] = [], processedSheets: string[] = [], ignoredSheets: string[] = [], warnings = { count: 0 }; let seenRows = 0;
  for (const sheet of workbook.SheetNames) {
    if (invalidSheetNames.test(text(sheet))) { ignoredSheets.push(sheet); continue; }
    try {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: "", raw: true }).filter((row) => row.some((cell) => text(cell)));
      if (!rows.length) { ignoredSheets.push(sheet); continue; }
      const headerRow = detectHeaderRow(rows); if (headerRow < 0 || rows.length <= headerRow + 1) { ignoredSheets.push(sheet); continue; }
      const kind = classifySheet(sheet, rows, headerRow); if (kind === "unknown") { ignoredSheets.push(sheet); continue; }
      seenRows += rows.length - headerRow - 1; if (seenRows > maxRows) throw new Error("AUTO_DASHBOARD_ROW_LIMIT_EXCEEDED");
      if (kind === "interview" || kind === "grouped") candidates.push(...parseInterview(rows, headerRow, sheet, kind === "grouped", warnings));
      else if (kind === "entry") candidates.push(...parseEntry(rows, headerRow, sheet, warnings));
      else suppliers.push(...parseSuppliers(rows, headerRow, sheet, kind === "summary", warnings));
      processedSheets.push(sheet);
    } catch (error) { if ((error as Error).message === "AUTO_DASHBOARD_ROW_LIMIT_EXCEEDED") throw error; warnings.count++; ignoredSheets.push(sheet); }
  }
  return { candidates: mergeCandidates(candidates), suppliers, processedSheets, ignoredSheets, warningCount: warnings.count };
}
