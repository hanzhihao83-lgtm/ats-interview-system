import { BusinessLine, FeaturePermission, UserRole } from "@prisma/client";
import { hashPassword } from "./auth.js";
import { prisma } from "./database.js";

export async function ensureBootstrapAdmin() {
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const resetPassword = process.env.RESET_BOOTSTRAP_ADMIN_PASSWORD === "true";
  const existing = await prisma.user.findFirst({
    where: { role: UserRole.PLATFORM_ADMIN },
    orderBy: { createdAt: "asc" },
  });
  if (existing && !resetPassword) return;
  if (!password || password.length < 12) {
    console.warn(
      existing
        ? "未重置平台管理员密码：请设置至少 12 位的 BOOTSTRAP_ADMIN_PASSWORD"
        : "尚未创建平台管理员：请设置至少 12 位的 BOOTSTRAP_ADMIN_PASSWORD",
    );
    return;
  }
  if (existing) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash: hashPassword(password),
          status: "ACTIVE",
          permissions: Object.values(FeaturePermission),
          businessLines: [BusinessLine.VIDEO, BusinessLine.AUDIO],
        },
      }),
      prisma.authSession.deleteMany({ where: { userId: existing.id } }),
    ]);
    console.log("已按一次性开关重置平台管理员密码");
    return;
  }
  await prisma.user.create({ data: {
    email: (process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@recruitment.local").trim().toLowerCase(),
    name: process.env.BOOTSTRAP_ADMIN_NAME || "平台管理员",
    role: UserRole.PLATFORM_ADMIN,
    passwordHash: hashPassword(password),
    permissions: Object.values(FeaturePermission),
    businessLines: [BusinessLine.VIDEO, BusinessLine.AUDIO],
  }});
  console.log("已安全初始化平台管理员账号");
}
