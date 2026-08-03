import { Router } from "express";
import { RecordStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./database.js";
import { createSession, hashPassword, requireAuth, requireRoles, supplierRoles, verifyPassword } from "./auth.js";

const router = Router();
const publicUser = (user: any) => ({
  id: user.id, email: user.email, name: user.name, role: user.role,
  supplierId: user.supplierId, supplierName: user.supplier?.name || null,
  status: user.status, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt,
});

router.post("/login", async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string().min(8).max(200) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.trim().toLowerCase() }, include: { supplier: true } });
    if (!user || user.status !== RecordStatus.ACTIVE || !verifyPassword(body.password, user.passwordHash))
      return res.status(401).json({ success: false, code: "INVALID_CREDENTIALS", message: "邮箱或密码错误", requestId: res.locals.requestId });
    if (supplierRoles.has(user.role) && !user.supplierId)
      return res.status(403).json({ success: false, code: "AUTH_SUPPLIER_REQUIRED", message: "供应商账号尚未绑定供应商", requestId: res.locals.requestId });
    const token = await createSession(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return res.json({ success: true, data: { token, user: publicUser(user) }, requestId: res.locals.requestId });
  } catch (error) { next(error); }
});

router.get("/me", requireAuth, (req, res) => res.json({ success: true, data: req.auth, requestId: res.locals.requestId }));
router.post("/logout", requireAuth, async (req, res) => {
  if (req.authTokenHash) await prisma.authSession.deleteMany({ where: { tokenHash: req.authTokenHash } });
  res.json({ success: true, data: { loggedOut: true }, requestId: res.locals.requestId });
});

router.get("/suppliers", requireAuth, async (req, res) => {
  const where = req.auth && supplierRoles.has(req.auth.role)
    ? { id: req.auth.supplierId || "" } : { status: RecordStatus.ACTIVE };
  const rows = await prisma.supplier.findMany({ where, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } });
  res.json({ success: true, data: rows, requestId: res.locals.requestId });
});

router.get("/users", requireAuth, requireRoles(UserRole.PLATFORM_ADMIN, UserRole.SUPPLIER_ADMIN), async (req, res) => {
  const where = req.auth?.role === UserRole.SUPPLIER_ADMIN ? { supplierId: req.auth.supplierId || "" } : {};
  const rows = await prisma.user.findMany({ where, include: { supplier: true }, orderBy: { createdAt: "desc" } });
  res.json({ success: true, data: rows.map(publicUser), requestId: res.locals.requestId });
});

router.post("/users", requireAuth, requireRoles(UserRole.PLATFORM_ADMIN, UserRole.SUPPLIER_ADMIN), async (req, res, next) => {
  try {
    const body = z.object({
      email: z.string().email(), name: z.string().trim().min(1).max(100), password: z.string().min(8).max(200),
      role: z.nativeEnum(UserRole), supplierId: z.string().optional().nullable(),
    }).parse(req.body);
    const supplierRole = supplierRoles.has(body.role);
    if (req.auth?.role === UserRole.SUPPLIER_ADMIN && !([
      UserRole.SUPPLIER_VIDEO_RECRUITER,
      UserRole.SUPPLIER_AUDIO_RECRUITER,
      UserRole.SUPPLIER_RECRUITER,
    ] as UserRole[]).includes(body.role))
      return res.status(403).json({ success: false, code: "FORBIDDEN", message: "供应商管理员只能创建本公司的招聘账号" });
    const supplierId = req.auth?.role === UserRole.SUPPLIER_ADMIN ? req.auth.supplierId : body.supplierId;
    if (supplierRole && !supplierId) return res.status(400).json({ success: false, code: "AUTH_SUPPLIER_REQUIRED", message: "供应商账号必须绑定供应商" });
    if (!supplierRole && supplierId) return res.status(400).json({ success: false, code: "AUTH_SUPPLIER_INVALID", message: "内部账号不能绑定供应商" });
    const user = await prisma.user.create({ data: { email: body.email.toLowerCase(), name: body.name, passwordHash: hashPassword(body.password), role: body.role, supplierId }, include: { supplier: true } });
    res.status(201).json({ success: true, data: publicUser(user), requestId: res.locals.requestId });
  } catch (error) { next(error); }
});

router.put("/users/:id", requireAuth, requireRoles(UserRole.PLATFORM_ADMIN, UserRole.SUPPLIER_ADMIN), async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().trim().min(1).max(100).optional(), password: z.string().min(8).max(200).optional(), status: z.nativeEnum(RecordStatus).optional() }).parse(req.body);
    const target = await prisma.user.findFirst({ where: { id: String(req.params.id), ...(req.auth?.role === UserRole.SUPPLIER_ADMIN ? { supplierId: req.auth.supplierId || "", role: { in: [UserRole.SUPPLIER_VIDEO_RECRUITER, UserRole.SUPPLIER_AUDIO_RECRUITER, UserRole.SUPPLIER_RECRUITER] } } : {}) } });
    if (!target) return res.status(404).json({ success: false, code: "USER_NOT_FOUND", message: "账号不存在" });
    const updated = await prisma.user.update({ where: { id: target.id }, data: { name: body.name, status: body.status, passwordHash: body.password ? hashPassword(body.password) : undefined }, include: { supplier: true } });
    if (body.status === RecordStatus.INACTIVE || body.password) await prisma.authSession.deleteMany({ where: { userId: target.id } });
    res.json({ success: true, data: publicUser(updated), requestId: res.locals.requestId });
  } catch (error) { next(error); }
});

export default router;
