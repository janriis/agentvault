import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("an idle worker records startup and scan without starting an agent", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agent-vault-idle-worker-"));
  const worker = spawn(process.execPath, ["scripts/task-worker.mjs", "--host", "http://127.0.0.1:59999"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, AGENT_VAULT_DATA_DIR: directory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise((resolve) => worker.once("exit", resolve));
  let output = "";
  worker.stdout.on("data", (chunk) => { output += String(chunk); });
  worker.stderr.on("data", (chunk) => { output += String(chunk); });
  try {
    const deadline = Date.now() + 5000;
    while (!output.includes(" scan runnable=0") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.match(output, /\[vault:worker .*\] started /u);
    assert.match(output, /\[vault:worker .*\] scan runnable=0/u);
    assert.equal(output.includes("task_claimed"), false);
    const name = `activity-${new Date().toISOString().slice(0, 10)}.jsonl`;
    const events = readFileSync(path.join(directory, "logs", name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.event).slice(0, 2), ["started", "scan"]);
  } finally {
    worker.kill("SIGTERM");
    await exited;
    rmSync(directory, { recursive: true, force: true });
  }
});
