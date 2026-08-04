import { Router, type Request } from "express";
import {
  BusinessLine,
  FeaturePermission,
  RecordStatus,
  UserRole,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "./database.js";
import {
  ALL_FEATURE_PERMISSIONS,
  createSession,
  hashPassword,
  hasPermission,
  requireAuth,
  supplierRoles,
  verifyPassword,
} from "./auth.js";

const router = Router();

const publicUser = (user: any) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  supplierId: user.supplierId,
  supplierName: user.supplier?.name || null,
  status: user.status,
  isSupplierManager: user.isSupplierManager,
  permissions: user.permissions,
  businessLines: user.businessLines,
  kimUserId: user.kimUserId,
  interviewerProfileId: user.interviewerProfile?.id || null,
  simulation: null,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
});

const userInclude = {
  supplier: true,
  interviewerProfile: { select: { id: true } },
} as const;

const isPlatformAdmin = (req: Request) => req.auth?.role === UserRole.PLATFORM_ADMIN;
const canManageSupplierAccounts = (req: Request) =>
  Boolean(isPlatformAdmin(req) || req.auth?.isSupplierManager);

const forbidden = (res: any, message = "没有管理账号的权限") =>
  res.status(403).json({ success: false, code: "FEATURE_PERMISSION_FORBIDDEN", message });

const permissionArray = z.array(z.nativeEnum(FeaturePermission)).max(ALL_FEATURE_PERMISSIONS.length);
const businessLineArray = z
  .array(z.nativeEnum(BusinessLine))
  .max(2)
  .transform((rows) => [...new Set(rows.filter((row) => row !== BusinessLine.UNCLASSIFIED))]);

function assertSubset<T>(requested: T[], allowed: T[], code: string) {
  if (requested.some((item) => !allowed.includes(item))) throw new Error(code);
}

async function supplierAuthorization(supplierId: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true, permissionCap: true, businessLines: true, status: true },
  });
  if (!supplier || supplier.status !== RecordStatus.ACTIVE) throw new Error("SUPPLIER_NOT_FOUND");
  return supplier;
}

