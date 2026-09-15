import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repo = mkdtempSync(path.join(os.tmpdir(), "agent-vault-worktree-test-"));
const data = path.join(repo, ".data");
mkdirSync(data);
writeFileSync(path.join(repo, "README.md"), "Original\n", "utf8");
execFileSync("git", ["-C", repo, "init", "-q"]);
execFileSync("git", ["-C", repo, "config", "user.name", "Vault Test"]);
execFileSync("git", ["-C", repo, "config", "user.email", "vault-test@example.invalid"]);
execFileSync("git", ["-C", repo, "add", "README.md"]);
execFileSync("git", ["-C", repo, "commit", "-qm", "Initial"]);
process.env.AGENT_VAULT_WORKSPACE_ROOT = repo;
process.env.AGENT_VAULT_DATA_DIR = data;

const { attachTaskRunSession, claimTaskRun, getTaskWorktree, listFileChanges, saveVaultState } = await import("../agent/lib/vault-database.ts");
const { beginWorkspaceWorktree, runWorkspaceOperation } = await import("../agent/lib/workspace-operations.ts");
const task = { id: "code-task", title: "Edit code", description: "Edit safely", assigneeId: "writer", assigneeType: "agent", status: "queued", revision: 0 };
const agent = { id: "writer", name: "Writer", tools: ["File workspace"], permissions: ["Read workspace", "Write workspace"], allowedFolders: ["."] };
saveVaultState({ agents: [agent], people: [], rooms: [], tasks: [task], activity: [] });
const run = claimTaskRun(task.id, 0, agent.id);
attachTaskRunSession(task.id, 0, run.attempt, "wrun_worktree-test");

test("an isolated worktree receives task edits without changing the source checkout", async () => {
  const checkout = await beginWorkspaceWorktree("wrun_worktree-test", "begin-worktree");
  assert.ok(checkout.worktreeRoot.startsWith(path.join(data, "worktrees")));
  assert.equal(getTaskWorktree(task.id, 0)?.worktreeRoot, checkout.worktreeRoot);
  const before = await runWorkspaceOperation("wrun_worktree-test", "read-head", { action: "read", file: "README.md" });
  assert.equal(before.content, "Original\n");
  await runWorkspaceOperation("wrun_worktree-test", "edit-head", { action: "write", file: "README.md", content: "Isolated\n", expectedSha256: before.sha256 });
  assert.equal(readFileSync(path.join(repo, "README.md"), "utf8"), "Original\n");
  assert.equal(readFileSync(path.join(checkout.worktreeRoot, "README.md"), "utf8"), "Isolated\n");
  assert.equal(listFileChanges(task.id).filter((change) => change.status === "completed").length, 2);
  assert.equal((await beginWorkspaceWorktree("wrun_worktree-test", "second-call")).worktreeRoot, checkout.worktreeRoot);
});

test.after(() => rmSync(repo, { recursive: true, force: true }));
