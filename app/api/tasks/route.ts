import { NextResponse } from "next/server";
import { claimTaskRun, finishTaskRun } from "@/agent/lib/vault-database";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as { action?: unknown; taskId?: unknown; taskRevision?: unknown; agentId?: unknown; result?: unknown; error?: unknown } | null;
  if (!payload || !isSafeId(payload.taskId) || !Number.isInteger(payload.taskRevision) || (payload.taskRevision as number) < 0) {
    return NextResponse.json({ error: "A valid task id and revision are required." }, { status: 400 });
  }
  try {
    if (payload.action === "claim") {
      if (!isSafeId(payload.agentId)) return NextResponse.json({ error: "A valid agent id is required to claim a task." }, { status: 400 });
      return NextResponse.json({ run: claimTaskRun(payload.taskId, payload.taskRevision as number, payload.agentId) });
    }
    if (payload.action === "complete" && typeof payload.result === "string") {
      return NextResponse.json({ run: finishTaskRun(payload.taskId, payload.taskRevision as number, { status: "completed", result: payload.result }) });
    }
    if (payload.action === "fail" && typeof payload.error === "string") {
      return NextResponse.json({ run: finishTaskRun(payload.taskId, payload.taskRevision as number, { status: "failed", error: payload.error }) });
    }
    return NextResponse.json({ error: "Unsupported task action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "The task run could not be updated." }, { status: 500 });
  }
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/u.test(value);
}
