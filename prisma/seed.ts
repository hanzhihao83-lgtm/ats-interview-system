import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const suppliers = ["人瑞", "供应商B", "供应商C", "供应商D"];
const positions = [
  "AI 数据标注员",
  "AI 数据质检员",
  "视频评测工程师",
  "Caption 标注员",
  "项目助理",
];
async function main() {
  for (const [index, name] of suppliers.entries())
    await prisma.supplier.upsert({
      where: { code: `SUP-${index + 1}` },
      update: { name },
      create: { code: `SUP-${index + 1}`, name },
    });
  for (const name of positions) {
    const found = await prisma.jobPosition.findFirst({ where: { name } });
    if (!found) await prisma.jobPosition.create({ data: { name } });
  }
}
main().finally(() => prisma.$disconnect());
