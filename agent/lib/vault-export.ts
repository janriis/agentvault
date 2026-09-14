import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { listStoredAgentSessions } from "./agent-sessions";
import { listStoredAgents } from "./agent-registry";
import { deleteStoredArtifact, listStoredArtifacts, upsertStoredArtifact, type StoredArtifact } from "./artifact-store";
import { getVaultState, replaceDatabaseAgents, replaceDatabaseArtifacts, replaceDatabaseSessions, saveVaultState } from "./vault-database";
import { getWorkspaceConfig } from "./workspace-store";

export interface VaultExportDocument {
  format: "agent-vault-export";
  version: 1;
  exportedAt: string;
  workspace: Awaited<ReturnType<typeof getWorkspaceConfig>>;
  vaultState: ReturnType<typeof getVaultState> | null;
  agents: Awaited<ReturnType<typeof listStoredAgents>>;
  sessions: Awaited<ReturnType<typeof listStoredAgentSessions>>;
  artifacts: Awaited<ReturnType<typeof listStoredArtifacts>>;
}

export async function buildVaultExport(): Promise<VaultExportDocument> {
  return {
    format: "agent-vault-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: await getWorkspaceConfig(),
    vaultState: getVaultState() ?? null,
    agents: await listStoredAgents(),
    sessions: await listStoredAgentSessions(),
    artifacts: await listStoredArtifacts(),
  };
}

export async function createVaultBackup(): Promise<{ filename: string; createdAt: string }> {
  const document = await buildVaultExport();
  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replace(/[:.]/gu, "-");
  const filename = `agent-vault-backup-${timestamp}.json`;
  const dataDirectory = process.env.AGENT_VAULT_DATA_DIR ?? path.join(process.cwd(), ".data");
  const backupDirectory = path.join(dataDirectory, "backups");
  await mkdir(backupDirectory, { recursive: true });
  await writeFile(path.join(backupDirectory, filename), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { filename, createdAt };
}

let scheduledBackupPromise: Promise<{ filename: string; createdAt: string } | undefined> | undefined;

export function maybeCreateScheduledBackup(): Promise<{ filename: string; createdAt: string } | undefined> {
  if (scheduledBackupPromise) return scheduledBackupPromise;
  scheduledBackupPromise = (async () => {
    const dataDirectory = process.env.AGENT_VAULT_DATA_DIR ?? path.join(process.cwd(), ".data");
    const backupDirectory = path.join(dataDirectory, "backups");
    const interval = Number(process.env.AGENT_VAULT_BACKUP_INTERVAL_MS ?? 21_600_000);
    const intervalMs = Number.isFinite(interval) && interval > 0 ? interval : 21_600_000;
    try {
      const names = await readdir(backupDirectory);
      const candidates = await Promise.all(names.filter((name) => name.startsWith("agent-vault-backup-") && name.endsWith(".json")).map(async (name) => ({ name, modified: (await stat(path.join(backupDirectory, name))).mtimeMs })));
      const latest = candidates.sort((left, right) => right.modified - left.modified)[0];
      if (latest && Date.now() - latest.modified < intervalMs) return undefined;
    } catch {
      // A missing backup folder is handled by createVaultBackup.
    }
    return createVaultBackup();
  })().finally(() => {
    scheduledBackupPromise = undefined;
  });
  return scheduledBackupPromise;
}

export async function restoreVaultExport(value: unknown): Promise<{ agents: number; sessions: number; artifacts: number; revision: number }> {
  if (!isVaultExportDocument(value)) throw new Error("The import file is not a supported Agent Vault export.");
  const record = saveVaultState(value.vaultState.state);
  replaceDatabaseAgents(value.agents.map((agent) => ({ id: agent.id, value: agent })));
  replaceDatabaseSessions(value.sessions.map((session) => ({ id: `${session.agentId}:${session.roomId ?? ""}`, value: session })));
  const importedArtifactIds = new Set(value.artifacts.map((artifact) => artifact.id));
  for (const artifact of await listStoredArtifacts()) {
    if (!importedArtifactIds.has(artifact.id)) await deleteStoredArtifact(artifact.id);
  }
  for (const artifact of value.artifacts) await upsertStoredArtifact(artifact);
  replaceDatabaseArtifacts(value.artifacts.map((artifact) => ({ id: artifact.id, value: artifact })));
  return { agents: value.agents.length, sessions: value.sessions.length, artifacts: value.artifacts.length, revision: record.revision };
}

function isVaultExportDocument(value: unknown): value is VaultExportDocument & { vaultState: NonNullable<VaultExportDocument["vaultState"]> } {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<VaultExportDocument>;
  if (document.format !== "agent-vault-export" || document.version !== 1 || !Array.isArray(document.agents) || !Array.isArray(document.sessions) || !Array.isArray(document.artifacts) || !document.vaultState || !document.vaultState.state) return false;
  const state = document.vaultState.state;
  if (![state.agents, state.people, state.rooms, state.tasks, state.activity].every(Array.isArray)) return false;
  return document.agents.every((agent) => isRecord(agent) && typeof agent.id === "string" && typeof agent.name === "string") && document.sessions.every((session) => isRecord(session) && typeof session.agentId === "string" && typeof session.eveSessionId === "string") && document.artifacts.every(isRestorableArtifact);
}

function isRestorableArtifact(value: unknown): value is StoredArtifact {
  return isRecord(value) && typeof value.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/u.test(value.id) && typeof value.title === "string" && typeof value.type === "string" && ["note", "plan", "draft", "file"].includes(value.type) && typeof value.owner === "string" && typeof value.updated === "string" && typeof value.content === "string" && value.content.length <= 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}
