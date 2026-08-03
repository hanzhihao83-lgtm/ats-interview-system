import { randomBytes } from "node:crypto";
import { prisma } from "../server/database.js";
import { hashPassword } from "../server/auth.js";

const email = "admin@recruitment.local";
const admin = await prisma.user.findUnique({ where: { email } });
if (!admin) throw new Error("SMOKE_ADMIN_NOT_FOUND");
const originalHash = admin.passwordHash;
const password = `Smoke-${randomBytes(18).toString("base64url")}`;

try {
  await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: hashPassword(password) } });
  await import("../server/index.js");
  await new Promise((resolve) => setTimeout(resolve, 800));
  const login = await fetch("http://127.0.0.1:3001/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const loginBody = await login.json() as any;
  const headers = { Authorization: `Bearer ${loginBody.data?.token || ""}` };
  const get = async (path: string) => {
    const response = await fetch(`http://127.0.0.1:3001${path}`, { headers });
    const body = await response.json() as any;
    return { status: response.status, success: body.success, data: body.data };
  };
  const [combined, video, audio, videoApplications, audioApplications] = await Promise.all([
    get("/api/dashboard/overview"), get("/api/dashboard/overview?businessLine=VIDEO"), get("/api/dashboard/overview?businessLine=AUDIO"), get("/api/applications?businessLine=VIDEO&pageSize=5"), get("/api/applications?businessLine=AUDIO&pageSize=5"),
  ]);
  console.log(JSON.stringify({ login: login.status === 200, combined: combined.success, video: video.success, audio: audio.success, videoRows: videoApplications.data?.rows?.every((row: any) => row.businessLine === "VIDEO"), audioRows: audioApplications.data?.rows?.every((row: any) => row.businessLine === "AUDIO") }));
} finally {
  await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: originalHash } }).catch(() => undefined);
  await prisma.authSession.deleteMany({ where: { userId: admin.id } }).catch(() => undefined);
  await prisma.$disconnect();
  process.exit(0);
}
