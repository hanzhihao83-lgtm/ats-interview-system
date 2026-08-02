import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { DuplicateLevel, ValidationStatus } from "@prisma/client";
import {
  classifyDuplicate,
  normalizeRow,
  parseDate,
  validateRow,
} from "./recruitmentRouter.js";

test("中文表头值的全角、空格、邮箱、手机号和状态别名会统一清洗", () => {
  const row = normalizeRow({
    name: " 张　三 ",
    phone: "+86 138-0013-8000",
    email: " TEST@EXAMPLE.COM ",
    supplier: " 人瑞 ",
    position: " ＡＩ 数据标注员 ",
    currentStatus: "待约面",
  });
  assert.equal(row.normalizedName, "张三");
  assert.equal(row.phoneNormalized, "13800138000");
  assert.equal(row.emailNormalized, "test@example.com");
  assert.equal(row.currentStatus, "待安排面试");
});
test("Excel 日期序列与四种中文日期格式可转换", () => {
  assert.equal(parseDate(46235), "2026-08-01");
  assert.equal(parseDate("2026/08/01"), "2026-08-01");
  assert.equal(parseDate("2026.08.01"), "2026-08-01");
  assert.equal(parseDate("2026年8月1日"), "2026-08-01");
});
test("空姓名为 INVALID", () => {
  const result = validateRow(
    normalizeRow({ supplier: "人瑞", position: "项目助理" }),
  );
  assert.equal(result.status, ValidationStatus.INVALID);
  assert.ok(result.errors.includes("姓名不能为空"));
});
test("未知状态不能导入", () => {
  const result = validateRow(
    normalizeRow({
      name: "张三",
      supplier: "人瑞",
      position: "项目助理",
      currentStatus: "神秘状态",
    }),
  );
  assert.equal(result.status, ValidationStatus.INVALID);
  assert.match(result.errors.join(""), /无法识别状态/);
});
test("项目中但无实际入职日期产生 WARNING", () => {
  const result = validateRow(
    normalizeRow({
      name: "张三",
      supplier: "人瑞",
      position: "项目助理",
      currentStatus: "项目中",
    }),
  );
  assert.equal(result.status, ValidationStatus.WARNING);
});
test("同名同手机号为确定重复", () => {
  const row = normalizeRow({ name: "张三", phone: "13800138000" });
  const result = classifyDuplicate(row, [
    { id: "c1", phoneNormalized: "13800138000" },
  ]);
  assert.equal(result.level, DuplicateLevel.EXACT);
});
test("同名不同大学识别为同名不同人", () => {
  const row = normalizeRow({
    name: "张三",
    university: "北京大学",
    phone: "13800138000",
  });
  const result = classifyDuplicate(row, [
    {
      id: "c1",
      normalizedUniversity: "清华大学",
      phoneNormalized: "13900139000",
    },
  ]);
  assert.equal(result.level, DuplicateLevel.SAME_NAME_DIFFERENT_PERSON);
});
test("当前 Excel 批次内同名同邮箱可识别", () => {
  const row = normalizeRow({ name: "张三", email: "a@example.com" });
  const result = classifyDuplicate(
    row,
    [],
    [normalizeRow({ name: "张三", email: "a@example.com" })],
  );
  assert.equal(result.level, DuplicateLevel.EXACT);
});
