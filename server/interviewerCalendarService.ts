import {
  BusinessLine,
  CalendarRecurrence,
  Prisma,
  RecordStatus,
  type InterviewerCalendarBlock,
  type InterviewerProfile,
} from "@prisma/client";

export const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
export const INTERVIEW_DURATION_MS = 30 * 60_000;
export const INTERVIEW_BUFFER_MS = 10 * 60_000;
export const FIXED_BREAKS = [
  { title: "午间固定休息", startMinute: 11 * 60 + 50, endMinute: 13 * 60 + 30 },
  { title: "晚间固定休息", startMinute: 18 * 60, endMinute: 18 * 60 + 30 },
] as const;

export type CalendarProfile = Pick<
  InterviewerProfile,
  | "id"
  | "businessLines"
  | "positionIds"
  | "workingDays"
  | "workStartMinute"
  | "workEndMinute"
  | "status"
>;

export function shanghaiParts(value: Date) {
  const local = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  return {
    weekday: local.getUTCDay(),
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    millisecond: local.getUTCMilliseconds(),
    dateKey: local.toISOString().slice(0, 10),
  };
}

export function shanghaiDateAt(dateKey: string, minute: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) throw new Error("CALENDAR_DATE_INVALID");
  return new Date(
    Date.UTC(year, month - 1, day, Math.floor(minute / 60), minute % 60) -
      SHANGHAI_OFFSET_MS,
  );
}

export function assertThirtyMinuteSlot(start: Date, end: Date) {
  const startParts = shanghaiParts(start);
  if (end.getTime() - start.getTime() !== INTERVIEW_DURATION_MS)
    throw new Error("INTERVIEW_DURATION_INVALID");
  if (
    ![0, 30].includes(startParts.minute % 60) ||
    startParts.second !== 0 ||
    startParts.millisecond !== 0
  )
    throw new Error("INTERVIEW_SLOT_GRANULARITY_INVALID");
}

function intervalOverlaps(
  startMinute: number,
  endMinuteWithBuffer: number,
  blockedStartMinute: number,
  blockedEndMinute: number,
) {
  return startMinute < blockedEndMinute && endMinuteWithBuffer > blockedStartMinute;
}

export function assertWorkingTime(profile: CalendarProfile, start: Date, end: Date) {
  if (profile.status !== RecordStatus.ACTIVE) throw new Error("INTERVIEWER_INACTIVE");
  assertThirtyMinuteSlot(start, end);
  const startParts = shanghaiParts(start);
  const endParts = shanghaiParts(end);
  if (startParts.dateKey !== endParts.dateKey) throw new Error("INTERVIEW_TIME_INVALID");
  if (!profile.workingDays.includes(startParts.weekday))
    throw new Error("INTERVIEWER_NON_WORKING_DAY");
  if (startParts.minute < profile.workStartMinute || endParts.minute > profile.workEndMinute)
    throw new Error("INTERVIEWER_OUTSIDE_WORKING_HOURS");
  for (const fixedBreak of FIXED_BREAKS) {
    if (
      intervalOverlaps(
        startParts.minute,
        endParts.minute + INTERVIEW_BUFFER_MS / 60_000,
        fixedBreak.startMinute,
        fixedBreak.endMinute,
      )
    )
      throw new Error("INTERVIEW_FIXED_BREAK_CONFLICT");
  }
}

function recurringBlockApplies(block: InterviewerCalendarBlock, start: Date) {
  const parts = shanghaiParts(start);
  if (block.weekday !== parts.weekday) return false;
  const dayStart = shanghaiDateAt(parts.dateKey, 0);
  const dayEnd = shanghaiDateAt(parts.dateKey, 24 * 60);
  if (block.effectiveFrom && block.effectiveFrom >= dayEnd) return false;
  if (block.effectiveTo && block.effectiveTo < dayStart) return false;
  return true;
}

