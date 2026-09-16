import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unmetTaskDependencies, validateTaskDependencies } from "./task-dependencies.ts";
import { projectTaskRuns, type ProjectableTask } from "./task-projection.ts";
import { applyTaskBoardCommand, TaskCommandConflictError, type BoardTask, type TaskBoardCommand } from "./task-commands.ts";

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

export interface TaskRunRecord {
  taskId: string;
  taskRevision: number;
  agentId: string;
  status: "active" | "completed" | "failed" | "blocked" | "cancelled";
  attempt: number;
  result?: string;
  error?: string;
  eveSessionId?: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
}

export interface FileChangeRecord {
  operationId: string;
  taskId: string;
  taskRevision: number;
  agentId: string;
  eveSessionId: string;
  action: string;
  path: string;
  beforeHash?: string;
  afterHash?: string;
  status: "planned" | "completed" | "failed";
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface TaskWorktreeRecord {
  taskId: string;
  taskRevision: number;
  sourceRoot: string;
  worktreeRoot: string;
  createdAt: string;
}

export interface VaultSettings {
  workspaceName: string;
  defaultModel: "chatgpt-subscription" | "ollama";
  ollamaHost: string;
  maxTaskAttempts: number;
  taskTimeoutMinutes: number;
  backupIntervalMs: number;
  confirmationMode: "risky-actions" | "all-actions";
}

export class VaultStateConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("The vault changed in another session. Reload before saving again.");
    this.name = "VaultStateConflictError";
    this.currentRevision = currentRevision;
  }
}

export class TaskClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskClaimError";
  }
}

export class VaultStateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultStateValidationError";
  }
}

const dataDirectory = process.env.AGENT_VAULT_DATA_DIR ?? path.join(process.cwd(), ".data");
const databasePath = path.join(dataDirectory, "agent-vault.db");
let database: DatabaseSync | undefined;

export function getVaultState(): VaultStateRecord | undefined {
  const row = getDatabase().prepare("SELECT state_json, revision, updated_at FROM vault_state WHERE id = ?").get("default") as { state_json?: string; revision?: number; updated_at?: string } | undefined;
  if (!row?.state_json) return undefined;
  return {
    state: projectVaultState(JSON.parse(row.state_json) as PersistedVaultState),
    revision: row.revision ?? 0,
    updatedAt: row.updated_at ?? new Date(0).toISOString(),
  };
}

export function getActiveTaskRunBySession(eveSessionId: string): TaskRunRecord | undefined {
  const row = getDatabase().prepare("SELECT * FROM task_runs WHERE eve_session_id = ? AND status = 'active'").get(eveSessionId);
  return row ? parseTaskRunRow(row as Record<string, unknown>) : undefined;
}

export function getTaskWorktree(taskId: string, taskRevision: number): TaskWorktreeRecord | undefined {
  const row = getDatabase().prepare("SELECT * FROM task_worktrees WHERE task_id = ? AND task_revision = ?").get(taskId, taskRevision) as Record<string, unknown> | undefined;
  return row ? { taskId: String(row.task_id), taskRevision: Number(row.task_revision), sourceRoot: String(row.source_root), worktreeRoot: String(row.worktree_root), createdAt: String(row.created_at) } : undefined;
}

