import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "agent-vault-task-test-"));
process.env.AGENT_VAULT_DATA_DIR = dataDirectory;
const { TaskClaimError, cancelTaskRun, claimTaskRun, finishTaskRun, saveVaultState } = await import("../agent/lib/vault-database.ts");

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

test.after(() => rmSync(dataDirectory, { recursive: true, force: true }));
