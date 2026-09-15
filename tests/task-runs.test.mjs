import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "agent-vault-task-test-"));
process.env.AGENT_VAULT_DATA_DIR = dataDirectory;
const { TaskClaimError, attachTaskRunSession, cancelTaskRun, claimTaskRun, executeTaskBoardCommand, finishTaskRun, getVaultSettings, getVaultState, heartbeatTaskRun, listTaskRuns, replaceTaskRuns, restoreVaultStateWithRuns, saveVaultState } = await import("../agent/lib/vault-database.ts");
const { classifyTaskSessionEvents, findRunnableJobs, runWorkerJob, taskSessionExpired } = await import("../agent/lib/task-orchestration.ts");

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

test("a stale browser save cannot replace a completed agent run", () => {
  saveVaultState(state([task("projection-task")]));
  const run = claimTaskRun("projection-task", 0, "researcher");
  finishTaskRun("projection-task", 0, run.attempt, { status: "completed", result: "Verified result" });
  const staleSave = saveVaultState(state([task("projection-task", "queued")]));
  assert.equal(staleSave.state.tasks[0].status, "completed");
  assert.equal(getVaultState().state.tasks[0].result, "Verified result");
});

test("task-run ledger can be restored before vault-state projection", () => {
  const snapshot = listTaskRuns();
  assert.ok(snapshot.length > 0);
  replaceTaskRuns([]);
  assert.equal(listTaskRuns().length, 0);
  replaceTaskRuns(snapshot);
  assert.deepEqual(listTaskRuns(), snapshot);
  assert.equal(getVaultState().state.tasks[0].status, "completed");
});

test("invalid restore leaves both vault state and run ledger unchanged", () => {
  const before = getVaultState();
  const runs = listTaskRuns();
  assert.throws(() => restoreVaultStateWithRuns(state([task("bad", "queued", ["missing"])]), []), /does not exist/);
  assert.throws(() => restoreVaultStateWithRuns(state([task("projection-task")]), [runs[0], runs[0]]), /UNIQUE/);
  assert.equal(getVaultState().revision, before.revision);
  assert.deepEqual(listTaskRuns(), runs);
});

test("task commands are atomic, revision checked, and idempotent", () => {
  const newTask = { ...task("command-task"), acceptanceCriteria: "A verified report", priority: "medium", updated: "Just now" };
  const command = { action: "create", task: newTask };
  const first = executeTaskBoardCommand("command-create-0001", command);
  assert.equal(first.replayed, false);
  const again = executeTaskBoardCommand("command-create-0001", command);
  assert.equal(again.replayed, true);
  assert.equal(again.record.revision, first.record.revision);
  assert.equal(getVaultState().state.tasks.filter((item) => item.id === newTask.id).length, 1);
  assert.throws(() => executeTaskBoardCommand("command-create-0001", { ...command, task: { ...newTask, title: "Different" } }), /already used/);
  const move = executeTaskBoardCommand("command-move-0001", { action: "move", taskId: newTask.id, target: "blocked", expectedTaskRevision: 0 });
  assert.equal(move.task.status, "blocked");
  assert.throws(() => executeTaskBoardCommand("command-move-0002", { action: "move", taskId: newTask.id, target: "queued", expectedTaskRevision: 99 }), /changed in another session/);
  const retry = executeTaskBoardCommand("command-retry-0001", { action: "retry", taskId: newTask.id, expectedTaskRevision: 0 });
  assert.equal(retry.task.status, "queued");
  assert.equal(retry.task.revision, 1);
});

test("a known EVE session is inspected immediately after worker restart", () => {
  const agent = { id: "researcher", name: "Researcher", role: "researcher", description: "Research", model: "ChatGPT subscription" };
  saveVaultState({ ...state([task("recover-task")]), agents: [agent] });
  const run = claimTaskRun("recover-task", 0, "researcher");
  attachTaskRunSession("recover-task", 0, run.attempt, "wrun_recover-test");
  const jobs = findRunnableJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].previousRun?.eveSessionId, "wrun_recover-test");
  assert.equal(heartbeatTaskRun("recover-task", 0, run.attempt), true);
  assert.throws(() => claimTaskRun("recover-task", 0, "researcher"), TaskClaimError);
});

test("resumed EVE sessions distinguish pending, completed, and failed turns", () => {
  assert.deepEqual(classifyTaskSessionEvents([{ type: "turn.started" }]), { status: "pending" });
  assert.deepEqual(classifyTaskSessionEvents([{ type: "message.completed", data: { message: "Done" } }, { type: "turn.completed" }]), { status: "completed", result: "Done" });
  assert.equal(classifyTaskSessionEvents([{ type: "turn.completed" }]).status, "failed");
  assert.equal(classifyTaskSessionEvents([{ type: "turn.cancelled" }]).status, "failed");
});

test("a resumed pending session expires at the configured task timeout", () => {
  const startedAt = "2026-09-15T00:00:00.000Z";
  const run = { taskId: "timeout", taskRevision: 0, agentId: "researcher", status: "active", attempt: 1, startedAt, updatedAt: startedAt };
  assert.equal(taskSessionExpired(run, 30, Date.parse(startedAt) + 29 * 60_000), false);
  assert.equal(taskSessionExpired(run, 30, Date.parse(startedAt) + 30 * 60_000), true);
});

test("vault restore invalidates old task command keys", () => {
  saveVaultState(state([{ ...task("restore-task"), revision: 1 }]));
  const before = getVaultState();
  const command = { action: "move", taskId: "restore-task", target: "blocked", expectedTaskRevision: 1 };
  const first = executeTaskBoardCommand("restore-move-0001", command);
  assert.equal(first.replayed, false);
  restoreVaultStateWithRuns(before.state, listTaskRuns());
  const after = executeTaskBoardCommand("restore-move-0001", command);
  assert.equal(after.replayed, false);
  assert.equal(after.task.status, "blocked");
});


test.after(() => rmSync(dataDirectory, { recursive: true, force: true }));
