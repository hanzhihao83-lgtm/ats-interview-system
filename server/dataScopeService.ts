import { BusinessLine, UserRole, type Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "./database.js";
import type { AuthUser } from "./auth.js";

export interface DataScope {
  supplierId?: string;
  businessLine?: BusinessLine;
}

export class ScopeForbiddenError extends Error {
  audited = false;
  constructor(public reason: string) {
    super("DATA_SCOPE_FORBIDDEN");
  }
}

const supplierRoles = new Set<UserRole>([
  UserRole.SUPPLIER_ADMIN,
  UserRole.SUPPLIER_VIDEO_RECRUITER,
  UserRole.SUPPLIER_AUDIO_RECRUITER,
  UserRole.SUPPLIER_RECRUITER,
]);

const forcedBusinessLine = (role: UserRole) => {
  if (role === UserRole.VIDEO_RECRUITER || role === UserRole.SUPPLIER_VIDEO_RECRUITER) return BusinessLine.VIDEO;
  if (role === UserRole.AUDIO_RECRUITER || role === UserRole.SUPPLIER_AUDIO_RECRUITER) return BusinessLine.AUDIO;
  return undefined;
};

export function buildDataScope(
  currentUser: AuthUser,
  requestedSupplierId?: string | null,
  requestedBusinessLine?: BusinessLine | null,
): DataScope {
  const supplierScoped = supplierRoles.has(currentUser.role);
  if (supplierScoped && !currentUser.supplierId)
    throw new ScopeForbiddenError("供应商账号未绑定供应商");
  if (supplierScoped && requestedSupplierId && requestedSupplierId !== currentUser.supplierId)
    throw new ScopeForbiddenError("不能访问其他供应商数据");

  const forcedLine = forcedBusinessLine(currentUser.role);
  if (forcedLine && requestedBusinessLine && requestedBusinessLine !== forcedLine)
    throw new ScopeForbiddenError("不能访问其他业务部门数据");

  if (requestedBusinessLine === BusinessLine.UNCLASSIFIED && supplierScoped)
    throw new ScopeForbiddenError("供应商账号不能访问待归类数据");

  const result: DataScope = {};
  const supplierId = supplierScoped ? currentUser.supplierId! : requestedSupplierId || undefined;
  const businessLine = forcedLine || requestedBusinessLine || undefined;
  if (supplierId) result.supplierId = supplierId;
  if (businessLine) result.businessLine = businessLine;
  return result;
}

export const applicationScopeWhere = (scope: DataScope): Prisma.CandidateApplicationWhereInput => ({
  deletedAt: null,
  ...(scope.supplierId ? { supplierId: scope.supplierId } : {}),
  ...(scope.businessLine ? { businessLine: scope.businessLine } : {}),
});

export const canAccessCombined = (role: UserRole) => role !== UserRole.VIDEO_RECRUITER && role !== UserRole.AUDIO_RECRUITER && role !== UserRole.SUPPLIER_VIDEO_RECRUITER && role !== UserRole.SUPPLIER_AUDIO_RECRUITER;

export async function writeScopeAudit(
  req: Request,
  resourceType: string,
  resourceId: string | undefined,
  requested: { supplierId?: string; businessLine?: string },
  reason: string,
) {
  await prisma.auditLog.create({ data: {
    userId: req.auth?.id,
    action: "DATA_SCOPE_DENIED",
    resourceType,
    resourceId,
    requestedScope: requested,
    effectiveScope: req.auth ? {
      supplierId: req.auth.supplierId,
      role: req.auth.role,
    } : undefined,
    result: "DENIED",
    reason,
    requestId: resRequestId(req),
  }}).catch(() => undefined);
}

const resRequestId = (req: Request) => String(req.headers["x-request-id"] || "");

export function parseBusinessLine(value: unknown): BusinessLine | undefined {
  if (!value) return undefined;
  const normalized = String(value).trim().toUpperCase();
  if (normalized === "VIDEO" || normalized === "视频") return BusinessLine.VIDEO;
  if (normalized === "AUDIO" || normalized === "音频") return BusinessLine.AUDIO;
  if (normalized === "UNCLASSIFIED" || normalized === "待归类") return BusinessLine.UNCLASSIFIED;
  throw new ScopeForbiddenError("无效的业务部门");
}

export async function scopedOrThrow<T>(
  req: Request,
  resourceType: string,
  resourceId: string | undefined,
  requested: { supplierId?: string; businessLine?: BusinessLine },
  work: (scope: DataScope) => Promise<T>,
) {
  try {
    const scope = buildDataScope(req.auth!, requested.supplierId, requested.businessLine);
    return await work(scope);
  } catch (error) {
    if (error instanceof ScopeForbiddenError)
      await writeScopeAudit(req, resourceType, resourceId, requested, error.reason).then(() => { error.audited = true; });
    throw error;
  }
}
