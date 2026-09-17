import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { diagnosticErrorCode, diagnosticLog, diagnosticLogPath, formatDiagnosticEvent } from "../agent/lib/diagnostic-log.ts";

test("diagnostic events omit prompt and secret fields and stay one line", () => {
  const line = formatDiagnosticEvent("worker", "task_claimed", {
    taskId: "task-1", prompt: "private instructions", apiKey: "private-key", status: "active\ncontinued", attempts: 2,
  }, new Date("2026-09-17T09:00:00.000Z"));
  const event = JSON.parse(line);
  assert.equal(event.at, "2026-09-17T09:00:00.000Z");
  assert.equal(event.taskId, "task-1");
  assert.equal(event.status, "active continued");
  assert.equal(event.attempts, 2);
  assert.equal(event.prompt, undefined);
  assert.equal(event.apiKey, undefined);
  assert.equal(line.includes("\n"), false);
});

test("network failures are summarized without recording request payloads", () => {
  assert.equal(diagnosticErrorCode(new Error("Cannot connect to API: connect ECONNREFUSED 127.0.0.1:11434")), "ECONNREFUSED");
  assert.equal(diagnosticErrorCode({ code: "ETIMEDOUT" }), "ETIMEDOUT");
  assert.equal(diagnosticErrorCode(new Error("private prompt text")), "UNKNOWN");
});

test("diagnostics are appended under the durable data directory", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agent-vault-diagnostics-"));
  const previous = process.env.AGENT_VAULT_DATA_DIR;
  process.env.AGENT_VAULT_DATA_DIR = directory;
  try {
    diagnosticLog("worker", "started", { tasks: 2 });
    diagnosticLog("worker", "scan", { runnable: 1 });
    const lines = readFileSync(diagnosticLogPath(), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((line) => line.event), ["started", "scan"]);
    assert.equal(lines[0].tasks, 2);
    assert.equal(lines[1].runnable, 1);
  } finally {
    if (previous === undefined) delete process.env.AGENT_VAULT_DATA_DIR;
    else process.env.AGENT_VAULT_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
