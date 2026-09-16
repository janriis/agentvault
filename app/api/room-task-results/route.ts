import { NextResponse } from "next/server";
import { completeAssignedRoomTasks, getVaultState, TaskClaimError } from "@/agent/lib/vault-database";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as { taskIds?: unknown; roomId?: unknown; agentId?: unknown; result?: unknown } | null;
  if (!payload || !Array.isArray(payload.taskIds) || !payload.taskIds.every(isSafeId) || !isSafeId(payload.roomId) || !isSafeId(payload.agentId) || typeof payload.result !== "string") {
    return NextResponse.json({ error: "Valid room tasks, agent, and result are required." }, { status: 400 });
  }
  try {
    const outcome = completeAssignedRoomTasks(payload.taskIds, payload.roomId, payload.agentId, payload.result);
    return NextResponse.json({ ...outcome, record: getVaultState() });
  } catch (error) {
    if (error instanceof TaskClaimError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "The room result could not be saved to its assigned tasks." }, { status: 500 });
  }
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/u.test(value);
}
