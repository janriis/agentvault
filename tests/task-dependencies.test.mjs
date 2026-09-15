import assert from "node:assert/strict";
import test from "node:test";
import { unmetTaskDependencies, validateTaskDependencies } from "../agent/lib/task-dependencies.ts";

test("a task waits until every prerequisite is completed", () => {
  const tasks = [
    { id: "research", status: "completed" },
    { id: "review", status: "active" },
    { id: "publish", status: "queued", dependsOn: ["research", "review"] },
  ];
  assert.deepEqual(unmetTaskDependencies(tasks[2], tasks), ["review"]);
  tasks[1].status = "completed";
  assert.deepEqual(unmetTaskDependencies(tasks[2], tasks), []);
});

test("missing, duplicate, self, and circular prerequisites are rejected", () => {
  assert.match(validateTaskDependencies([{ id: "a", status: "queued", dependsOn: ["missing"] }]), /does not exist/);
  assert.match(validateTaskDependencies([{ id: "a", status: "queued", dependsOn: ["a"] }]), /itself/);
  assert.match(validateTaskDependencies([{ id: "a", status: "queued" }, { id: "b", status: "queued", dependsOn: ["a", "a"] }]), /Duplicate/);
  assert.match(validateTaskDependencies([{ id: "a", status: "queued", dependsOn: ["b"] }, { id: "b", status: "queued", dependsOn: ["a"] }]), /cycle/);
});

test("independent tasks remain valid", () => {
  assert.equal(validateTaskDependencies([{ id: "a", status: "queued" }, { id: "b", status: "completed" }]), undefined);
});
