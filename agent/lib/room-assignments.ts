export interface RoomAssignment {
  taskId: string;
  assigneeId: string;
}

const assignmentBlock = /<task-assignments>\s*([\s\S]*?)\s*<\/task-assignments>/iu;
const safeId = /^[a-zA-Z0-9_-]{1,160}$/u;

export function parseRoomAssignments(content: string): RoomAssignment[] | undefined {
  const block = content.match(assignmentBlock);
  if (!block) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(block[1]);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 12) return undefined;
  const assignments: RoomAssignment[] = [];
  const seen = new Set<string>();
  for (const value of parsed) {
    if (!value || typeof value !== "object") return undefined;
    const item = value as Record<string, unknown>;
    if (typeof item.taskId !== "string" || !safeId.test(item.taskId) || typeof item.assigneeId !== "string" || !safeId.test(item.assigneeId) || seen.has(item.taskId)) return undefined;
    seen.add(item.taskId);
    assignments.push({ taskId: item.taskId, assigneeId: item.assigneeId });
  }
  return assignments;
}

export function removeRoomAssignments(content: string): string {
  return content.replace(assignmentBlock, "").trim();
}

export function validRoomAssignments(
  assignments: RoomAssignment[] | undefined,
  roomId: string,
  tasks: Array<{ id: string; roomId?: string; status: string }>,
  eligibleAgentIds: ReadonlySet<string>,
): assignments is RoomAssignment[] {
  if (!assignments?.length) return false;
  return assignments.every(({ taskId, assigneeId }) =>
    eligibleAgentIds.has(assigneeId) && tasks.some((task) => task.id === taskId && task.roomId === roomId && task.status === "queued"),
  );
}

export function mentionedRoomAgents(content: string, targets: Array<{ id: string; handle: string; kind: string }>): string[] {
  return targets.filter((target) => target.kind === "agent" && new RegExp(`(^|[^a-z0-9_-])@${target.handle}(?![a-z0-9_-])`, "iu").test(content)).map((target) => target.id);
}
