import { claimTaskRun, finishTaskRun, getVaultSettings, getVaultState, listTaskRuns, type TaskRunRecord } from "./vault-database.ts";
import { unmetTaskDependencies } from "./task-dependencies.ts";

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
    const run = runs.get(task.id);
    if (run && run.taskRevision === (task.revision ?? 0)) {
      if (["completed", "blocked", "cancelled"].includes(run.status)) return [];
      if (run.status === "active" && now - Date.parse(run.updatedAt) < settings.taskTimeoutMinutes * 60_000) return [];
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
    room ? `This task came from the workshop room “${room.name}”. Room purpose: ${room.description}` : "This task was assigned from the Agent Vault task board.",
    "Start working on the task now. Return a concise progress update or completed result with concrete findings, decisions, files, or next steps. Do not only describe how you would approach it.",
  ].join("\n\n");
}

export function workerModelContext(agent: VaultAgent): { provider: "chatgpt" } | { provider: "ollama"; baseUrl: string; model: string } {
  if (agent.model.startsWith("Ollama · ")) return { provider: "ollama", baseUrl: getVaultSettings().ollamaHost, model: agent.model.slice("Ollama · ".length) };
  return { provider: "chatgpt" };
}

export async function runWorkerJob(job: WorkerJob, execute: (job: WorkerJob, run: TaskRunRecord) => Promise<string>): Promise<TaskRunRecord | undefined> {
  const revision = job.task.revision ?? 0;
  const run = claimTaskRun(job.task.id, revision, job.agent.id);
  try {
    const result = (await execute(job, run)).trim();
    if (!result) throw new Error("The agent returned no task result.");
    return finishTaskRun(job.task.id, revision, run.attempt, { status: "completed", result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return finishTaskRun(job.task.id, revision, run.attempt, { status: "failed", error: detail });
  }
}
