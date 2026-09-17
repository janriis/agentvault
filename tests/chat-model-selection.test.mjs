import assert from "node:assert/strict";
import test from "node:test";
import { CHATGPT_MODEL_ID, resolveChatModelSelection } from "../agent/lib/chat-model-selection.ts";

const installed = [{ id: "llama3.2:latest", baseUrl: "http://127.0.0.1:11434" }];

test("a local choice resolves to Ollama instead of ChatGPT", () => {
  assert.deepEqual(resolveChatModelSelection("llama3.2:latest", installed), {
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    model: "llama3.2:latest",
  });
});

test("an unavailable saved local choice never silently falls back to ChatGPT", () => {
  assert.equal(resolveChatModelSelection("llama3.2:latest", []), undefined);
  assert.deepEqual(resolveChatModelSelection(CHATGPT_MODEL_ID, []), { provider: "chatgpt" });
});
