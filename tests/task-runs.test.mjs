import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "agent-vault-task-test-"));
process.env.AGENT_VAULT_DATA_DIR = dataDirectory;
const { TaskClaimError, attachTaskRunSession, cancelTaskRun, claimTaskRun, finishTaskRun, getVaultSettings, heartbeatTaskRun, listTaskRuns, saveVaultState } = await import("../agent/lib/vault-database.ts");
const { findRunnableJobs, runWorkerJob } = await import("../agent/lib/task-orchestration.ts");

const state = (tasks) => ({ agents: [], people: [], rooms: [], tasks, activity: [] });
const task = (id, status = "queued", dependsOn = []) => ({ id, title: id, description: id, assigneeId: "researcher", assigneeType: "agent", status, revision: 0, dependsOn });

test("claims wait for saved prerequisites and reject wrong assignments", () => {
  saveVaultState(state([task("research", "queued"), task("write", "queued", ["research"])]));
  assert.throws(() => claimTaskRun("write", 0, "researcher"), TaskClaimError);
  assert.throws(() => claimTaskRun("research", 0, "writer"), TaskClaimError);
  const claimed = claimTaskRun("research", 0, "researcher");
  assert.equal(claimed.attempt, 1);
  assert.throws(() => claimTaskRun("research", 0, "researcher"), TaskClaimError);
  assert.equal(finishTaskRun("research", 0, 1, { status: "completed", result: "done" })?.status, "completed");
  saveVaultState(state([task("research", "completed"), task("write", "queued", ["research"])]));
  assert.equal(claimTaskRun("write", 0, "researcher").status, "active");
});

test("cancelled and superseded attempts cannot complete", () => {
  assert.equal(cancelTaskRun("write", 0)?.status, "cancelled");
  assert.equal(finishTaskRun("write", 0, 1, { status: "completed", result: "late" }), undefined);
  saveVaultState(state([task("research", "completed"), { ...task("write", "queued", ["research"]), revision: 1 }]));
  const claimed = claimTaskRun("write", 1, "researcher");
  assert.equal(claimed.attempt, 1);
  assert.equal(finishTaskRun("write", 0, 1, { status: "completed", result: "old revision" }), undefined);
  assert.equal(finishTaskRun("write", 1, 2, { status: "completed", result: "wrong attempt" }), undefined);
  assert.equal(finishTaskRun("write", 1, 1, { status: "completed", result: "new result" })?.result, "new result");
});

test("headless worker discovers eligible jobs and fences completion", async () => {
  const agent = { id: "researcher", name: "Researcher", role: "researcher", description: "Research", model: "ChatGPT subscription" };
  saveVaultState({ ...state([task("source"), task("draft", "queued", ["source"])]), agents: [agent] });
  assert.deepEqual(findRunnableJobs().map((job) => job.task.id), ["source"]);
  const source = findRunnableJobs()[0];
  assert.equal((await runWorkerJob(source, async () => "sources found"))?.status, "completed");
  assert.deepEqual(findRunnableJobs().map((job) => job.task.id), ["draft"], "ledger completion unlocks dependencies without a browser projection");
  const draft = findRunnableJobs()[0];
  assert.equal((await runWorkerJob(draft, async () => { throw new Error("provider unavailable"); }))?.status, "failed");
  assert.equal(listTaskRuns().find((run) => run.taskId === "draft")?.error, "provider unavailable");
  assert.equal(findRunnableJobs().length, 0, "a failed attempt should back off before retrying");
  assert.equal(getVaultSettings().maxTaskAttempts, 3);
});

test("EVE session identity and heartbeat are attempt-fenced", () => {
  saveVaultState(state([task("session-task")]));
  const run = claimTaskRun("session-task", 0, "researcher");
  assert.equal(attachTaskRunSession("session-task", 0, run.attempt, "wrun_session-test")?.eveSessionId, "wrun_session-test");
  assert.equal(heartbeatTaskRun("session-task", 0, run.attempt), true);
  assert.equal(cancelTaskRun("session-task", 0)?.status, "cancelled");
  assert.equal(heartbeatTaskRun("session-task", 0, run.attempt), false);
  assert.equal(attachTaskRunSession("session-task", 0, run.attempt, "wrun_late-session"), undefined);
});

test.after(() => rmSync(dataDirectory, { recursive: true, force: true }));
