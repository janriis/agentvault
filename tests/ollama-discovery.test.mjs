import assert from "node:assert/strict";
import test from "node:test";
import { discoverOllamaModels, normalizeOllamaHost } from "../agent/lib/ollama-discovery.ts";

test("checks an unsaved local address and returns installed model names", async () => {
  const calls = [];
  const result = await discoverOllamaModels("localhost:11434", async (url, options) => {
    calls.push({ url, options });
    return Response.json({ models: [
      { name: "llama3.2:latest", details: { family: "llama", parameter_size: "3.2B" } },
      { model: "qwen:latest" },
    ] });
  });

  assert.equal(calls[0].url, "http://localhost:11434/api/tags");
  assert.equal(calls[0].options.cache, "no-store");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.models.map((model) => model.id), ["llama3.2:latest", "qwen:latest"]);
  assert.equal(result.models[0].details, "llama · 3.2B");
});

test("rejects non-local or malformed addresses before any network request", async () => {
  for (const host of ["https://example.com", "http://192.168.1.3:11434", "http://localhost:11434/other", "http://localhost:11434/?token=x", "http://user:pass@localhost:11434"]) {
    assert.equal(normalizeOllamaHost(host), null);
    const result = await discoverOllamaModels(host, () => { throw new Error("Should not fetch"); });
    assert.equal(result.models.length, 0);
    assert.match(result.errors[0], /valid loopback Ollama address/);
  }
  assert.equal(normalizeOllamaHost("http://[::1]:11434"), "http://[::1]:11434");
});

test("distinguishes an online Ollama with no models from an unreachable one", async () => {
  const empty = await discoverOllamaModels("http://127.0.0.1:11434", async () => Response.json({ models: [] }));
  assert.equal(empty.providers[0].modelCount, 0);
  assert.deepEqual(empty.errors, []);

  const offline = await discoverOllamaModels("http://127.0.0.1:11434", async () => { throw new Error("ECONNREFUSED"); });
  assert.equal(offline.models.length, 0);
  assert.match(offline.errors[0], /Could not reach Ollama/);
});
