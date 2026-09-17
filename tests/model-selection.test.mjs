import assert from "node:assert/strict";
import test from "node:test";
import { InvalidLocalModelSelectionError, isLocalHttpUrl, parseVaultModelSelection } from "../agent/lib/model-selection.ts";

const context = (vaultModel) => [{ role: "user", content: `Client context:\n${JSON.stringify({ vaultModel })}` }];

test("an explicit local model survives context parsing, including IPv6 loopback", () => {
  assert.equal(isLocalHttpUrl("http://[::1]:11434"), true);
  assert.deepEqual(parseVaultModelSelection(context({ provider: "ollama", baseUrl: "http://[::1]:11434", model: "llama3.2:latest" })), {
    provider: "ollama", baseUrl: "http://[::1]:11434", model: "llama3.2:latest",
  });
});

test("a malformed local selection fails instead of switching to ChatGPT", () => {
  assert.throws(() => parseVaultModelSelection(context({ provider: "ollama", baseUrl: "http://example.com", model: "llama3.2:latest" })), InvalidLocalModelSelectionError);
  assert.equal(isLocalHttpUrl("http://localhost:11434/other"), false);
});
