import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface PersistedVaultState {
  agents: unknown[];
  people: unknown[];
  rooms: unknown[];
  tasks: unknown[];
  activity: unknown[];
}

export interface VaultStateRecord {
  state: PersistedVaultState;
  revision: number;
  updatedAt: string;
}

export interface DatabaseJsonRecord {
  id: string;
  value: unknown;
  updatedAt: string;
}

export class VaultStateConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super("The vault changed in another session. Reload before saving again.");
    this.name = "VaultStateConflictError";
  }
}

const dataDirectory = process.env.AGENT_VAULT_DATA_DIR ?? path.join(process.cwd(), ".data");
const databasePath = path.join(dataDirectory, "agent-vault.db");
let database: DatabaseSync | undefined;

export function getVaultState(): VaultStateRecord | undefined {
  const row = getDatabase().prepare("SELECT state_json, revision, updated_at FROM vault_state WHERE id = ?").get("default") as { state_json?: string; revision?: number; updated_at?: string } | undefined;
  if (!row?.state_json) return undefined;
  return {
    state: JSON.parse(row.state_json) as PersistedVaultState,
    revision: row.revision ?? 0,
    updatedAt: row.updated_at ?? new Date(0).toISOString(),
  };
}

export function saveVaultState(state: PersistedVaultState, expectedRevision?: number): VaultStateRecord {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db.prepare("SELECT revision FROM vault_state WHERE id = ?").get("default") as { revision?: number } | undefined;
    const currentRevision = current?.revision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new VaultStateConflictError(currentRevision);
    }
    const revision = currentRevision + 1;
    const updatedAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO vault_state (id, state_json, revision, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state_json = excluded.state_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run("default", JSON.stringify(state), revision, updatedAt);
    db.exec("COMMIT");
    return { state, revision, updatedAt };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listDatabaseAgents(): DatabaseJsonRecord[] {
  return getDatabase().prepare("SELECT id, record_json, updated_at FROM agent_registry ORDER BY updated_at DESC").all().flatMap((row) => parseJsonRecord(row));
}

export function replaceDatabaseAgents(records: Array<{ id: string; value: unknown }>): void {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM agent_registry");
    const updatedAt = new Date().toISOString();
    const statement = db.prepare("INSERT INTO agent_registry (id, record_json, updated_at) VALUES (?, ?, ?)");
    for (const record of records) statement.run(record.id, JSON.stringify(record.value), updatedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listDatabaseSessions(): DatabaseJsonRecord[] {
  return getDatabase().prepare("SELECT agent_id || ':' || room_id AS id, record_json, updated_at FROM agent_sessions ORDER BY updated_at DESC").all().flatMap((row) => parseJsonRecord(row));
}

export function replaceDatabaseSessions(records: Array<{ id: string; value: unknown }>): void {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM agent_sessions");
    const updatedAt = new Date().toISOString();
    const statement = db.prepare("INSERT INTO agent_sessions (agent_id, room_id, record_json, updated_at) VALUES (?, ?, ?, ?)");
    for (const record of records) {
      const separator = record.id.indexOf(":");
      const agentId = separator === -1 ? record.id : record.id.slice(0, separator);
      const roomId = separator === -1 ? "" : record.id.slice(separator + 1);
      statement.run(agentId, roomId, JSON.stringify(record.value), updatedAt);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listDatabaseArtifacts(): DatabaseJsonRecord[] {
  return getDatabase().prepare("SELECT id, record_json, updated_at FROM artifact_registry ORDER BY updated_at DESC").all().flatMap((row) => parseJsonRecord(row));
}

export function replaceDatabaseArtifacts(records: Array<{ id: string; value: unknown }>): void {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM artifact_registry");
    const updatedAt = new Date().toISOString();
    const statement = db.prepare("INSERT INTO artifact_registry (id, record_json, updated_at) VALUES (?, ?, ?)");
    for (const record of records) statement.run(record.id, JSON.stringify(record.value), updatedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getDatabase(): DatabaseSync {
  if (database) return database;
  mkdirSync(dataDirectory, { recursive: true });
  database = new DatabaseSync(databasePath, { timeout: 5000 });
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  applyMigration(database, 1, "vault-state-envelope", `
    CREATE TABLE IF NOT EXISTS vault_state (
      id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  applyMigration(database, 2, "agent-and-session-registry", `
    CREATE TABLE IF NOT EXISTS agent_registry (
      id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_sessions (
      agent_id TEXT NOT NULL,
      room_id TEXT NOT NULL DEFAULT '',
      record_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, room_id)
    );
  `);
  applyMigration(database, 3, "artifact-metadata-registry", `
    CREATE TABLE IF NOT EXISTS artifact_registry (
      id TEXT PRIMARY KEY,
      record_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return database;
}

function applyMigration(db: DatabaseSync, version: number, name: string, sql: string): void {
  const applied = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(version);
  if (applied) return;
  db.exec("BEGIN");
  try {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(version, name, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function parseJsonRecord(row: Record<string, unknown>): DatabaseJsonRecord[] {
  if (typeof row.id !== "string" || typeof row.record_json !== "string") return [];
  try {
    return [{
      id: row.id,
      value: JSON.parse(row.record_json),
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : new Date(0).toISOString(),
    }];
  } catch {
    return [];
  }
}
