import test from "node:test";
import assert from "node:assert/strict";
import { FeaturePermission } from "@prisma/client";
import { hashPassword, verifyPassword, supplierIdFor, supplierNameFor, hasPermission } from "./auth.js";

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

test("外包公司账号只能使用被单独勾选的功能权限", () => {
  const request = {
    auth: {
      ...supplierRequest.auth,
      permissions: [FeaturePermission.CANDIDATE_VIEW],
      businessLines: [],
      isSupplierManager: false,
      simulation: null,
    },
  } as any;
  assert.equal(hasPermission(request, FeaturePermission.CANDIDATE_VIEW), true);
  assert.equal(hasPermission(request, FeaturePermission.DATA_EXPORT), false);
  assert.equal(hasPermission(request, FeaturePermission.CANDIDATE_CONTACT_VIEW), false);
});

test("除平台管理员外的内部账号也严格使用单独勾选的功能权限", () => {
  const request = {
    auth: {
      ...internalRequest.auth,
      permissions: [FeaturePermission.INTERVIEW_VIEW],
      businessLines: [],
      isSupplierManager: false,
      simulation: null,
    },
  } as any;
  assert.equal(hasPermission(request, FeaturePermission.INTERVIEW_VIEW), true);
  assert.equal(hasPermission(request, FeaturePermission.DATA_EXPORT), false);
});

test("管理员模拟公司视角时使用公司权限上限而非管理员全权", () => {
  const request = {
    auth: {
      ...internalRequest.auth,
      role: "PLATFORM_ADMIN",
      permissions: Object.values(FeaturePermission),
      businessLines: [],
      isSupplierManager: false,
      simulation: {
        supplierId: "supplier-renrui",
        supplierName: "人瑞",
        permissions: [FeaturePermission.CANDIDATE_VIEW],
        businessLines: [],
      },
    },
  } as any;
  assert.equal(hasPermission(request, FeaturePermission.CANDIDATE_VIEW), true);
  assert.equal(hasPermission(request, FeaturePermission.DATA_EXPORT), false);
});
