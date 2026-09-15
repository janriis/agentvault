export interface ProjectableTask {
  id: string;
  revision?: number;
  assigneeType: string;
  status: string;
  result?: string;
}

export interface ProjectableRun {
  taskId: string;
  taskRevision: number;
  status: "active" | "completed" | "failed" | "blocked" | "cancelled";
  result?: string;
}

export function projectTaskRuns<T extends ProjectableTask>(tasks: T[], runs: ProjectableRun[]): T[] {
  const byId = new Map(runs.map((run) => [run.taskId, run]));
  let changed = false;
  const projected = tasks.map((task) => {
    const run = byId.get(task.id);
    if (task.assigneeType !== "agent" || !run || run.taskRevision !== (task.revision ?? 0)) return task;
    const status = run.status === "completed" ? "completed" : run.status === "blocked" || run.status === "cancelled" ? "blocked" : run.status === "failed" ? "queued" : "active";
    if (task.status === status && (run.status !== "completed" || !run.result || task.result === run.result)) return task;
    changed = true;
    return { ...task, status, ...(run.status === "completed" && run.result ? { result: run.result } : {}) };
  });
  return changed ? projected : tasks;
}
