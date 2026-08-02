import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
try { await prisma.$queryRaw`SELECT 1`; console.log("PostgreSQL 连接正常"); }
catch { console.error("DATABASE_UNAVAILABLE: PostgreSQL 不可连接"); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
