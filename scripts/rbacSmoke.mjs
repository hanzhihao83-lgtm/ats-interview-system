import { PrismaClient } from "@prisma/client";

const base = process.env.RBAC_TEST_BASE_URL || "http://localhost:3101";
const prisma = new PrismaClient();
const credentials = {
  admin: ["admin@recruitment.local", process.env.SEED_ADMIN_PASSWORD || "Admin123!"],
  renrui: ["renrui@recruitment.local", process.env.SEED_RENRUI_PASSWORD || "Supplier123!"],
  deke: ["deke@recruitment.local", process.env.SEED_DEKE_PASSWORD || "Supplier123!"],
};
const login = async ([email, password]) => {
  const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!response.ok) throw new Error(`LOGIN_FAILED:${email}:${response.status}`);
  return (await response.json()).data.token;
};
const call = (token, url, init = {}) => fetch(`${base}${url}`, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${token}` } });

const [admin, renrui, deke] = await Promise.all(Object.values(credentials).map(login));
const createCandidate = async (token, name, spoofedSupplier) => {
  const response = await call(token, "/api/candidates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, supplierName: spoofedSupplier, positionName: "权限隔离测试岗位", operator: "RBAC测试" }) });
  if (!response.ok) throw new Error(`CREATE_FAILED:${response.status}:${await response.text()}`);
  return (await response.json()).data;
};

let renruiCandidate;
let dekeCandidate;
let datasetId;
try {
  renruiCandidate = await createCandidate(renrui, "RBAC人瑞测试", "德科");
  dekeCandidate = await createCandidate(deke, "RBAC德科测试", "人瑞");
  const renruiList = await (await call(renrui, "/api/candidates?supplier=德科&pageSize=100")).json();
  const crossCandidate = await call(deke, `/api/candidates/${renruiCandidate.id}`);
  const form = new FormData();
  form.append("file", new Blob(["姓名,供应商,是否通过\nRBAC看板候选人,德科,通过"], { type: "text/csv" }), "rbac-isolation.csv");
  const uploadResponse = await call(renrui, "/api/auto-dashboard/upload", { method: "POST", body: form });
  if (!uploadResponse.ok) throw new Error(`UPLOAD_FAILED:${uploadResponse.status}:${await uploadResponse.text()}`);
  const uploaded = (await uploadResponse.json()).data; datasetId = uploaded.datasetId;
  const crossDashboard = await call(deke, `/api/auto-dashboard/${uploaded.dashboardId}`);
  const adminDashboard = await call(admin, `/api/auto-dashboard/${uploaded.dashboardId}`);
  const checks = {
    login: true,
    forcedSupplier: renruiCandidate.supplier.name === "人瑞" && dekeCandidate.supplier.name === "德科",
    spoofedFilterBlocked: renruiList.data.rows.every((row) => row.supplier.name === "人瑞"),
    crossCandidateBlocked: crossCandidate.status === 404,
    crossDashboardBlocked: crossDashboard.status === 404,
    adminCanReadDashboard: adminDashboard.status === 200,
  };
  console.log(JSON.stringify(checks));
  if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
} finally {
  if (renruiCandidate) await call(renrui, `/api/candidates/${renruiCandidate.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" });
  if (dekeCandidate) await call(deke, `/api/candidates/${dekeCandidate.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" });
  if (datasetId) await prisma.importedDataset.delete({ where: { id: datasetId } }).catch(() => undefined);
  await prisma.authSession.deleteMany({ where: { user: { email: { in: Object.values(credentials).map(([email]) => email) } } } });
  await prisma.$disconnect();
}
