import assert from "node:assert/strict";
import test from "node:test";
import { assignedRoomTaskIds, mentionedRoomAgents, parseRoomAssignments, removeRoomAssignments, validRoomAssignments } from "../agent/lib/room-assignments.ts";
import { applyTaskBoardCommand } from "../agent/lib/task-commands.ts";

const targets = [
  { id: "lead", handle: "vault-lead", kind: "agent" },
  { id: "writer", handle: "writer", kind: "agent" },
  { id: "you", handle: "you", kind: "person" },
];

test("mentions address agents by exact handle, not lookalikes or people", () => {
  assert.deepEqual(mentionedRoomAgents("@vault-lead Assign the new tasks", targets), ["lead"]);
  assert.deepEqual(mentionedRoomAgents("@vault-lead-extra and @you", targets), []);
  assert.deepEqual(mentionedRoomAgents("@writer, please review", targets), ["writer"]);
});

test("lead assignment block is parsed and hidden from the visible reply", () => {
  const reply = 'I assigned the cards.\n<task-assignments>[{"taskId":"task-one","assigneeId":"writer"},{"taskId":"task-two","assigneeId":"lead"}]</task-assignments>';
  assert.deepEqual(parseRoomAssignments(reply), [{ taskId: "task-one", assigneeId: "writer" }, { taskId: "task-two", assigneeId: "lead" }]);
  assert.equal(removeRoomAssignments(reply), "I assigned the cards.");
  assert.deepEqual(assignedRoomTaskIds(reply, "writer"), ["task-one"]);
  assert.deepEqual(assignedRoomTaskIds(reply, "reviewer"), []);
});

test("malformed or duplicate assignments cannot become board commands", () => {
  assert.equal(parseRoomAssignments('<task-assignments>[{"taskId":"../bad","assigneeId":"writer"}]</task-assignments>'), undefined);
  assert.equal(parseRoomAssignments('<task-assignments>[{"taskId":"one","assigneeId":"writer"},{"taskId":"one","assigneeId":"lead"}]</task-assignments>'), undefined);
  assert.equal(parseRoomAssignments('<task-assignments>oops</task-assignments>'), undefined);
});

test("assignment validation rejects other rooms, active cards, and unavailable agents", () => {
  const cards = [{ id: "one", roomId: "room-a", status: "queued" }, { id: "two", roomId: "room-b", status: "queued" }, { id: "three", roomId: "room-a", status: "active" }];
  const eligible = new Set(["writer"]);
  assert.equal(validRoomAssignments([{ taskId: "one", assigneeId: "writer" }], "room-a", cards, eligible), true);
  assert.equal(validRoomAssignments([{ taskId: "two", assigneeId: "writer" }], "room-a", cards, eligible), false);
  assert.equal(validRoomAssignments([{ taskId: "three", assigneeId: "writer" }], "room-a", cards, eligible), false);
  assert.equal(validRoomAssignments([{ taskId: "one", assigneeId: "reviewer" }], "room-a", cards, eligible), false);
});

test("a validated lead reassignment queues the existing card for its new agent", () => {
  const card = { id: "one", title: "Compare drafts", description: "Review two versions", acceptanceCriteria: "Identify differences", assigneeId: "writer", assigneeType: "agent", roomId: "room-a", status: "queued", priority: "medium", updated: "Just now", revision: 0 };
  const assignments = [{ taskId: "one", assigneeId: "reviewer" }];
  assert.equal(validRoomAssignments(assignments, "room-a", [card], new Set(["reviewer"])), true);
  const result = applyTaskBoardCommand([card], [], { action: "edit", task: { ...card, assigneeId: assignments[0].assigneeId }, expectedTaskRevision: 0 });
  assert.equal(result.task.id, card.id);
  assert.equal(result.task.assigneeId, "reviewer");
  assert.equal(result.task.status, "queued");
  assert.equal(result.task.revision, 1);
});
