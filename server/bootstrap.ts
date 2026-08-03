import { UserRole } from "@prisma/client";
import { hashPassword } from "./auth.js";
import { prisma } from "./database.js";

export async function ensureBootstrapAdmin() {
  const existing = await prisma.user.count({ where: { role: UserRole.PLATFORM_ADMIN } });
  if (existing) return;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    console.warn("尚未创建平台管理员：请设置至少 12 位的 BOOTSTRAP_ADMIN_PASSWORD");
    return;
  }
  await prisma.user.create({ data: {
    email: (process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@recruitment.local").trim().toLowerCase(),
    name: process.env.BOOTSTRAP_ADMIN_NAME || "平台管理员",
    role: UserRole.PLATFORM_ADMIN,
    passwordHash: hashPassword(password),
  }});
  console.log("已安全初始化平台管理员账号");
}
