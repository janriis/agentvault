import { NextResponse } from "next/server";
import { Client } from "eve/client";
import { executeTaskBoardCommand } from "@/agent/lib/vault-database";
import { TaskCommandConflictError, TaskCommandValidationError, type TaskBoardCommand } from "@/agent/lib/task-commands";
import { taskAgentRoute } from "@/agent/lib/task-orchestration";
import { maybeCreateScheduledBackup } from "@/agent/lib/vault-export";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as { idempotencyKey?: unknown; command?: unknown } | null;
  if (!payload || typeof payload.idempotencyKey !== "string" || !isTaskBoardCommand(payload.command)) return NextResponse.json({ error: "A valid task command and idempotency key are required." }, { status: 400 });
  try {
    const result = executeTaskBoardCommand(payload.idempotencyKey, payload.command);
    let warning: string | undefined;
    if (!result.replayed && result.cancelledRun?.eveSessionId) {
      const run = result.cancelledRun;
      const route = taskAgentRoute(run.agentId);
      const client = new Client({ host: `${new URL(request.url).origin}/eve/agents/${route}`, ...(route === "custom" ? { headers: { "x-vault-agent-id": run.agentId } } : {}), redirect: "error" });
      try { await client.sessions.attach(result.cancelledRun.eveSessionId).cancel({ tasks: true }); }
      catch { warning = "The old attempt was fenced, but EVE did not confirm cancellation. Its session may still be settling."; }
    }
    await maybeCreateScheduledBackup().catch(() => undefined);
    return NextResponse.json({ ...result, ...(warning ? { warning } : {}) });
  } catch (error) {
    if (error instanceof TaskCommandConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof TaskCommandValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "The task action could not be saved." }, { status: 500 });
  }
}

function isTaskBoardCommand(value: unknown): value is TaskBoardCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  if (command.action === "create") return isTaskCandidate(command.task);
  if (command.action === "edit") return isTaskCandidate(command.task) && isRevision(command.expectedTaskRevision);
  if (command.action === "retry") return isSafeId(command.taskId) && isRevision(command.expectedTaskRevision);
  if (command.action === "move") return isSafeId(command.taskId) && isRevision(command.expectedTaskRevision) && ["queued", "active", "blocked", "completed"].includes(String(command.target));
  return false;
}

function isTaskCandidate(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  return isSafeId(task.id) && isSafeId(task.assigneeId) && typeof task.title === "string" && typeof task.description === "string" && (task.acceptanceCriteria === undefined || typeof task.acceptanceCriteria === "string") && (task.assigneeType === "agent" || task.assigneeType === "person") && ["low", "medium", "high"].includes(String(task.priority)) && (task.dependsOn === undefined || Array.isArray(task.dependsOn) && task.dependsOn.every(isSafeId));
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/u.test(value);
}

function isRevision(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}
