import { readFile } from "node:fs/promises";
import path from "node:path";
import { listDatabaseSessions, replaceDatabaseSessions } from "./vault-database";

export interface StoredAgentSession {
  agentId: string;
  eveSessionId: string;
  roomId?: string;
  updatedAt: string;
}

const sessionsPath = path.join(
  process.env.AGENT_VAULT_DATA_DIR ?? path.join(process.cwd(), ".data"),
  "agent-sessions.json",
);

let writeQueue = Promise.resolve();

async function listSessions(): Promise<StoredAgentSession[]> {
  const stored = listDatabaseSessions().flatMap((record) => isStoredSession(record.value) ? [record.value] : []);
  if (stored.length > 0) return stored;

  try {
    const parsed = JSON.parse(await readFile(sessionsPath, "utf8")) as unknown;
    if (Array.isArray(parsed) && parsed.every(isStoredSession)) {
      replaceDatabaseSessions(parsed.map((session) => ({ id: sessionKey(session), value: session })));
      return parsed;
    }
  } catch {
    // No legacy sessions means the database starts empty.
  }
  return [];
}

export async function findAgentSession(agentId: string, roomId?: string): Promise<StoredAgentSession | undefined> {
  const sessions = await listSessions();
  return sessions.find((session) => session.agentId === agentId && session.roomId === roomId);
}

export function saveAgentSession(session: StoredAgentSession): Promise<void> {
  const operation = writeQueue.then(async () => {
    const current = await listSessions();
    const next = [session, ...current.filter((item) => !(item.agentId === session.agentId && item.roomId === session.roomId))];
    replaceDatabaseSessions(next.map((item) => ({ id: sessionKey(item), value: item })));
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export async function listStoredAgentSessions(): Promise<StoredAgentSession[]> {
  return listSessions();
}

function sessionKey(session: StoredAgentSession): string {
  return `${session.agentId}:${session.roomId ?? ""}`;
}

function isStoredSession(value: unknown): value is StoredAgentSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<StoredAgentSession>;
  return typeof session.agentId === "string" && typeof session.eveSessionId === "string" && typeof session.updatedAt === "string";
}
