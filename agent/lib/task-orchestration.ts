import { claimTaskRun, finishTaskRun, getVaultSettings, getVaultState, listTaskRuns, type TaskRunRecord } from "./vault-database.ts";
import { unmetTaskDependencies } from "./task-dependencies.ts";
import { resolveWorkspaceModel } from "./workspace-model.ts";

export interface RunnableTask {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria?: string;
  revision: number;
  assigneeId: string;
  assigneeType: "agent" | "person";
  roomId?: string;
  status: "queued" | "active" | "blocked" | "completed";
}

interface VaultAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  context?: string;
  model: string;
  tools?: string[];
  permissions?: string[];
  allowedFolders?: string[];
}

interface VaultRoom {
  id: string;
  name: string;
  description: string;
}

export interface WorkerJob {
  task: RunnableTask;
  agent: VaultAgent;
  room?: VaultRoom;
  previousRun?: TaskRunRecord;
}

export function findRunnableJobs(now = Date.now()): WorkerJob[] {
  const state = getVaultState()?.state;
  if (!state) return [];
  const tasks = state.tasks as Array<RunnableTask & { dependsOn?: string[] }>;
  const agents = state.agents as VaultAgent[];
  const rooms = state.rooms as VaultRoom[];
  const runs = new Map(listTaskRuns().map((run) => [run.taskId, run]));
  const settings = getVaultSettings();
  return tasks.flatMap((task) => {
    if (task.assigneeType !== "agent" || (task.status !== "queued" && task.status !== "active")) return [];
    const waitingFor = unmetTaskDependencies(task, tasks).filter((id) => {
      const dependency = tasks.find((candidate) => candidate.id === id);
      const run = runs.get(id);
      return !dependency || !run || run.status !== "completed" || run.taskRevision !== (dependency.revision ?? 0);
    });
    if (waitingFor.length > 0) return [];
    const agent = agents.find((candidate) => candidate.id === task.assigneeId);
    if (!agent) return [];
    try { resolveWorkspaceModel(agent.model, settings); } catch { return []; }
    const run = runs.get(task.id);
    if (run && run.taskRevision === (task.revision ?? 0)) {
      if (["completed", "blocked", "cancelled"].includes(run.status)) return [];
      if (run.status === "active" && !run.eveSessionId && now - Date.parse(run.updatedAt) < settings.taskTimeoutMinutes * 60_000) return [];
      if (run.status === "failed" && (run.attempt >= settings.maxTaskAttempts || now - Date.parse(run.updatedAt) < 30_000)) return [];
    }
    return [{ task, agent, room: rooms.find((candidate) => candidate.id === task.roomId), ...(run?.status === "active" && run.taskRevision === (task.revision ?? 0) ? { previousRun: run } : {}) }];
  });
}

export function taskAgentRoute(agentId: string): string {
  return agentId === "lead" ? "coordinator" : ["researcher", "planner", "writer", "reviewer"].includes(agentId) ? agentId : "custom";
}

export function buildWorkerTaskPrompt({ task, agent, room }: WorkerJob): string {
  return [
    `You are ${agent.name}, working as the ${agent.role} specialist in Agent Vault.`,
    agent.context ?? agent.description,
    `Assigned task: ${task.title}`,
    `Instructions:\n${task.description}`,
    task.acceptanceCriteria ? `Acceptance criteria — explain how each is met with concrete evidence:\n${task.acceptanceCriteria}` : "Report the result and any unresolved concerns.",
    agent.tools?.includes("File workspace") ? `The selected host workspace is accessible through workspace_file only for this active task. Read workspace: ${agent.permissions?.includes("Read workspace") ? "allowed" : "denied"}; write workspace: ${agent.permissions?.includes("Write workspace") ? "allowed" : "denied"}; allowed folders: ${(agent.allowedFolders?.length ? agent.allowedFolders : ["."]).join(", ")}. Read first and use the returned SHA-256 when editing. Report changed paths and test outcomes.` : "Host workspace file access is not enabled for this agent.",
    room ? `This task came from the workshop room “${room.name}”. Room purpose: ${room.description}` : "This task was assigned from the Agent Vault task board.",
    "Start working on the task now. Return a concise progress update or completed result with concrete findings, decisions, files, or next steps. Do not only describe how you would approach it.",
  ].join("\n\n");
}

export function workerModelContext(agent: VaultAgent): { provider: "chatgpt" } | { provider: "ollama"; baseUrl: string; model: string } {
  return resolveWorkspaceModel(agent.model, getVaultSettings());
}

export function classifyTaskSessionEvents(events: ReadonlyArray<{ type: string; data?: { message?: string | null; finishReason?: string } }>): { status: "pending" | "waiting-input" } | { status: "completed"; result: string } | { status: "failed"; error: string } {
  const lastTurn = events.findLastIndex((event) => event.type === "turn.started");
  const current = lastTurn < 0 ? events : events.slice(lastTurn);
  if (current.some((event) => event.type === "session.failed" || event.type === "turn.failed" || event.type === "turn.cancelled")) return { status: "failed", error: "The resumed EVE session failed or was cancelled." };
  const lastInput = [...current].reverse().find((event) => event.type === "input.requested" || event.type === "input.resolved");
  if (lastInput?.type === "input.requested") return { status: "waiting-input" };
  if (!current.some((event) => event.type === "turn.completed" || event.type === "session.completed")) return { status: "pending" };
  const message = [...current].reverse().find((event) => event.type === "message.completed" && event.data?.finishReason !== "tool-calls")?.data?.message?.trim();
  return message ? { status: "completed", result: message } : { status: "failed", error: "The resumed EVE session returned no result." };
}

export function lastTaskInputResolvedAt(events: ReadonlyArray<{ type: string; meta?: { at?: string } }>): string | undefined {
  return [...events].reverse().find((event) => event.type === "input.resolved" && event.meta?.at)?.meta?.at;
}

export function taskSessionExpired(run: TaskRunRecord, timeoutMinutes: number, now = Date.now(), resumedAt?: string): boolean {
  const resumedTime = resumedAt ? Date.parse(resumedAt) : NaN;
  return now - (Number.isFinite(resumedTime) ? Math.max(Date.parse(run.startedAt), resumedTime) : Date.parse(run.startedAt)) >= timeoutMinutes * 60_000;
}

export async function runWorkerJob(job: WorkerJob, execute: (job: WorkerJob, run: TaskRunRecord) => Promise<string | undefined>): Promise<TaskRunRecord | undefined> {
  const revision = job.task.revision ?? 0;
  const run = claimTaskRun(job.task.id, revision, job.agent.id);
  try {
    const output = await execute(job, run);
    if (output === undefined) return undefined; // A durable EVE turn is waiting for human input.
    const result = output.trim();
    if (!result) throw new Error("The agent returned no task result.");
    return finishTaskRun(job.task.id, revision, run.attempt, { status: "completed", result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return finishTaskRun(job.task.id, revision, run.attempt, { status: "failed", error: detail });
  }
}
