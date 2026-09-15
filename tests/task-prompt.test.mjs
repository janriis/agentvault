import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkerTaskPrompt } from "../agent/lib/task-orchestration.ts";

test("worker task prompt carries saved acceptance criteria and room context", () => {
  const prompt = buildWorkerTaskPrompt({
    task: { id: "draft", title: "Draft a plan", description: "Cover risks", acceptanceCriteria: "Include three risks and a mitigation for each.", revision: 0, assigneeId: "writer", assigneeType: "agent", status: "queued" },
    agent: { id: "writer", name: "Writer", role: "writer", description: "Write clearly", model: "ChatGPT subscription" },
    room: { id: "room", name: "Workshop", description: "Make a plan" },
  });
  assert.match(prompt, /Acceptance criteria/);
  assert.match(prompt, /three risks and a mitigation/);
  assert.match(prompt, /Workshop/);
});
