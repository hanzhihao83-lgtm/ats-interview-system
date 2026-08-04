import type { UserRole } from "../auth/AuthContext";
import type { BusinessLine } from "../types/businessLine";

const videoOnly = new Set<UserRole>(["VIDEO_RECRUITER", "SUPPLIER_VIDEO_RECRUITER"]);
const audioOnly = new Set<UserRole>(["AUDIO_RECRUITER", "SUPPLIER_AUDIO_RECRUITER"]);
export const canAccessBusinessLine = (role: UserRole, line: BusinessLine, configuredLines?: string[]) =>
  configuredLines?.length
    ? configuredLines.includes(line)
    : line === "VIDEO"
      ? !audioOnly.has(role)
      : !videoOnly.has(role);
export const canAccessCombinedRecruitment = (role: UserRole, configuredLines?: string[]) =>
  role !== "INTERVIEWER" && (configuredLines?.length ? configuredLines.length > 1 : !videoOnly.has(role) && !audioOnly.has(role));
export const defaultRecruitmentPath = (role: UserRole, configuredLines?: string[]) =>
  role === "INTERVIEWER"
    ? "/calendar"
    : configuredLines?.length === 1
      ? configuredLines[0] === "VIDEO" ? "/video/dashboard" : "/audio/dashboard"
      : videoOnly.has(role)
        ? "/video/dashboard"
        : audioOnly.has(role)
          ? "/audio/dashboard"
          : "/dashboard";