export function saveTaskWorktree(record: TaskWorktreeRecord): TaskWorktreeRecord {
  getDatabase().prepare("INSERT INTO task_worktrees (task_id, task_revision, source_root, worktree_root, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(record.taskId, record.taskRevision, record.sourceRoot, record.worktreeRoot, record.createdAt);
  return record;
}

export function getFileChange(operationId: string): FileChangeRecord | undefined {
  const row = getDatabase().prepare("SELECT * FROM file_changes WHERE operation_id = ?").get(operationId) as Record<string, unknown> | undefined;
  return row ? parseFileChange(row) : undefined;
}

export function listFileChanges(taskId?: string, limit: number | null = 200): FileChangeRecord[] {
  const rows = taskId
    ? getDatabase().prepare("SELECT * FROM file_changes WHERE task_id = ? ORDER BY created_at DESC").all(taskId)
    : limit === null ? getDatabase().prepare("SELECT * FROM file_changes ORDER BY created_at DESC").all()
      : getDatabase().prepare("SELECT * FROM file_changes ORDER BY created_at DESC LIMIT ?").all(limit);
  return rows.map((row) => parseFileChange(row as Record<string, unknown>));
}

export function beginFileChange(change: Omit<FileChangeRecord, "status" | "result" | "createdAt" | "updatedAt" | "afterHash">): FileChangeRecord {
  const now = new Date().toISOString();
  getDatabase().prepare("INSERT INTO file_changes (operation_id, task_id, task_revision, agent_id, eve_session_id, action, path, before_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)")
    .run(change.operationId, change.taskId, change.taskRevision, change.agentId, change.eveSessionId, change.action, change.path, change.beforeHash ?? null, now, now);
  return { ...change, status: "planned", createdAt: now, updatedAt: now };
}

export function finishFileChange(operationId: string, status: "completed" | "failed", result: unknown, afterHash?: string): FileChangeRecord {
  getDatabase().prepare("UPDATE file_changes SET status = ?, result_json = ?, after_hash = ?, updated_at = ? WHERE operation_id = ? AND status = 'planned'")
    .run(status, JSON.stringify(result), afterHash ?? null, new Date().toISOString(), operationId);
  const record = getFileChange(operationId);
  if (!record) throw new Error("The file-change audit record is missing.");
  return record;
}

function parseFileChange(row: Record<string, unknown>): FileChangeRecord {
  return {
    operationId: String(row.operation_id), taskId: String(row.task_id), taskRevision: Number(row.task_revision),
    agentId: String(row.agent_id), eveSessionId: String(row.eve_session_id), action: String(row.action), path: String(row.path),
    ...(row.before_hash ? { beforeHash: String(row.before_hash) } : {}),
    ...(row.after_hash ? { afterHash: String(row.after_hash) } : {}),
    status: row.status as FileChangeRecord["status"],
    ...(row.result_json ? { result: JSON.parse(String(row.result_json)) as unknown } : {}),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function saveVaultState(state: PersistedVaultState, expectedRevision?: number): VaultStateRecord {
  const db = getDatabase();
  const taskError = validateTaskDependencies(state.tasks as Array<{ id: string; dependsOn?: string[]; status: string }>);
  if (taskError) throw new VaultStateValidationError(taskError);
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db.prepare("SELECT revision FROM vault_state WHERE id = ?").get("default") as { revision?: number } | undefined;
    const currentRevision = current?.revision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new VaultStateConflictError(currentRevision);
    }
    const revision = currentRevision + 1;
    const updatedAt = new Date().toISOString();
    const projectedState = projectVaultState(state);
    db.prepare(`
      INSERT INTO vault_state (id, state_json, revision, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state_json = excluded.state_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run("default", JSON.stringify(projectedState), revision, updatedAt);
    db.exec("COMMIT");
    return { state: projectedState, revision, updatedAt };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function projectVaultState(state: PersistedVaultState): PersistedVaultState {
  return { ...state, tasks: projectTaskRuns(state.tasks as ProjectableTask[], listTaskRuns()) };
}

export function executeTaskBoardCommand(idempotencyKey: string, command: TaskBoardCommand): { record: VaultStateRecord; task: BoardTask; cancelledRun?: TaskRunRecord; replayed: boolean } {
  if (!/^[a-zA-Z0-9_-]{8,120}$/u.test(idempotencyKey)) throw new TaskCommandConflictError("A valid idempotency key is required.");
  const db = getDatabase();
  const commandJson = JSON.stringify(command);
  db.exec("BEGIN IMMEDIATE");
  try {
    const prior = db.prepare("SELECT command_json, response_json FROM task_commands WHERE idempotency_key = ?").get(idempotencyKey) as { command_json: string; response_json: string } | undefined;
    if (prior) {
      if (prior.command_json !== commandJson) throw new TaskCommandConflictError("This idempotency key was already used for another task action.");
      const response = JSON.parse(prior.response_json) as { task: BoardTask; cancelledRun?: TaskRunRecord };
      const record = getVaultState();
      if (!record) throw new Error("The vault state is unavailable.");
      db.exec("COMMIT");
      return { ...response, record, replayed: true };
    }
    const current = getVaultState();
    if (!current) throw new TaskCommandConflictError("The vault has not been initialized yet.");
    const result = applyTaskBoardCommand(current.state.tasks as BoardTask[], listTaskRuns(), command);
    const cancelledRun = result.cancelRun ? cancelTaskRun(result.cancelRun.taskId, result.cancelRun.taskRevision) : undefined;
    const nextState = projectVaultState({ ...current.state, tasks: result.tasks });
    const revision = current.revision + 1;
    const updatedAt = new Date().toISOString();
    db.prepare("UPDATE vault_state SET state_json = ?, revision = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(nextState), revision, updatedAt, "default");
    const response = { task: result.task, ...(cancelledRun ? { cancelledRun } : {}) };
    db.prepare("INSERT INTO task_commands (idempotency_key, command_json, response_json, created_at) VALUES (?, ?, ?, ?)").run(idempotencyKey, commandJson, JSON.stringify(response), updatedAt);
    db.exec("COMMIT");
    return { ...response, record: { state: nextState, revision, updatedAt }, replayed: false };
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

export function claimTaskRun(taskId: string, taskRevision: number, agentId: string): TaskRunRecord {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = getVaultState()?.state;
    const tasks = (state?.tasks ?? []) as Array<{ id: string; assigneeId: string; assigneeType: string; status: string; revision?: number; dependsOn?: string[] }>;
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.assigneeType !== "agent" || task.assigneeId !== agentId || (task.revision ?? 0) !== taskRevision) {
      throw new TaskClaimError("The saved task assignment or revision does not match this claim.");
    }
    if (task.status !== "queued" && task.status !== "active") throw new TaskClaimError("This task is not ready to run.");
    const waitingFor = unmetTaskDependencies(task, tasks).filter((id) => {
      const dependency = tasks.find((candidate) => candidate.id === id);
      const run = readTaskRun(db, id);
      return !dependency || !run || run.status !== "completed" || run.taskRevision !== (dependency.revision ?? 0);
    });
    if (waitingFor.length > 0) throw new TaskClaimError(`Waiting for prerequisites: ${waitingFor.join(", ")}.`);
    const current = readTaskRun(db, taskId);
    const timeoutMs = getVaultSettings().taskTimeoutMinutes * 60_000;
    const activeRunIsFresh = current?.status === "active" && Date.now() - Date.parse(current.updatedAt) < timeoutMs;
    if (current && current.taskRevision === taskRevision && activeRunIsFresh) throw new TaskClaimError("Another runner already owns this task.");
    if (current && current.taskRevision === taskRevision && (current.status === "completed" || current.status === "blocked" || current.status === "cancelled")) throw new TaskClaimError("This run is already finished. Retry with a new task revision.");
    if (current && current.taskRevision === taskRevision && current.attempt >= getVaultSettings().maxTaskAttempts) throw new TaskClaimError("This task has reached its maximum attempt count.");
    const now = new Date().toISOString();
    const record: TaskRunRecord = {
      taskId,
      taskRevision,
      agentId,
      status: "active",
      attempt: current?.taskRevision === taskRevision ? current.attempt + 1 : 1,
      startedAt: now,
      updatedAt: now,
    };
    db.prepare(`
      INSERT INTO task_runs (task_id, task_revision, agent_id, status, attempt, result, error, eve_session_id, started_at, finished_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        task_revision = excluded.task_revision,
        agent_id = excluded.agent_id,
        status = excluded.status,
        attempt = excluded.attempt,
        result = NULL,
        error = NULL,
        eve_session_id = NULL,
        started_at = excluded.started_at,
        finished_at = NULL,
        updated_at = excluded.updated_at
    `).run(record.taskId, record.taskRevision, record.agentId, record.status, record.attempt, record.startedAt, record.updatedAt);
    db.exec("COMMIT");
    return record;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function attachTaskRunSession(taskId: string, taskRevision: number, attempt: number, eveSessionId: string): TaskRunRecord | undefined {
  const db = getDatabase();
  const updatedAt = new Date().toISOString();
  const updated = db.prepare("UPDATE task_runs SET eve_session_id = ?, updated_at = ? WHERE task_id = ? AND task_revision = ? AND attempt = ? AND status = 'active'").run(eveSessionId, updatedAt, taskId, taskRevision, attempt);
  return updated.changes === 1 ? readTaskRun(db, taskId) : undefined;
}

export function heartbeatTaskRun(taskId: string, taskRevision: number, attempt: number): boolean {
  const updated = getDatabase().prepare("UPDATE task_runs SET updated_at = ? WHERE task_id = ? AND task_revision = ? AND attempt = ? AND status = 'active'").run(new Date().toISOString(), taskId, taskRevision, attempt);
  return updated.changes === 1;
}

export function cancelTaskRun(taskId: string, taskRevision: number): TaskRunRecord | undefined {
  const db = getDatabase();
  const current = readTaskRun(db, taskId);
  if (!current || current.taskRevision !== taskRevision || current.status !== "active") return undefined;
  const now = new Date().toISOString();
  const updated = db.prepare("UPDATE task_runs SET status = ?, finished_at = ?, updated_at = ? WHERE task_id = ? AND task_revision = ? AND attempt = ? AND status = 'active'").run("cancelled", now, now, taskId, taskRevision, current.attempt);
  if (updated.changes !== 1) return undefined;
  return { ...current, status: "cancelled", finishedAt: now, updatedAt: now };
}

export function finishTaskRun(taskId: string, taskRevision: number, attempt: number, outcome: { status: "completed"; result: string } | { status: "failed"; error: string }): TaskRunRecord | undefined {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = readTaskRun(db, taskId);
    if (!current || current.taskRevision !== taskRevision || current.attempt !== attempt || current.status !== "active") {
      db.exec("ROLLBACK");
      return undefined;
    }
    const now = new Date().toISOString();
    const status = outcome.status === "failed" && current.attempt >= getVaultSettings().maxTaskAttempts ? "blocked" : outcome.status;
    db.prepare("UPDATE task_runs SET status = ?, result = ?, error = ?, finished_at = ?, updated_at = ? WHERE task_id = ?").run(status, outcome.status === "completed" ? outcome.result : null, outcome.status === "failed" ? outcome.error : null, now, now, taskId);
    db.exec("COMMIT");
    return { ...current, status, ...(outcome.status === "completed" ? { result: outcome.result } : { error: outcome.error }), finishedAt: now, updatedAt: now };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function completeAssignedRoomTasks(taskIds: string[], roomId: string, agentId: string, result: string): { runs: TaskRunRecord[]; skippedTaskIds: string[] } {
  if (!taskIds.length || taskIds.length > 12 || new Set(taskIds).size !== taskIds.length || taskIds.some((id) => !/^[a-zA-Z0-9_-]{1,160}$/u.test(id))) throw new TaskClaimError("The room result needs distinct valid task ids.");
  if (!/^[a-zA-Z0-9_-]{1,160}$/u.test(roomId) || !/^[a-zA-Z0-9_-]{1,100}$/u.test(agentId)) throw new TaskClaimError("The room and agent ids are invalid.");
  const trimmedResult = result.trim();
  if (!trimmedResult || trimmedResult.length > 50_000) throw new TaskClaimError("The room result must contain bounded text.");

  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = getVaultState()?.state;
    const tasks = (state?.tasks ?? []) as Array<{ id: string; assigneeId: string; assigneeType: string; roomId?: string; status: string; revision?: number; dependsOn?: string[] }>;
    const assignedTasks = taskIds.map((taskId) => tasks.find((task) => task.id === taskId));
    if (assignedTasks.some((task) => !task || task.roomId !== roomId || task.assigneeType !== "agent" || task.assigneeId !== agentId)) throw new TaskClaimError("The saved room task assignment does not match this result.");

    const runs: TaskRunRecord[] = [];
    const skippedTaskIds: string[] = [];
    for (const task of assignedTasks) {
      if (!task) continue;
      const revision = task.revision ?? 0;
      const current = readTaskRun(db, task.id);
      if (current?.taskRevision === revision && current.status === "completed" && current.agentId === agentId && current.result === trimmedResult) {
        runs.push(current);
        continue;
      }
      if (task.status !== "queued" || current?.taskRevision === revision && current.status === "active") {
        skippedTaskIds.push(task.id);
        continue;
      }
      const waitingFor = unmetTaskDependencies(task, tasks).filter((id) => {
        const dependency = tasks.find((candidate) => candidate.id === id);
        const dependencyRun = readTaskRun(db, id);
        return !dependency || !dependencyRun || dependencyRun.status !== "completed" || dependencyRun.taskRevision !== (dependency.revision ?? 0);
      });
      if (waitingFor.length > 0) {
        skippedTaskIds.push(task.id);
        continue;
      }
      const now = new Date().toISOString();
      const run: TaskRunRecord = {
        taskId: task.id,
        taskRevision: revision,
        agentId,
        status: "completed",
        attempt: current?.taskRevision === revision ? current.attempt + 1 : 1,
        result: trimmedResult,
        startedAt: now,
        finishedAt: now,
        updatedAt: now,
      };
      db.prepare(`
        INSERT INTO task_runs (task_id, task_revision, agent_id, status, attempt, result, error, eve_session_id, started_at, finished_at, updated_at)
        VALUES (?, ?, ?, 'completed', ?, ?, NULL, NULL, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          task_revision = excluded.task_revision,
          agent_id = excluded.agent_id,
          status = excluded.status,
          attempt = excluded.attempt,
          result = excluded.result,
          error = NULL,
          eve_session_id = NULL,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          updated_at = excluded.updated_at
      `).run(run.taskId, run.taskRevision, run.agentId, run.attempt, trimmedResult, run.startedAt, now, run.updatedAt);
      runs.push(run);
    }
    db.exec("COMMIT");
    return { runs, skippedTaskIds };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listTaskRuns(): TaskRunRecord[] {
  return getDatabase().prepare("SELECT task_id, task_revision, agent_id, status, attempt, result, error, eve_session_id, started_at, finished_at, updated_at FROM task_runs ORDER BY updated_at DESC").all().flatMap((row) => parseTaskRunRow(row as Record<string, unknown>) ?? []);
}

export function replaceTaskRuns(runs: TaskRunRecord[]): void {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM task_runs");
    insertTaskRuns(db, runs);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function restoreVaultStateWithRuns(state: PersistedVaultState, runs: TaskRunRecord[], fileChanges: FileChangeRecord[] = []): VaultStateRecord {
  const taskError = validateTaskDependencies(state.tasks as Array<{ id: string; status: string; dependsOn?: string[] }>);
  if (taskError) throw new VaultStateValidationError(taskError);
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db.prepare("SELECT revision FROM vault_state WHERE id = ?").get("default") as { revision?: number } | undefined;
    const revision = (current?.revision ?? 0) + 1;
    // Imported state starts a new command history; stale responses must never replay.
    db.exec("DELETE FROM task_commands");
    db.exec("DELETE FROM task_worktrees");
    db.exec("DELETE FROM file_changes");
    db.exec("DELETE FROM task_runs");
    insertTaskRuns(db, runs);
    const insertChange = db.prepare("INSERT INTO file_changes (operation_id, task_id, task_revision, agent_id, eve_session_id, action, path, before_hash, after_hash, status, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const change of fileChanges) insertChange.run(change.operationId, change.taskId, change.taskRevision, change.agentId, change.eveSessionId, change.action, change.path, change.beforeHash ?? null, change.afterHash ?? null, change.status, change.result === undefined ? null : JSON.stringify(change.result), change.createdAt, change.updatedAt);
    const projectedState = projectVaultState(state);
    const updatedAt = new Date().toISOString();
    db.prepare("INSERT INTO vault_state (id, state_json, revision, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, revision = excluded.revision, updated_at = excluded.updated_at").run("default", JSON.stringify(projectedState), revision, updatedAt);
    db.exec("COMMIT");
    return { state: projectedState, revision, updatedAt };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function insertTaskRuns(db: DatabaseSync, runs: TaskRunRecord[]): void {
  const insert = db.prepare("INSERT INTO task_runs (task_id, task_revision, agent_id, status, attempt, result, error, eve_session_id, started_at, finished_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const run of runs) insert.run(run.taskId, run.taskRevision, run.agentId, run.status, run.attempt, run.result ?? null, run.error ?? null, run.eveSessionId ?? null, run.startedAt, run.finishedAt ?? null, run.updatedAt);
}

export function getVaultSettings(): VaultSettings {
  const row = getDatabase().prepare("SELECT settings_json FROM vault_settings WHERE id = ?").get("default") as { settings_json?: string } | undefined;
  if (!row?.settings_json) return defaultVaultSettings();
  try {
    return normalizeVaultSettings(JSON.parse(row.settings_json));
  } catch {
    return defaultVaultSettings();
  }
}

export function saveVaultSettings(settings: VaultSettings): VaultSettings {
  const normalized = normalizeVaultSettings(settings);
  getDatabase().prepare(`
    INSERT INTO vault_settings (id, settings_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at
  `).run("default", JSON.stringify(normalized), new Date().toISOString());
  return normalized;
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
  applyMigration(database, 4, "task-run-ledger", `
    CREATE TABLE IF NOT EXISTS task_runs (
      task_id TEXT PRIMARY KEY,
      task_revision INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      result TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  applyMigration(database, 5, "vault-settings", `
    CREATE TABLE IF NOT EXISTS vault_settings (
      id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  applyMigration(database, 6, "task-eve-session", `
    ALTER TABLE task_runs ADD COLUMN eve_session_id TEXT;
  `);
  applyMigration(database, 7, "task-board-commands", `
    CREATE TABLE IF NOT EXISTS task_commands (
      idempotency_key TEXT PRIMARY KEY,
      command_json TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  applyMigration(database, 8, "workspace-file-changes", `
    CREATE TABLE IF NOT EXISTS file_changes (
      operation_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_revision INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      eve_session_id TEXT NOT NULL,
      action TEXT NOT NULL,
      path TEXT NOT NULL,
      before_hash TEXT,
      after_hash TEXT,
      status TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS file_changes_task_idx ON file_changes(task_id, created_at);
    CREATE INDEX IF NOT EXISTS task_runs_session_idx ON task_runs(eve_session_id);
  `);
  applyMigration(database, 9, "task-worktrees", `
    CREATE TABLE IF NOT EXISTS task_worktrees (
      task_id TEXT NOT NULL,
      task_revision INTEGER NOT NULL,
      source_root TEXT NOT NULL,
      worktree_root TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (task_id, task_revision)
    );
  `);
  return database;
}

function defaultVaultSettings(): VaultSettings {
  return {
    workspaceName: "Agent Vault",
    defaultModel: "chatgpt-subscription",
    ollamaHost: "http://127.0.0.1:11434",
    maxTaskAttempts: 3,
    taskTimeoutMinutes: 30,
    backupIntervalMs: 21_600_000,
    confirmationMode: "risky-actions",
  };
}

function normalizeVaultSettings(value: unknown): VaultSettings {
  const defaults = defaultVaultSettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<VaultSettings>;
  return {
    workspaceName: typeof candidate.workspaceName === "string" && candidate.workspaceName.trim().length > 0 ? candidate.workspaceName.trim().slice(0, 80) : defaults.workspaceName,
    defaultModel: candidate.defaultModel === "ollama" ? "ollama" : defaults.defaultModel,
    ollamaHost: typeof candidate.ollamaHost === "string" && candidate.ollamaHost.trim().length > 0 ? candidate.ollamaHost.trim().slice(0, 200) : defaults.ollamaHost,
    maxTaskAttempts: integerInRange(candidate.maxTaskAttempts, 1, 10, defaults.maxTaskAttempts),
    taskTimeoutMinutes: integerInRange(candidate.taskTimeoutMinutes, 1, 240, defaults.taskTimeoutMinutes),
    backupIntervalMs: integerInRange(candidate.backupIntervalMs, 60_000, 604_800_000, defaults.backupIntervalMs),
    confirmationMode: candidate.confirmationMode === "all-actions" ? "all-actions" : defaults.confirmationMode,
  };
}

function integerInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function readTaskRun(db: DatabaseSync, taskId: string): TaskRunRecord | undefined {
  const row = db.prepare("SELECT task_id, task_revision, agent_id, status, attempt, result, error, eve_session_id, started_at, finished_at, updated_at FROM task_runs WHERE task_id = ?").get(taskId) as Record<string, unknown> | undefined;
  return row ? parseTaskRunRow(row) : undefined;
}

function parseTaskRunRow(row: Record<string, unknown>): TaskRunRecord | undefined {
  if (!row || typeof row.task_id !== "string" || typeof row.task_revision !== "number" || typeof row.agent_id !== "string" || typeof row.status !== "string" || typeof row.attempt !== "number" || typeof row.started_at !== "string" || typeof row.updated_at !== "string") return undefined;
  if (row.status !== "active" && row.status !== "completed" && row.status !== "failed" && row.status !== "blocked" && row.status !== "cancelled") return undefined;
  return {
    taskId: row.task_id,
    taskRevision: row.task_revision,
    agentId: row.agent_id,
    status: row.status,
    attempt: row.attempt,
    ...(typeof row.result === "string" ? { result: row.result } : {}),
    ...(typeof row.error === "string" ? { error: row.error } : {}),
    ...(typeof row.eve_session_id === "string" ? { eveSessionId: row.eve_session_id } : {}),
    startedAt: row.started_at,
    ...(typeof row.finished_at === "string" ? { finishedAt: row.finished_at } : {}),
    updatedAt: row.updated_at,
  };
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
