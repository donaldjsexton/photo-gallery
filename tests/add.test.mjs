import { test } from "node:test";
import assert from "node:assert/strict";
import { add } from "../src/add.mjs";

test("adds numbers", () => {
  assert.equal(add(2, 3), 5);
});
