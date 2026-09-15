import assert from "node:assert/strict";
import test from "node:test";
import { applyTaskBoardCommand, TaskCommandValidationError } from "../agent/lib/task-commands.ts";

const agentTask = { id: "agent-task", title: "Research", description: "Find evidence", acceptanceCriteria: "Cite two sources", assigneeId: "researcher", assigneeType: "agent", status: "queued", priority: "medium", revision: 0, updated: "Just now" };
const personTask = { ...agentTask, id: "person-task", assigneeId: "person", assigneeType: "person" };

test("agent cards cannot be completed without a durable completed run", () => {
  assert.throws(() => applyTaskBoardCommand([agentTask], [], { action: "move", taskId: agentTask.id, target: "completed", expectedTaskRevision: 0 }), TaskCommandValidationError);
  const accepted = applyTaskBoardCommand([agentTask], [{ taskId: agentTask.id, taskRevision: 0, agentId: "researcher", status: "completed", attempt: 1, startedAt: "now", updatedAt: "now", result: "Sources" }], { action: "move", taskId: agentTask.id, target: "completed", expectedTaskRevision: 0 });
  assert.equal(accepted.task.status, "completed");
});

test("agent moves restart stopped work while human cards move directly", () => {
  const run = { taskId: agentTask.id, taskRevision: 0, agentId: "researcher", status: "blocked", attempt: 3, startedAt: "now", updatedAt: "now" };
  const restarted = applyTaskBoardCommand([{ ...agentTask, status: "blocked" }], [run], { action: "move", taskId: agentTask.id, target: "active", expectedTaskRevision: 0 });
  assert.equal(restarted.task.status, "queued", "the worker owns the active transition");
  assert.equal(restarted.task.revision, 1);
  assert.equal(applyTaskBoardCommand([personTask], [], { action: "move", taskId: personTask.id, target: "completed", expectedTaskRevision: 0 }).task.status, "completed");
});

test("editing active agent work fences its old attempt and queues a new revision", () => {
  const active = { ...agentTask, status: "active" };
  const run = { taskId: agentTask.id, taskRevision: 0, agentId: "researcher", status: "active", attempt: 1, startedAt: "now", updatedAt: "now", eveSessionId: "wrun_test" };
  const result = applyTaskBoardCommand([active], [run], { action: "edit", task: { ...active, description: "Find stronger evidence" }, expectedTaskRevision: 0 });
  assert.equal(result.cancelRun?.eveSessionId, "wrun_test");
  assert.equal(result.task.revision, 1);
  assert.equal(result.task.status, "queued");
});

test("moving an active card to Active again does not cancel its run", () => {
  const active = { ...agentTask, status: "active" };
  const run = { taskId: agentTask.id, taskRevision: 0, agentId: "researcher", status: "active", attempt: 1, startedAt: "now", updatedAt: "now" };
  const result = applyTaskBoardCommand([active], [run], { action: "move", taskId: agentTask.id, target: "active", expectedTaskRevision: 0 });
  assert.equal(result.cancelRun, undefined);
  assert.equal(result.task.revision, 0);
});
