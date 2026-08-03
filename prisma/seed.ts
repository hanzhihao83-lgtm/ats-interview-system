import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
const prisma = new PrismaClient();
const suppliers = ["人瑞", "德科", "供应商B", "供应商C", "供应商D"];
const positions = [
  "AI 数据标注员",
  "AI 数据质检员",
  "视频评测工程师",
  "Caption 标注员",
  "项目助理",
];
async function main() {
  const supplierRecords = new Map<string, string>();
  for (const [index, name] of suppliers.entries())
    supplierRecords.set(name, (await prisma.supplier.upsert({
      where: { code: `SUP-${index + 1}` },
      update: { name },
      create: { code: `SUP-${index + 1}`, name },
    })).id);
  for (const name of positions) {
    const found = await prisma.jobPosition.findFirst({ where: { name } });
    if (!found) await prisma.jobPosition.create({ data: { name } });
  }
  const hash = (password: string) => {
    const salt = randomBytes(16).toString("hex");
    return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
  };
  const accounts = [
    { email: "admin@recruitment.local", name: "平台管理员", role: "PLATFORM_ADMIN" as const, password: process.env.SEED_ADMIN_PASSWORD || "Admin123!", supplierId: null },
    { email: "internal@recruitment.local", name: "内部招聘人员", role: "INTERNAL_RECRUITER" as const, password: process.env.SEED_INTERNAL_PASSWORD || "Recruiter123!", supplierId: null },
    { email: "renrui@recruitment.local", name: "人瑞供应商管理员", role: "SUPPLIER_ADMIN" as const, password: process.env.SEED_RENRUI_PASSWORD || "Supplier123!", supplierId: supplierRecords.get("人瑞")! },
    { email: "deke@recruitment.local", name: "德科供应商招聘员", role: "SUPPLIER_RECRUITER" as const, password: process.env.SEED_DEKE_PASSWORD || "Supplier123!", supplierId: supplierRecords.get("德科")! },
  ];
  for (const account of accounts) {
    const existing = await prisma.user.findUnique({ where: { email: account.email } });
    await prisma.user.upsert({
      where: { email: account.email },
      update: { name: account.name, role: account.role, supplierId: account.supplierId },
      create: { email: account.email, name: account.name, role: account.role, supplierId: account.supplierId, passwordHash: hash(account.password) },
    });
    if (!existing) console.log(`已创建演示账号：${account.email}`);
  }
}
main().finally(() => prisma.$disconnect());
