import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置，请复制 .env.example 为 .env");
export const prisma = new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

export async function assertDatabaseConnection() {
  try { await prisma.$queryRaw`SELECT 1`; }
  catch { throw new Error("DATABASE_UNAVAILABLE"); }
}
