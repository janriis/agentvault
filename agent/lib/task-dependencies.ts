export interface DependencyTask {
  id: string;
  dependsOn?: string[];
  status: string;
}

export function validateTaskDependencies(tasks: DependencyTask[]): string | undefined {
  if (tasks.some((task) => !task || typeof task.id !== "string" || !task.id || typeof task.status !== "string")) return "Tasks need valid ids and statuses.";
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) return "Task ids must be unique.";
  for (const task of tasks) {
    const dependencies = task.dependsOn ?? [];
    if (!Array.isArray(dependencies) || dependencies.some((id) => typeof id !== "string")) return `Invalid prerequisites for ${task.id}.`;
    if (new Set(dependencies).size !== dependencies.length) return `Duplicate prerequisites for ${task.id}.`;
    for (const id of dependencies) {
      if (!byId.has(id)) return `Prerequisite ${id} does not exist.`;
      if (id === task.id) return `A task cannot depend on itself.`;
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) if (visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return tasks.some((task) => visit(task.id)) ? "Task prerequisites cannot form a cycle." : undefined;
}

export function unmetTaskDependencies(task: DependencyTask, tasks: DependencyTask[]): string[] {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  return (task.dependsOn ?? []).filter((id) => byId.get(id)?.status !== "completed");
}
