import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { RecordStatus, type UserRole } from "@prisma/client";
import { prisma } from "./database.js";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  supplierId: string | null;
  supplierName: string | null;
};

declare global {
  namespace Express {
    interface Request { auth?: AuthUser; authTokenHash?: string }
  }
}

const SESSION_DAYS = Math.max(1, Number(process.env.AUTH_SESSION_DAYS || 7));
export const supplierRoles = new Set<UserRole>([
  "SUPPLIER_ADMIN",
  "SUPPLIER_VIDEO_RECRUITER",
  "SUPPLIER_AUDIO_RECRUITER",
  "SUPPLIER_RECRUITER",
]);
export const isSupplierUser = (req: Request) => Boolean(req.auth && supplierRoles.has(req.auth.role));
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [scheme, salt, expected] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBytes = Buffer.from(expected, "hex");
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: {
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
  }});
  return token;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authorization = req.header("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return res.status(401).json({ success: false, code: "AUTH_REQUIRED", message: "请先登录", requestId: res.locals.requestId });
  const tokenHash = hashToken(token);
  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    include: { user: { include: { supplier: { select: { name: true } } } } },
  }).catch(() => null);
  if (!session || session.expiresAt <= new Date() || session.user.status !== RecordStatus.ACTIVE) {
    if (session) await prisma.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return res.status(401).json({ success: false, code: "AUTH_EXPIRED", message: "登录已过期，请重新登录", requestId: res.locals.requestId });
  }
  req.authTokenHash = tokenHash;
  req.auth = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    supplierId: session.user.supplierId,
    supplierName: session.user.supplier?.name || null,
  };
  if (Date.now() - session.lastUsedAt.getTime() > 300_000)
    void prisma.authSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  next();
}

export const requireRoles = (...roles: UserRole[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.auth || !roles.includes(req.auth.role))
    return res.status(403).json({ success: false, code: "FORBIDDEN", message: "没有执行此操作的权限", requestId: res.locals.requestId });
  next();
};

export function supplierIdFor(req: Request, requested?: string | null) {
  if (isSupplierUser(req)) return req.auth!.supplierId;
  return requested || undefined;
}

export function supplierNameFor(req: Request, requested?: string | null) {
  if (isSupplierUser(req)) return req.auth!.supplierName;
  return requested || undefined;
}

export function assertSupplierIdentity(req: Request) {
  if (isSupplierUser(req) && (!req.auth?.supplierId || !req.auth.supplierName)) throw new Error("AUTH_SUPPLIER_REQUIRED");
}
