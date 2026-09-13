import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

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
  try {
    const parsed = JSON.parse(await readFile(sessionsPath, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed as StoredAgentSession[] : [];
  } catch {
    return [];
  }
}

export async function findAgentSession(agentId: string, roomId?: string): Promise<StoredAgentSession | undefined> {
  const sessions = await listSessions();
  return sessions.find((session) => session.agentId === agentId && session.roomId === roomId);
}

export function saveAgentSession(session: StoredAgentSession): Promise<void> {
  const operation = writeQueue.then(async () => {
    const current = await listSessions();
    const next = [session, ...current.filter((item) => !(item.agentId === session.agentId && item.roomId === session.roomId))];
    const directory = path.dirname(sessionsPath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${sessionsPath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(next, null, 2), "utf8");
    await rename(temporaryPath, sessionsPath);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}