export function calendarBlockConflicts(
  block: InterviewerCalendarBlock,
  start: Date,
  end: Date,
) {
  if (block.status !== RecordStatus.ACTIVE) return false;
  if (block.recurrence === CalendarRecurrence.SINGLE) {
    if (!block.startAt || !block.endAt) return false;
    return (
      start < block.endAt &&
      new Date(end.getTime() + INTERVIEW_BUFFER_MS) > block.startAt
    );
  }
  if (
    block.startMinute === null ||
    block.endMinute === null ||
    !recurringBlockApplies(block, start)
  )
    return false;
  const startMinute = shanghaiParts(start).minute;
  const endMinute = shanghaiParts(end).minute;
  return intervalOverlaps(
    startMinute,
    endMinute + INTERVIEW_BUFFER_MS / 60_000,
    block.startMinute,
    block.endMinute,
  );
}

export async function interviewHasProfileConflict(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
  interviewerProfileId: string,
  start: Date,
  end: Date,
  excludeInterviewId?: string,
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Interview"
    WHERE "interviewerProfileId" = ${interviewerProfileId}
      ${excludeInterviewId ? Prisma.sql`AND "id" <> ${excludeInterviewId}` : Prisma.empty}
      AND "status" NOT IN ('已取消', '取消', '候选人拒绝')
      AND "scheduledStartTime" < (${new Date(end.getTime() + INTERVIEW_BUFFER_MS)}::timestamptz AT TIME ZONE 'UTC')
      AND COALESCE("scheduledEndTime", "scheduledStartTime" + INTERVAL '30 minutes') > (${new Date(start.getTime() - INTERVIEW_BUFFER_MS)}::timestamptz AT TIME ZONE 'UTC')
    LIMIT 1
  `);
  return rows.length > 0;
}

export async function assertInterviewerAvailable(
  tx: Prisma.TransactionClient,
  profile: CalendarProfile,
  start: Date,
  end: Date,
  options: {
    businessLine: BusinessLine;
    positionId?: string | null;
    excludeInterviewId?: string;
  },
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT true AS "locked" FROM pg_advisory_xact_lock(hashtext(${profile.id}))`,
  );
  assertWorkingTime(profile, start, end);
  if (!profile.businessLines.includes(options.businessLine))
    throw new Error("INTERVIEWER_BUSINESS_LINE_MISMATCH");
  if (
    profile.positionIds.length &&
    options.positionId &&
    !profile.positionIds.includes(options.positionId)
  )
    throw new Error("INTERVIEWER_POSITION_MISMATCH");

  const blocks = await tx.interviewerCalendarBlock.findMany({
    where: { interviewerId: profile.id, status: RecordStatus.ACTIVE },
  });
  if (blocks.some((block) => calendarBlockConflicts(block, start, end)))
    throw new Error("INTERVIEWER_UNAVAILABLE_BLOCK_CONFLICT");
  if (
    await interviewHasProfileConflict(
      tx,
      profile.id,
      start,
      end,
      options.excludeInterviewId,
    )
  )
    throw new Error("INTERVIEW_TIME_CONFLICT");
}

export function enumerateShanghaiDates(from: Date, to: Date) {
  const fromKey = shanghaiParts(from).dateKey;
  const dates: string[] = [];
  for (
    let current = shanghaiDateAt(fromKey, 0);
    current < to && dates.length < 15;
    current = new Date(current.getTime() + 24 * 60 * 60_000)
  )
    dates.push(shanghaiParts(current).dateKey);
  return dates;
}

export function fixedBreakEvents(profileId: string, dates: string[], workingDays: number[]) {
  return dates.flatMap((dateKey) => {
    const weekday = shanghaiParts(shanghaiDateAt(dateKey, 0)).weekday;
    if (!workingDays.includes(weekday)) return [];
    return FIXED_BREAKS.map((row, index) => ({
      id: `fixed-${profileId}-${dateKey}-${index}`,
      interviewerId: profileId,
      kind: "FIXED_BREAK" as const,
      title: row.title,
      start: shanghaiDateAt(dateKey, row.startMinute).toISOString(),
      end: shanghaiDateAt(dateKey, row.endMinute).toISOString(),
      occupied: true,
      detailsVisible: true,
    }));
  });
}
