import assert from "node:assert/strict";
import test from "node:test";
import { projectTaskRuns } from "../agent/lib/task-projection.ts";

test("agent task status follows the matching durable run", () => {
  const tasks = [{ id: "agent-task", revision: 2, assigneeType: "agent", status: "queued", title: "Research" }, { id: "human-task", revision: 2, assigneeType: "person", status: "queued" }];
  const runs = [{ taskId: "agent-task", taskRevision: 2, status: "completed", result: "Evidence found" }, { taskId: "human-task", taskRevision: 2, status: "completed", result: "ignored" }];
  const projected = projectTaskRuns(tasks, runs);
  assert.equal(projected[0].status, "completed");
  assert.equal(projected[0].result, "Evidence found");
  assert.equal(projected[1].status, "queued");
  assert.equal(tasks[0].status, "queued", "projection must not mutate the caller's state");
  assert.equal(projectTaskRuns(projected, runs), projected, "unchanged polling must preserve state identity");
});

test("superseding task revision releases the old run projection", () => {
  const run = { taskId: "agent-task", taskRevision: 1, status: "blocked" };
  assert.equal(projectTaskRuns([{ id: "agent-task", revision: 2, assigneeType: "agent", status: "queued" }], [run])[0].status, "queued");
  assert.equal(projectTaskRuns([{ id: "agent-task", revision: 1, assigneeType: "agent", status: "active" }], [run])[0].status, "blocked");
});
