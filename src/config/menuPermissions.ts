import type { UserRole } from "../auth/AuthContext";
import type { BusinessLine } from "../types/businessLine";

const videoOnly = new Set<UserRole>(["VIDEO_RECRUITER", "SUPPLIER_VIDEO_RECRUITER"]);
const audioOnly = new Set<UserRole>(["AUDIO_RECRUITER", "SUPPLIER_AUDIO_RECRUITER"]);
export const canAccessBusinessLine = (role: UserRole, line: BusinessLine) => line === "VIDEO" ? !audioOnly.has(role) : !videoOnly.has(role);
export const canAccessCombinedRecruitment = (role: UserRole) => !videoOnly.has(role) && !audioOnly.has(role);
export const defaultRecruitmentPath = (role: UserRole) => videoOnly.has(role) ? "/video/dashboard" : audioOnly.has(role) ? "/audio/dashboard" : "/dashboard";
