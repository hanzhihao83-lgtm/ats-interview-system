import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, supplierIdFor, supplierNameFor } from "./auth.js";

const supplierRequest = { auth: { id: "u1", email: "renrui@test", name: "人瑞招聘", role: "SUPPLIER_RECRUITER", supplierId: "supplier-renrui", supplierName: "人瑞" } } as any;
const internalRequest = { auth: { id: "u2", email: "internal@test", name: "内部招聘", role: "INTERNAL_RECRUITER", supplierId: null, supplierName: null } } as any;

test("密码使用随机盐哈希且可验证", () => {
  const first = hashPassword("StrongPass123!"); const second = hashPassword("StrongPass123!");
  assert.notEqual(first, second); assert.equal(verifyPassword("StrongPass123!", first), true); assert.equal(verifyPassword("wrong-pass", first), false);
});

test("供应商账号无法通过 supplierId 参数切换租户", () => {
  assert.equal(supplierIdFor(supplierRequest, "supplier-deke"), "supplier-renrui");
  assert.equal(supplierNameFor(supplierRequest, "德科"), "人瑞");
});

test("内部招聘账号可以按供应商筛选", () => {
  assert.equal(supplierIdFor(internalRequest, "supplier-deke"), "supplier-deke");
  assert.equal(supplierNameFor(internalRequest, "德科"), "德科");
});
