import test from "node:test";
import assert from "node:assert/strict";
import {
  BusinessLine,
  CalendarBlockType,
  CalendarRecurrence,
  RecordStatus,
  type InterviewerCalendarBlock,
} from "@prisma/client";
import {
  assertWorkingTime,
  calendarBlockConflicts,
  enumerateShanghaiDates,
  shanghaiDateAt,
} from "./interviewerCalendarService.js";

const profile = {
  id: "interviewer-1",
  businessLines: [BusinessLine.VIDEO],
  positionIds: [],
  workingDays: [1, 2, 3, 4, 5],
  workStartMinute: 9 * 60,
  workEndMinute: 21 * 60,
  status: RecordStatus.ACTIVE,
};
const slot = (minute: number) => [
  shanghaiDateAt("2026-08-03", minute),
  shanghaiDateAt("2026-08-03", minute + 30),
] as const;

test("固定休息时间严格按已确认的边界放行或拦截", () => {
  for (const allowed of [11 * 60, 13 * 60 + 30, 17 * 60, 18 * 60 + 30]) {
    const [start, end] = slot(allowed);
    assert.doesNotThrow(() => assertWorkingTime(profile, start, end));
  }
  for (const blocked of [11 * 60 + 30, 12 * 60, 13 * 60, 17 * 60 + 30, 18 * 60]) {
    const [start, end] = slot(blocked);
    assert.throws(() => assertWorkingTime(profile, start, end), /INTERVIEW_FIXED_BREAK_CONFLICT/);
  }
});

test("面试必须固定 30 分钟并从整点或半点开始", () => {
  const start = shanghaiDateAt("2026-08-03", 9 * 60);
  assert.throws(() => assertWorkingTime(profile, start, new Date(start.getTime() + 60 * 60_000)), /INTERVIEW_DURATION_INVALID/);
  const offGrid = shanghaiDateAt("2026-08-03", 9 * 60 + 10);
  assert.throws(() => assertWorkingTime(profile, offGrid, new Date(offGrid.getTime() + 30 * 60_000)), /INTERVIEW_SLOT_GRANULARITY_INVALID/);
});

test("面试官手工锁定时间应计入 10 分钟缓冲", () => {
  const block = {
    id: "block-1",
    interviewerId: profile.id,
    type: CalendarBlockType.TEMPORARILY_UNAVAILABLE,
    title: "内部会议",
    reason: null,
    recurrence: CalendarRecurrence.SINGLE,
    startAt: shanghaiDateAt("2026-08-03", 10 * 60),
    endAt: shanghaiDateAt("2026-08-03", 11 * 60),
    weekday: null,
    startMinute: null,
    endMinute: null,
    effectiveFrom: null,
    effectiveTo: null,
    status: RecordStatus.ACTIVE,
    createdById: "admin",
    createdByName: "管理员",
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies InterviewerCalendarBlock;
  assert.equal(calendarBlockConflicts(block, ...slot(9 * 60 + 30)), true);
  assert.equal(calendarBlockConflicts(block, ...slot(9 * 60)), false);
  assert.equal(calendarBlockConflicts(block, ...slot(11 * 60)), false);
});

test("看板日期范围使用左闭右开，日视图不会多返回下一天", () => {
  const from = shanghaiDateAt("2026-08-03", 0);
  assert.deepEqual(
    enumerateShanghaiDates(from, shanghaiDateAt("2026-08-04", 0)),
    ["2026-08-03"],
  );
  assert.deepEqual(
    enumerateShanghaiDates(from, shanghaiDateAt("2026-08-10", 0)),
    ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"],
  );
});
