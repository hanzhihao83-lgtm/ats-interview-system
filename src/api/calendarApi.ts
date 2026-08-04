import { api } from "./backend";
import type { UserBusinessLine } from "../auth/AuthContext";

const jsonRequest = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export interface InterviewerProfile {
  id: string;
  department?: string | null;
  businessLines: UserBusinessLine[];
  positionIds: string[];
  workingDays: number[];
  workStartMinute: number;
  workEndMinute: number;
  user: { id: string; name: string; email?: string; kimUserId?: string | null };
}

export interface InterviewerCalendarBlock {
  id: string;
  recurrence: "SINGLE" | "WEEKLY";
  type: "LEAVE" | "INTERNAL_MEETING" | "TRAINING" | "LUNCH_BREAK" | "TEMPORARILY_UNAVAILABLE" | "OTHER";
  title: string;
  reason?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  weekday?: number | null;
  startMinute?: number | null;
  endMinute?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface CalendarEvent {
  id: string;
  sourceId?: string;
  interviewerId: string;
  kind: "INTERVIEW" | "UNAVAILABLE" | "FIXED_BREAK";
  title: string;
  start: string;
  end: string;
  occupied: boolean;
  detailsVisible: boolean;
  status?: string;
  applicationId?: string;
  supplierName?: string;
  candidateName?: string;
  positionName?: string;
  ownerName?: string;
  roundName?: string;
}

export interface CalendarBoard {
  timezone: string;
  dates: string[];
  profiles: InterviewerProfile[];
  events: CalendarEvent[];
}

export const calendarApi = {
  interviewers: (businessLine?: UserBusinessLine) =>
    api<InterviewerProfile[]>(`/api/calendar/interviewers${businessLine ? `?businessLine=${businessLine}` : ""}`),
  board: (from: string, to: string, businessLine?: UserBusinessLine, interviewerIds?: string[]) => {
    const params = new URLSearchParams({ from, to });
    if (businessLine) params.set("businessLine", businessLine);
    if (interviewerIds?.length) params.set("interviewerIds", interviewerIds.join(","));
    return api<CalendarBoard>(`/api/calendar/board?${params}`);
  },
  createInterviewer: (body: unknown) =>
    api<InterviewerProfile>("/api/calendar/interviewers", jsonRequest("POST", body)),
  updateInterviewer: (id: string, body: unknown) =>
    api<InterviewerProfile>(`/api/calendar/interviewers/${id}`, jsonRequest("PUT", body)),
  blocks: (id: string) => api<InterviewerCalendarBlock[]>(`/api/calendar/interviewers/${id}/blocks`),
  createBlock: (id: string, body: unknown) =>
    api(`/api/calendar/interviewers/${id}/blocks`, jsonRequest("POST", body)),
  updateBlock: (id: string, body: unknown) =>
    api(`/api/calendar/blocks/${id}`, jsonRequest("PUT", body)),
  removeBlock: (id: string) => api(`/api/calendar/blocks/${id}`, jsonRequest("DELETE")),
  notifications: () => api<{ rows: any[]; unread: number }>("/api/notifications"),
  readNotification: (id: string) => api(`/api/notifications/${id}/read`, jsonRequest("PUT")),
  readAllNotifications: () => api("/api/notifications/read-all", jsonRequest("POST")),
};
