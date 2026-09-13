import { NextResponse } from "next/server";
import { saveAgentSession, type StoredAgentSession } from "@/agent/lib/agent-sessions";

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
  await saveAgentSession(session);
  return NextResponse.json({ session }, { status: 201 });
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/u.test(value);
}

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,200}$/u.test(value);
}
