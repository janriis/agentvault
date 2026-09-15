import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const directory = mkdtempSync(path.join(os.tmpdir(), "agent-vault-workspace-test-"));
const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "agent-vault-workspace-data-"));
process.env.AGENT_VAULT_WORKSPACE_ROOT = directory;
process.env.AGENT_VAULT_DATA_DIR = dataDirectory;
mkdirSync(path.join(directory, "docs"));
writeFileSync(path.join(directory, "docs", "seed.txt"), "Initial note\n", "utf8");
writeFileSync(path.join(directory, ".env.local"), "SECRET=hidden\n", "utf8");

const { attachTaskRunSession, claimTaskRun, getFileChange, getVaultState, listFileChanges, listTaskRuns, restoreVaultStateWithRuns, saveVaultState } = await import("../agent/lib/vault-database.ts");
const { cleanWorkspaceRelativePath, runWorkspaceOperation } = await import("../agent/lib/workspace-operations.ts");
const digest = (text) => createHash("sha256").update(text).digest("hex");
const task = { id: "file-task", title: "Edit documents", description: "Update docs", assigneeId: "writer", assigneeType: "agent", status: "queued", revision: 0 };
const agent = { id: "writer", name: "Writer", tools: ["File workspace"], permissions: ["Read workspace", "Write workspace"], allowedFolders: ["docs"] };
const state = (currentAgent = agent) => ({ agents: [currentAgent], people: [], rooms: [], tasks: [task], activity: [] });
saveVaultState(state());
const run = claimTaskRun(task.id, 0, agent.id);
attachTaskRunSession(task.id, 0, run.attempt, "wrun_file-test");

test("selected workspace reads and search respect agent folder scope", async () => {
  const read = await runWorkspaceOperation("wrun_file-test", "read-1", { action: "read", file: "docs/seed.txt" });
  assert.equal(read.content, "Initial note\n");
  assert.equal(read.sha256, digest("Initial note\n"));
  const search = await runWorkspaceOperation("wrun_file-test", "search-1", { action: "search", folder: ".", query: "Initial" });
  assert.deepEqual(search.hits.map((hit) => hit.file), ["docs/seed.txt"]);
  await assert.rejects(runWorkspaceOperation("wrun_file-test", "read-secret", { action: "read", file: ".env.local" }), /outside the allowed workspace/);
  await assert.rejects(runWorkspaceOperation("wrun_file-test", "read-outside", { action: "read", file: "other.txt" }), /outside the agent's allowed folders/);
});

test("symlinks and traversal cannot escape the selected workspace", async () => {
  symlinkSync(path.join(directory, ".env.local"), path.join(directory, "docs", "link.txt"));
  await assert.rejects(runWorkspaceOperation("wrun_file-test", "read-link", { action: "read", file: "docs/link.txt" }), /symlinks/);
  assert.throws(() => cleanWorkspaceRelativePath("../outside.txt"), /outside the allowed workspace/);
  assert.throws(() => cleanWorkspaceRelativePath("docs\\secret.txt"), /project-relative/);
});

test("write, patch, preview, and move are audited and replay safe", async () => {
  const write = { action: "write", file: "docs/draft.txt", content: "First draft\n", expectedSha256: null };
  const created = await runWorkspaceOperation("wrun_file-test", "write-draft", write);
  assert.equal(created.sha256, digest(write.content));
  assert.equal(statSync(path.join(directory, "docs", "draft.txt")).mode & 0o777, 0o600);
  assert.deepEqual(await runWorkspaceOperation("wrun_file-test", "write-draft", write), created);
  await assert.rejects(runWorkspaceOperation("wrun_file-test", "write-again", write), /file changed|EEXIST/);
  const preview = await runWorkspaceOperation("wrun_file-test", "preview", { action: "diff", file: "docs/draft.txt", proposedContent: "Second draft\n" });
  assert.equal(preview.changed, true);
  const patch = { action: "patch", file: "docs/draft.txt", find: "First", replace: "Second", expectedSha256: created.sha256 };
  const patched = await runWorkspaceOperation("wrun_file-test", "patch-draft", patch);
  assert.equal(readFileSync(path.join(directory, "docs", "draft.txt"), "utf8"), "Second draft\n");
  assert.equal(statSync(path.join(directory, "docs", "draft.txt")).mode & 0o777, 0o600);
  assert.deepEqual(await runWorkspaceOperation("wrun_file-test", "patch-draft", patch), patched);
  const move = { action: "move", file: "docs/draft.txt", destination: "docs/final.txt", expectedSha256: patched.sha256 };
  const moved = await runWorkspaceOperation("wrun_file-test", "move-draft", move);
  assert.equal(readFileSync(path.join(directory, "docs", "final.txt"), "utf8"), "Second draft\n");
  assert.deepEqual(await runWorkspaceOperation("wrun_file-test", "move-draft", move), moved);
  const changes = listFileChanges(task.id);
  assert.equal(changes.filter((change) => change.status === "completed").length, 3);
  assert.equal(getFileChange("wrun_file-test:patch-draft")?.agentId, "writer");
});

test("a saved permission change immediately revokes host writes", async () => {
  saveVaultState(state({ ...agent, permissions: ["Read workspace"] }));
  await assert.rejects(runWorkspaceOperation("wrun_file-test", "write-denied", { action: "write", file: "docs/denied.txt", content: "No", expectedSha256: null }), /lacks write workspace permission/);
  saveVaultState(state(agent));
});

test("unassigned sessions cannot use host files", async () => {
  await assert.rejects(runWorkspaceOperation("wrun_other", "read-unauthorized", { action: "read", file: "docs/seed.txt" }), /active, assigned EVE task session/);
});

test("test runs use only allowlisted package scripts and are task audited", async () => {
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ scripts: { typecheck: "node -e \"process.stdout.write('checked')\"" } }), "utf8");
  saveVaultState(state({ ...agent, allowedFolders: ["."] }));
  const result = await runWorkspaceOperation("wrun_file-test", "typecheck-test", { action: "test", script: "typecheck" });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /checked/);
  assert.equal(getFileChange("wrun_file-test:typecheck-test")?.action, "test");
  await assert.rejects(runWorkspaceOperation("wrun_file-test", "bad-test", { action: "test", script: "install" }), /allowlisted/);
  saveVaultState(state(agent));
});

test("file audit restore is atomic and retains every change", async () => {
  const fileChanges = listFileChanges(task.id);
  const before = getVaultState();
  const runs = listTaskRuns();
  assert.throws(() => restoreVaultStateWithRuns(before.state, runs, [fileChanges[0], fileChanges[0]]), /UNIQUE/);
  assert.equal(getVaultState().revision, before.revision);
  restoreVaultStateWithRuns(before.state, runs, fileChanges);
  assert.equal(listFileChanges(task.id).length, fileChanges.length);
});

test.after(() => {
  rmSync(directory, { recursive: true, force: true });
  rmSync(dataDirectory, { recursive: true, force: true });
});