router.post("/login", async (req, res, next) => {
  try {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(8).max(200) })
      .parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email.trim().toLowerCase() },
      include: userInclude,
    });
    if (
      !user ||
      user.status !== RecordStatus.ACTIVE ||
      !verifyPassword(body.password, user.passwordHash)
    )
      return res.status(401).json({
        success: false,
        code: "INVALID_CREDENTIALS",
        message: "邮箱或密码错误",
        requestId: res.locals.requestId,
      });
    if (supplierRoles.has(user.role) && !user.supplierId)
      return res.status(403).json({
        success: false,
        code: "AUTH_SUPPLIER_REQUIRED",
        message: "外包公司账号尚未绑定公司",
        requestId: res.locals.requestId,
      });
    if (user.role === UserRole.INTERVIEWER && !user.interviewerProfile)
      return res.status(403).json({
        success: false,
        code: "INTERVIEWER_PROFILE_REQUIRED",
        message: "面试官档案尚未配置",
        requestId: res.locals.requestId,
      });
    const token = await createSession(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return res.json({
      success: true,
      data: { token, user: publicUser(user) },
      requestId: res.locals.requestId,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (req, res) =>
  res.json({ success: true, data: req.auth, requestId: res.locals.requestId }),
);

router.post("/logout", requireAuth, async (req, res) => {
  if (req.authTokenHash)
    await prisma.authSession.deleteMany({ where: { tokenHash: req.authTokenHash } });
  res.json({ success: true, data: { loggedOut: true }, requestId: res.locals.requestId });
});

router.post("/simulation", requireAuth, async (req, res, next) => {
  try {
    if (!isPlatformAdmin(req)) return forbidden(res, "只有平台管理员可以切换模拟视角");
    const body = z.object({ supplierId: z.string().optional().nullable() }).parse(req.body);
    const supplier = body.supplierId ? await supplierAuthorization(body.supplierId) : null;
    await prisma.auditLog.create({
      data: {
        userId: req.auth!.id,
        action: supplier ? "SUPPLIER_SIMULATION_ENTERED" : "SUPPLIER_SIMULATION_EXITED",
        resourceType: "SupplierSimulation",
        resourceId: supplier?.id,
        effectiveScope: supplier ? { supplierId: supplier.id, supplierName: supplier.name } : {},
        result: "SUCCESS",
        requestId: String(res.locals.requestId || ""),
      },
    });
    return res.json({
      success: true,
      data: supplier ? { supplierId: supplier.id, supplierName: supplier.name } : null,
      requestId: res.locals.requestId,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/permission-catalog", requireAuth, (req, res) =>
  res.json({
    success: true,
    data: {
      permissions: ALL_FEATURE_PERMISSIONS,
      businessLines: [BusinessLine.VIDEO, BusinessLine.AUDIO],
    },
    requestId: res.locals.requestId,
  }),
);

router.get("/suppliers", requireAuth, async (req, res) => {
  const supplierScoped = supplierRoles.has(req.auth!.role);
  const where = supplierScoped
    ? { id: req.auth!.supplierId || "" }
    : { status: RecordStatus.ACTIVE };
  const rows = await prisma.supplier.findMany({
    where,
    select: {
      id: true,
      name: true,
      code: true,
      businessLines: true,
      permissionCap: true,
    },
    orderBy: { name: "asc" },
  });
  res.json({ success: true, data: rows, requestId: res.locals.requestId });
});

router.put("/suppliers/:id/authorization", requireAuth, async (req, res, next) => {
  try {
    if (!isPlatformAdmin(req)) return forbidden(res, "只有平台管理员可以设置公司权限上限");
    const body = z
      .object({
        permissionCap: permissionArray,
        businessLines: businessLineArray.refine((rows) => rows.length > 0, "至少选择一条业务线"),
      })
      .parse(req.body);
    const supplier = await supplierAuthorization(String(req.params.id));
    const users = await prisma.user.findMany({ where: { supplierId: supplier.id } });
    await prisma.$transaction(async (tx) => {
      await tx.supplier.update({
        where: { id: supplier.id },
        data: { permissionCap: body.permissionCap, businessLines: body.businessLines },
      });
      for (const user of users) {
        const permissions = user.permissions.filter((item) => body.permissionCap.includes(item));
        const businessLines = user.businessLines.filter((item) =>
          (body.businessLines as BusinessLine[]).includes(item),
        );
        await tx.user.update({
          where: { id: user.id },
          data: { permissions, businessLines },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: req.auth!.id,
          action: "SUPPLIER_AUTHORIZATION_UPDATED",
          resourceType: "Supplier",
          resourceId: supplier.id,
          requestedScope: { permissionCap: body.permissionCap, businessLines: body.businessLines },
          effectiveScope: { supplierId: supplier.id },
          result: "SUCCESS",
          requestId: String(res.locals.requestId || ""),
        },
      });
    });
    const updated = await prisma.supplier.findUniqueOrThrow({ where: { id: supplier.id } });
    return res.json({ success: true, data: updated, requestId: res.locals.requestId });
  } catch (error) {
    next(error);
  }
});

router.get("/users", requireAuth, async (req, res) => {
  if (!canManageSupplierAccounts(req)) return forbidden(res);
  const where = isPlatformAdmin(req) ? {} : { supplierId: req.auth!.supplierId || "" };
  const rows = await prisma.user.findMany({
    where,
    include: userInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json({
    success: true,
    data: rows.map(publicUser),
    requestId: res.locals.requestId,
  });
});

const createUserBody = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
  role: z.nativeEnum(UserRole),
  supplierId: z.string().optional().nullable(),
  isSupplierManager: z.boolean().default(false),
  permissions: permissionArray.default([]),
  businessLines: businessLineArray.default([]),
  kimUserId: z.string().trim().min(1).max(200).optional().nullable(),
});

router.post("/users", requireAuth, async (req, res, next) => {
  try {
    if (!canManageSupplierAccounts(req)) return forbidden(res);
    const body = createUserBody.parse(req.body);
    const platform = isPlatformAdmin(req);
    const supplierRole = supplierRoles.has(body.role);
    if (!platform && body.role !== UserRole.SUPPLIER_RECRUITER)
      return forbidden(res, "外包公司负责人只能创建本公司的普通招聘账号");
    if (!platform && body.isSupplierManager)
      return forbidden(res, "只有平台管理员可以设置外包公司负责人");

    const supplierId = platform ? body.supplierId : req.auth!.supplierId;
    if (supplierRole && !supplierId) throw new Error("AUTH_SUPPLIER_REQUIRED");
    if (!supplierRole && supplierId) throw new Error("AUTH_SUPPLIER_INVALID");
    if ((body.role === UserRole.SUPPLIER_ADMIN) !== body.isSupplierManager)
      throw new Error("SUPPLIER_MANAGER_ROLE_INVALID");
    if (
      body.permissions.includes(FeaturePermission.SUPPLIER_ACCOUNT_MANAGE) &&
      !body.isSupplierManager
    )
      throw new Error("SUPPLIER_ACCOUNT_PERMISSION_INVALID");

    if (supplierId) {
      const supplier = await supplierAuthorization(supplierId);
      assertSubset(body.permissions, supplier.permissionCap, "PERMISSION_CAP_EXCEEDED");
      assertSubset(body.businessLines, supplier.businessLines, "BUSINESS_LINE_CAP_EXCEEDED");
    }

    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        name: body.name,
        passwordHash: hashPassword(body.password),
        role: body.role,
        supplierId,
        isSupplierManager: body.isSupplierManager,
        permissions: body.permissions,
        businessLines: body.businessLines,
        kimUserId: body.kimUserId,
      },
      include: userInclude,
    });
    await prisma.auditLog.create({
      data: {
        userId: req.auth!.id,
        action: "USER_CREATED",
        resourceType: "User",
        resourceId: user.id,
        effectiveScope: { supplierId, permissions: body.permissions, businessLines: body.businessLines },
        result: "SUCCESS",
        requestId: String(res.locals.requestId || ""),
      },
    });
    res.status(201).json({
      success: true,
      data: publicUser(user),
      requestId: res.locals.requestId,
    });
  } catch (error) {
    next(error);
  }
});

const updateUserBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  password: z.string().min(8).max(200).optional(),
  status: z.nativeEnum(RecordStatus).optional(),
  permissions: permissionArray.optional(),
  businessLines: businessLineArray.optional(),
  isSupplierManager: z.boolean().optional(),
  kimUserId: z.string().trim().min(1).max(200).optional().nullable(),
});

router.put("/users/:id", requireAuth, async (req, res, next) => {
  try {
    if (!canManageSupplierAccounts(req)) return forbidden(res);
    const body = updateUserBody.parse(req.body);
    const platform = isPlatformAdmin(req);
    const target = await prisma.user.findFirst({
      where: {
        id: String(req.params.id),
        ...(platform ? {} : { supplierId: req.auth!.supplierId || "", isSupplierManager: false }),
      },
      include: userInclude,
    });
    if (!target)
      return res.status(404).json({ success: false, code: "USER_NOT_FOUND", message: "账号不存在" });
    if (!platform && body.isSupplierManager !== undefined)
      return forbidden(res, "只有平台管理员可以设置外包公司负责人");

    if (target.supplierId) {
      const supplier = await supplierAuthorization(target.supplierId);
      assertSubset(body.permissions || target.permissions, supplier.permissionCap, "PERMISSION_CAP_EXCEEDED");
      assertSubset(body.businessLines || target.businessLines, supplier.businessLines, "BUSINESS_LINE_CAP_EXCEEDED");
    }
    const effectiveManager = body.isSupplierManager ?? target.isSupplierManager;
    const effectivePermissions = body.permissions ?? target.permissions;
    if ((target.role === UserRole.SUPPLIER_ADMIN) !== effectiveManager)
      throw new Error("SUPPLIER_MANAGER_ROLE_INVALID");
    if (
      effectivePermissions.includes(FeaturePermission.SUPPLIER_ACCOUNT_MANAGE) &&
      !effectiveManager
    )
      throw new Error("SUPPLIER_ACCOUNT_PERMISSION_INVALID");

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        name: body.name,
        status: body.status,
        passwordHash: body.password ? hashPassword(body.password) : undefined,
        permissions: body.permissions,
        businessLines: body.businessLines,
        isSupplierManager: body.isSupplierManager,
        kimUserId: body.kimUserId,
      },
      include: userInclude,
    });
    if (body.status === RecordStatus.INACTIVE || body.password)
      await prisma.authSession.deleteMany({ where: { userId: target.id } });
    await prisma.auditLog.create({
      data: {
        userId: req.auth!.id,
        action: "USER_AUTHORIZATION_UPDATED",
        resourceType: "User",
        resourceId: target.id,
        requestedScope: body,
        effectiveScope: {
          supplierId: target.supplierId,
          permissions: updated.permissions,
          businessLines: updated.businessLines,
          isSupplierManager: updated.isSupplierManager,
        },
        result: "SUCCESS",
        requestId: String(res.locals.requestId || ""),
      },
    });
    res.json({ success: true, data: publicUser(updated), requestId: res.locals.requestId });
  } catch (error) {
    next(error);
  }
});

export default router;
