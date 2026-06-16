import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDeepSeekModelAllowed,
  DEEPSEEK_V4_FLASH_MODEL,
  DEEPSEEK_V4_PRO_MODEL,
  LLMModelPolicyError,
  resolveDeepSeekDefaultModel,
} from "../core/agents/llm/index.ts";

test("DeepSeek model policy: V4 Flash is the default model", () => {
  assert.equal(resolveDeepSeekDefaultModel(undefined), DEEPSEEK_V4_FLASH_MODEL);
  assert.equal(resolveDeepSeekDefaultModel(""), DEEPSEEK_V4_FLASH_MODEL);
  assert.equal(resolveDeepSeekDefaultModel("   "), DEEPSEEK_V4_FLASH_MODEL);
});

test("DeepSeek model policy: V4 Pro requires explicit escalation", () => {
  assert.doesNotThrow(() => assertDeepSeekModelAllowed(DEEPSEEK_V4_FLASH_MODEL));
  assert.throws(
    () => assertDeepSeekModelAllowed(DEEPSEEK_V4_PRO_MODEL),
    (err) =>
      err instanceof LLMModelPolicyError &&
      err.model === DEEPSEEK_V4_PRO_MODEL,
  );
  assert.doesNotThrow(() =>
    assertDeepSeekModelAllowed(DEEPSEEK_V4_PRO_MODEL, {
      reason: "hard_multi_document_synthesis",
    }),
  );
});
