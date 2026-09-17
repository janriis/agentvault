import { NextResponse } from "next/server";
import { findAgentSession, saveAgentSession, type StoredAgentSession } from "@/agent/lib/agent-sessions";
import { maybeCreateScheduledBackup } from "@/agent/lib/vault-export";
import { diagnosticLog } from "@/agent/lib/diagnostic-log";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as Partial<StoredAgentSession> | null;
  if (!payload || !isSafeId(payload.agentId) || !isSessionId(payload.eveSessionId)) {
    return NextResponse.json({ error: "A valid agent id and EVE session id are required." }, { status: 400 });
  }

  const session: StoredAgentSession = {
    agentId: payload.agentId,
    eveSessionId: payload.eveSessionId,
    ...(typeof payload.roomId === "string" ? { roomId: payload.roomId } : {}),
    updatedAt: new Date().toISOString(),
  };
  const previous = await findAgentSession(session.agentId, session.roomId);
  await saveAgentSession(session);
  if (previous?.eveSessionId !== session.eveSessionId) {
    diagnosticLog("session", "linked", { agentId: session.agentId, sessionId: session.eveSessionId, ...(session.roomId && isSafeId(session.roomId) ? { roomId: session.roomId } : {}) });
  }
  await maybeCreateScheduledBackup().catch(() => undefined);
  return NextResponse.json({ session }, { status: 201 });
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/u.test(value);
}

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,200}$/u.test(value);
}
