declare module "./interviewReminderService.mjs" {
  export const defaultReminderSettings: Record<string, unknown>;
  export function createInterviewReminderTasks(interview: Record<string, unknown>): Record<string, unknown>[];
  export function scanAndSendInterviewReminders(store: Record<string, unknown>): Promise<void>;
}
declare module "./kimClient.mjs" {
  export function kimConfig(): { mode?: string };
  export function createKimClient(): { configured: boolean; sendMessage(config: unknown, message: unknown): Promise<{ success: boolean; code?: string; message?: string; requestId?: string }> };
}
