import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { detectHeaderRow, normalizeDateValue, parseTencentMeeting, parseWorkbook } from "./autoDashboardParser.js";

const workbook = (sheets: Record<string, unknown[][]>) => { const book = XLSX.utils.book_new(); Object.entries(sheets).forEach(([name, rows]) => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name)); return book; };

test("检测标题后的多行表头", () => assert.equal(detectHeaderRow([["面试安排"], ["姓名", "供应商", "面试时间"]]), 1));
test("Excel 日期序列可以转换", () => assert.equal(normalizeDateValue(46237).start?.getFullYear(), 2026));
test("中文无年份日期使用参考年份", () => assert.equal(normalizeDateValue("6月25日", 2027).start?.getFullYear(), 2027));
test("日期范围提取开始和结束时间", () => { const r = normalizeDateValue("2026/08/03 15：30-16:00"); assert.equal(r.start?.getHours(), 15); assert.equal(r.end?.getHours(), 16); });
test("腾讯会议号可以提取", () => assert.equal(parseTencentMeeting("#腾讯会议：630-438-079").meetingCode, "630-438-079"));
test("腾讯会议链接可以提取", () => assert.equal(parseTencentMeeting("主题\nhttps://meeting.tencent.com/dm/abcd").meetingUrl, "https://meeting.tencent.com/dm/abcd"));
test("空白和 info 工作表被忽略", () => { const r = parseWorkbook(workbook({ info: [["说明"]], 空白: [[""]], 视频面试: [["姓名", "供应商", "面试时间"], ["小王", "人瑞", "2026-08-03"]] })); assert.deepEqual(r.ignoredSheets.sort(), ["info", "空白"]); });
test("识别视频面试表", () => { const r = parseWorkbook(workbook({ 视频侧面试: [["标题"], ["人选姓名", "供应商", "面试时间", "是否通过"], ["小王", "人瑞", "2026-08-03", "是"]] })); assert.equal(r.candidates[0].businessType, "视频"); assert.equal(r.candidates[0].interviewResult, "通过"); });
test("识别音频面试表", () => { const r = parseWorkbook(workbook({ 音频面试进度: [["姓名", "供应商", "面试时间"], ["小李", "德科", "2026-08-03"]] })); assert.equal(r.candidates[0].businessType, "音频"); });
test("供应商分组行不会成为候选人", () => { const r = parseWorkbook(workbook({ 视频: [["姓名", "面试时间", "是否通过"], ["人瑞"], ["小王", "2026-08-03", "通过"], ["德科"], ["小李", "2026-08-04", "否"]] })); assert.equal(r.candidates.length, 2); assert.deepEqual(r.candidates.map((x) => x.supplier), ["人瑞", "德科"]); });
test("待入职左右并列表分别解析视频和音频", () => { const r = parseWorkbook(workbook({ "待入职-时间": [["视频侧", "", "", "", "音频侧"], ["姓名", "入职时间", "供应商名称", "是否入职", "姓名", "入职时间", "供应商名称", "是否入职"], ["甲", "2026-08-03", "人瑞", "已入职", "乙", "2026-08-04", "德科", "待入职"]] })); assert.equal(r.candidates.length, 2); assert.deepEqual(r.candidates.map((x) => x.businessType), ["视频", "音频"]); });
test("已通过汇总忽略总计并提取人数", () => { const r = parseWorkbook(workbook({ 已通过: [["供应商", "视频面试通过", "视频确认入职", "音频面试通过"], ["人瑞", 3, 2, 1], ["总计", 3, 2, 1]] })); assert.equal(r.suppliers.length, 1); assert.equal(r.suppliers[0].videoInterviewPassed, 3); });
test("供应商简历表提取视频音频数量", () => { const r = parseWorkbook(workbook({ 各供应商简历: [["供应商名称", "视频数量", "音频数量", "当前进度"], ["人瑞", 5, 4, "正常"]] })); assert.equal(r.suppliers[0].audioResumeCount, 4); });
test("缺少姓名的行被跳过且其他行继续", () => { const r = parseWorkbook(workbook({ 面试安排: [["姓名", "供应商", "面试时间"], ["", "人瑞", "2026-08-03"], ["小王", "人瑞", "2026-08-04"]] })); assert.equal(r.candidates.length, 1); assert.equal(r.warningCount, 1); });
test("只有表头的工作表被忽略", () => { const r = parseWorkbook(workbook({ 面试安排: [["姓名", "供应商", "面试时间"]], 视频侧面试: [["姓名", "供应商", "面试时间"], ["小王", "人瑞", "2026-08-03"]] })); assert.ok(r.ignoredSheets.includes("面试安排")); });
for (const bookType of ["xlsx", "xls"] as const) test(`读取 ${bookType} 文件内容`, () => { const source = workbook({ 视频面试: [["姓名", "供应商", "面试时间"], ["小王", "人瑞", "2026-08-03"]] }); const bytes = XLSX.write(source, { type: "buffer", bookType }); const parsed = parseWorkbook(XLSX.read(bytes, { type: "buffer", cellFormula: false, bookVBA: false })); assert.equal(parsed.candidates.length, 1); });
test("读取 csv 文件内容且日期不偏移", () => { const source = "姓名,供应商,面试时间\n小王,人瑞,2026-08-03 15:30-16:00"; const parsed = parseWorkbook(XLSX.read(source, { type: "string", raw: true })); assert.equal(parsed.candidates[0].name, "小王"); assert.equal(parsed.candidates[0].interviewTimeRaw, "2026-08-03 15:30-16:00"); });
