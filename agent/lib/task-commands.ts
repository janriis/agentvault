import type { TaskRunRecord } from "./vault-database.ts";
import { validateTaskDependencies } from "./task-dependencies.ts";

export type BoardStatus = "queued" | "active" | "blocked" | "completed";

export interface BoardTask {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria?: string;
  assigneeId: string;
  assigneeType: "agent" | "person";
  roomId?: string;
  sourceKey?: string;
  dependsOn?: string[];
  revision?: number;
  status: BoardStatus;
  priority: "low" | "medium" | "high";
  updated: string;
  result?: string;
}

export type TaskBoardCommand =
  | { action: "create"; task: BoardTask }
  | { action: "edit"; task: BoardTask; expectedTaskRevision: number }
  | { action: "move"; taskId: string; target: BoardStatus; expectedTaskRevision: number }
  | { action: "retry"; taskId: string; expectedTaskRevision: number };

export class TaskCommandConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskCommandConflictError";
  }
}

export class TaskCommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskCommandValidationError";
  }
}

export function applyTaskBoardCommand(tasks: BoardTask[], runs: TaskRunRecord[], command: TaskBoardCommand): { tasks: BoardTask[]; task: BoardTask; cancelRun?: TaskRunRecord } {
  if (command.action === "create") {
    const task = { ...command.task, status: "queued" as const, revision: 0, updated: "Just now" };
    validateBoardTask(task, true);
    if (tasks.some((candidate) => candidate.id === task.id || (task.sourceKey && candidate.sourceKey === task.sourceKey))) throw new TaskCommandConflictError("This task or room source was already added.");
    const next = [task, ...tasks];
    validateGraph(next);
    return { tasks: next, task };
  }

  const taskId = command.action === "edit" ? command.task.id : command.taskId;
  const previous = tasks.find((candidate) => candidate.id === taskId);
  if (!previous) throw new TaskCommandConflictError("The task no longer exists.");
  if ((previous.revision ?? 0) !== command.expectedTaskRevision) throw new TaskCommandConflictError("The task changed in another session. Reload before trying again.");
  const run = runs.find((candidate) => candidate.taskId === taskId && candidate.taskRevision === (previous.revision ?? 0));
  const cancelRun = run?.status === "active" ? run : undefined;

  let nextTask: BoardTask;
  if (command.action === "edit") {
    nextTask = {
      ...previous,
      ...command.task,
      id: previous.id,
      sourceKey: previous.sourceKey,
      status: command.task.assigneeType === "agent" ? "queued" : previous.status,
      revision: (previous.revision ?? 0) + 1,
      result: undefined,
      updated: "Just now",
    };
    validateBoardTask(nextTask, false);
  } else if (command.action === "retry") {
    if (previous.assigneeType !== "agent" || previous.status === "active") throw new TaskCommandValidationError("Only a stopped agent task can be retried.");
    nextTask = { ...previous, status: "queued", revision: (previous.revision ?? 0) + 1, result: undefined, updated: "Just now" };
  } else {
    const target = command.target;
    if (previous.assigneeType === "person") {
      nextTask = { ...previous, status: target, updated: "Just now" };
    } else if (target === "completed") {
      if (run?.status !== "completed") throw new TaskCommandValidationError("An agent task can be completed only by its accepted run result.");
      nextTask = { ...previous, status: "completed", updated: "Just now" };
    } else if (target === "active") {
      // The worker, not the browser, owns the transition to active.
      nextTask = previous.status === "active" ? previous : { ...previous, status: "queued", revision: (previous.revision ?? 0) + (Boolean(run) || previous.status === "blocked" || previous.status === "completed" ? 1 : 0), result: undefined, updated: "Just now" };
    } else if (target === "queued") {
      nextTask = { ...previous, status: "queued", revision: (previous.revision ?? 0) + (Boolean(run) || previous.status === "blocked" || previous.status === "completed" ? 1 : 0), result: undefined, updated: "Just now" };
    } else {
      nextTask = { ...previous, status: "blocked", revision: (previous.revision ?? 0) + (run?.status === "completed" ? 1 : 0), updated: "Just now" };
    }
  }

  const next = tasks.map((candidate) => candidate.id === taskId ? nextTask : candidate);
  validateGraph(next);
  const keepsCurrentRun = command.action === "move" && command.target === "active" && previous.status === "active";
  return { tasks: next, task: nextTask, ...(cancelRun && !keepsCurrentRun ? { cancelRun } : {}) };
}

function validateBoardTask(task: BoardTask, newTask: boolean): void {
  if (typeof task.id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/u.test(task.id) || typeof task.assigneeId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/u.test(task.assigneeId)) throw new TaskCommandValidationError("Task and assignee ids must be safe identifiers.");
  if (typeof task.title !== "string" || !task.title.trim() || typeof task.description !== "string" || task.title.length > 500 || task.description.length > 20_000) throw new TaskCommandValidationError("A task needs a title and bounded instructions.");
  if (task.assigneeType !== "agent" && task.assigneeType !== "person") throw new TaskCommandValidationError("Choose an agent or person assignee.");
  if (newTask && (typeof task.acceptanceCriteria !== "string" || !task.acceptanceCriteria.trim())) throw new TaskCommandValidationError("New tasks need acceptance criteria.");
  if (task.acceptanceCriteria !== undefined && (typeof task.acceptanceCriteria !== "string" || task.acceptanceCriteria.length > 10_000)) throw new TaskCommandValidationError("Acceptance criteria must be text below 10,000 characters.");
  if (!["low", "medium", "high"].includes(task.priority)) throw new TaskCommandValidationError("Choose a valid priority.");
}

function validateGraph(tasks: BoardTask[]): void {
  const error = validateTaskDependencies(tasks);
  if (error) throw new TaskCommandValidationError(error);
}
