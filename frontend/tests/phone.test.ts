import test from "node:test";
import assert from "node:assert/strict";

import { formatPhoneMasked, hasFilledPhone } from "../src/utils/phone.ts";

test("hasFilledPhone treats empty mask as missing phone", () => {
  assert.equal(hasFilledPhone(""), false);
  assert.equal(hasFilledPhone("—"), false);
  assert.equal(hasFilledPhone("手机号格式无效"), false);
});

test("hasFilledPhone accepts masked phone numbers", () => {
  assert.equal(hasFilledPhone("138****0000"), true);
});

test("formatPhoneMasked shows fallback label for missing phone", () => {
  assert.equal(formatPhoneMasked("—"), "未填写手机号");
  assert.equal(formatPhoneMasked("138****0000"), "138****0000");
});
