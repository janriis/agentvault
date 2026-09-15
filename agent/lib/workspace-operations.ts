import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { beginFileChange, finishFileChange, getActiveTaskRunBySession, getFileChange, getTaskWorktree, getVaultState, saveTaskWorktree, type TaskRunRecord } from "./vault-database.ts";
import { getSelectedWorkspaceDirectory } from "./workspace-store.ts";

const execFile = promisify(execFileCallback);
const hiddenOrManaged = new Set([".git", ".data", ".eve", "node_modules", ".env", ".env.local", ".env.production"]);
const maxTextBytes = 1_000_000;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export type WorkspaceAction =
  | { action: "read"; file: string }
  | { action: "search"; folder: string; query: string }
  | { action: "diff"; file: string; proposedContent: string }
  | { action: "write"; file: string; content: string; expectedSha256: string | null }
  | { action: "patch"; file: string; find: string; replace: string; expectedSha256: string }
  | { action: "move"; file: string; destination: string; expectedSha256: string }
  | { action: "test"; script: "test:unit" | "typecheck" };

interface AgentScope { id: string; tools: string[]; permissions: string[]; allowedFolders?: string[] }
interface TaskScope { id: string; revision?: number; assigneeId: string; assigneeType: string }
interface WorkspaceAccess { run: TaskRunRecord; agent: AgentScope; root: string; allowedFolders: string[] }

function assertActiveAttempt(access: WorkspaceAccess): void {
  const current = getActiveTaskRunBySession(access.run.eveSessionId!);
  if (!current || current.taskId !== access.run.taskId || current.taskRevision !== access.run.taskRevision || current.attempt !== access.run.attempt) throw new Error("The assigned task attempt stopped before this file operation finished.");
}

export function cleanWorkspaceRelativePath(value: string, allowRoot = false): string {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value) || /^[a-zA-Z]:/u.test(value)) throw new Error("Use a project-relative workspace path.");
  const parts = value.split("/");
  if (parts.some((part) => part === ".." || part === "" || part.startsWith(".") && part !== "." || hiddenOrManaged.has(part))) throw new Error("That path is outside the allowed workspace files.");
  const normalized = path.posix.normalize(value);
  if (normalized === "." && !allowRoot) throw new Error("Choose a file path, not the workspace root.");
  return normalized;
}

export async function resolveWorkspaceAccess(eveSessionId: string, requiredPermission: "Read workspace" | "Write workspace"): Promise<WorkspaceAccess> {
  const run = getActiveTaskRunBySession(eveSessionId);
  const state = getVaultState()?.state;
  const task = (state?.tasks as TaskScope[] | undefined)?.find((item) => item.id === run?.taskId);
  const agent = (state?.agents as AgentScope[] | undefined)?.find((item) => item.id === run?.agentId);
  if (!run || !task || !agent || task.assigneeType !== "agent" || task.assigneeId !== agent.id || (task.revision ?? 0) !== run.taskRevision) throw new Error("Host files are available only to an active, assigned EVE task session.");
  if (!agent.tools?.includes("File workspace") || !agent.permissions?.includes(requiredPermission)) throw new Error(`This agent lacks ${requiredPermission.toLowerCase()} permission or the File workspace tool.`);
  const allowedFolders = (agent.allowedFolders?.length ? agent.allowedFolders : ["."]).map((folder) => cleanWorkspaceRelativePath(folder, true));
  const selectedRoot = await realpath(await getSelectedWorkspaceDirectory());
  const worktree = getTaskWorktree(run.taskId, run.taskRevision);
  if (worktree && worktree.sourceRoot !== selectedRoot) throw new Error("The selected workspace changed after this task's worktree was created.");
  const root = worktree ? await realpath(worktree.worktreeRoot) : selectedRoot;
  return { run, agent, root, allowedFolders };
}

export async function beginWorkspaceWorktree(eveSessionId: string, operationId: string): Promise<{ taskId: string; sourceRoot: string; worktreeRoot: string; warning: string }> {
  const access = await resolveWorkspaceAccess(eveSessionId, "Write workspace");
  const sourceRoot = await realpath(await getSelectedWorkspaceDirectory());
  const existing = getTaskWorktree(access.run.taskId, access.run.taskRevision);
  if (existing) return { taskId: existing.taskId, sourceRoot: existing.sourceRoot, worktreeRoot: existing.worktreeRoot, warning: "This checkout began at HEAD; uncommitted source changes were not copied." };
  const repo = (await execFile("git", ["-C", sourceRoot, "rev-parse", "--show-toplevel"], { timeout: 10_000 })).stdout.trim();
  if (await realpath(repo) !== sourceRoot) throw new Error("Select the Git repository root before creating an isolated task worktree.");
  const data = process.env.AGENT_VAULT_DATA_DIR ?? path.join(process.cwd(), ".data");
  const base = path.join(data, "worktrees");
  await mkdir(base, { recursive: true });
  const worktreeRoot = path.join(base, `${access.run.taskId}-r${access.run.taskRevision}-${randomUUID()}`);
  return auditedMutation(access, operationId, "worktree", worktreeRoot, undefined, async () => {
    assertActiveAttempt(access);
    await execFile("git", ["-C", sourceRoot, "worktree", "add", "--detach", worktreeRoot, "HEAD"], { timeout: 120_000, maxBuffer: 20_000 });
    saveTaskWorktree({ taskId: access.run.taskId, taskRevision: access.run.taskRevision, sourceRoot, worktreeRoot, createdAt: new Date().toISOString() });
    return { taskId: access.run.taskId, sourceRoot, worktreeRoot, warning: "This checkout began at HEAD; uncommitted source changes were not copied." };
  });
}

async function safePath(access: WorkspaceAccess, relative: string, allowRoot = false): Promise<{ relative: string; absolute: string }> {
  const clean = cleanWorkspaceRelativePath(relative, allowRoot);
  if (!(allowRoot && clean === ".") && !access.allowedFolders.some((folder) => folder === "." || clean === folder || clean.startsWith(`${folder}/`))) throw new Error("This path is outside the agent's allowed folders.");
  const absolute = path.resolve(access.root, clean);
  const fromRoot = path.relative(access.root, absolute);
  if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`)) throw new Error("This path escapes the selected workspace.");
  let current = access.root;
  for (const part of clean === "." ? [] : clean.split("/")) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Workspace symlinks are not available to agents.");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return { relative: clean, absolute };
}

async function readText(absolute: string): Promise<string> {
  const file = await lstat(absolute);
  if (!file.isFile() || file.size > maxTextBytes) throw new Error("Only text files up to 1 MB can be read through this tool.");
  return readFile(absolute, "utf8");
}

function smallDiff(before: string, after: string): { changed: boolean; preview: string } {
  if (before === after) return { changed: false, preview: "No changes." };
  const left = before.split("\n");
  const right = after.split("\n");
  let prefix = 0;
  while (prefix < Math.min(left.length, right.length) && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < Math.min(left.length - prefix, right.length - prefix) && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;
  const removed = left.slice(prefix, left.length - suffix).slice(0, 20).map((line) => `- ${line}`);
  const added = right.slice(prefix, right.length - suffix).slice(0, 20).map((line) => `+ ${line}`);
  return { changed: true, preview: [`@@ line ${prefix + 1} @@`, ...removed, ...added].join("\n").slice(0, 5000) };
}

async function saveBackup(access: WorkspaceAccess, absolute: string, operationId: string): Promise<void> {
  const data = process.env.AGENT_VAULT_DATA_DIR ?? path.join(process.cwd(), ".data");
  const backupDir = path.join(data, "file-backups");
  await mkdir(backupDir, { recursive: true });
  await copyFile(absolute, path.join(backupDir, `${hash(`${access.run.taskId}:${operationId}`)}.bak`), constants.COPYFILE_EXCL);
}

async function auditedMutation<T extends Record<string, unknown>>(access: WorkspaceAccess, operationId: string, action: string, relative: string, beforeHash: string | undefined, perform: () => Promise<T>): Promise<T> {
  const key = `${access.run.eveSessionId}:${operationId}`;
  const prior = getFileChange(key);
  if (prior) {
    if (prior.taskId !== access.run.taskId || prior.action !== action || prior.path !== relative) throw new Error("This file operation id was reused for different work.");
    if (prior.status === "completed") return prior.result as T;
    throw new Error("This file operation was interrupted or failed. Inspect its audit record before retrying with a new call.");
  }
  beginFileChange({ operationId: key, taskId: access.run.taskId, taskRevision: access.run.taskRevision, agentId: access.agent.id, eveSessionId: access.run.eveSessionId!, action, path: relative, ...(beforeHash ? { beforeHash } : {}) });
  try {
    assertActiveAttempt(access);
    const result = await perform();
    finishFileChange(key, "completed", result, typeof result.sha256 === "string" ? result.sha256 : undefined);
    return result;
  } catch (error) {
    finishFileChange(key, "failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function replayCompleted(access: WorkspaceAccess, operationId: string, action: string, relative: string): Record<string, unknown> | undefined {
  const prior = getFileChange(`${access.run.eveSessionId}:${operationId}`);
  if (!prior) return undefined;
  if (prior.taskId !== access.run.taskId || prior.action !== action || prior.path !== relative) throw new Error("This file operation id was reused for different work.");
  if (prior.status !== "completed") throw new Error("This file operation was interrupted or failed. Inspect its audit record before retrying with a new call.");
  return prior.result as Record<string, unknown>;
}

export async function runWorkspaceOperation(eveSessionId: string, operationId: string, input: WorkspaceAction): Promise<Record<string, unknown>> {
  const mutation = input.action === "write" || input.action === "patch" || input.action === "move" || input.action === "test";
  const access = await resolveWorkspaceAccess(eveSessionId, mutation ? "Write workspace" : "Read workspace");
  if (input.action === "read") {
    const file = await safePath(access, input.file);
    const content = await readText(file.absolute);
    return { file: file.relative, content, sha256: hash(content) };
  }
  if (input.action === "diff") {
    const file = await safePath(access, input.file);
    const before = await readText(file.absolute);
    return { file: file.relative, beforeSha256: hash(before), proposedSha256: hash(input.proposedContent), ...smallDiff(before, input.proposedContent) };
  }
  if (input.action === "search") {
    const folder = await safePath(access, input.folder, true);
    const hits: Array<{ file: string; line: number; text: string }> = [];
    let visited = 0;
    const visit = async (absolute: string, relative: string) => {
      if (visited >= 400 || hits.length >= 80) return;
      for (const entry of await readdir(absolute, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || hiddenOrManaged.has(entry.name) || entry.isSymbolicLink()) continue;
        const childRelative = relative === "." ? entry.name : `${relative}/${entry.name}`;
        if (!access.allowedFolders.some((allowed) => allowed === "." || childRelative === allowed || childRelative.startsWith(`${allowed}/`) || allowed.startsWith(`${childRelative}/`))) continue;
        const child = path.join(absolute, entry.name);
        if (entry.isDirectory()) await visit(child, childRelative);
        else if (entry.isFile()) {
          visited += 1;
          if ((await lstat(child)).size > 250_000) continue;
          const lines = (await readFile(child, "utf8")).split("\n");
          for (let line = 0; line < lines.length && hits.length < 80; line += 1) if (lines[line].includes(input.query)) hits.push({ file: childRelative, line: line + 1, text: lines[line].slice(0, 300) });
        }
      }
    };
    await visit(folder.absolute, folder.relative);
    return { query: input.query, hits, scannedFiles: visited, truncated: visited >= 400 || hits.length >= 80 };
  }
  if (input.action === "test") {
    if (input.script !== "test:unit" && input.script !== "typecheck") throw new Error("Only the allowlisted test scripts can be run.");
    const replay = replayCompleted(access, operationId, "test", input.script);
    if (replay) return replay;
    const packageFile = await safePath(access, "package.json");
    const packageJson = JSON.parse(await readText(packageFile.absolute)) as { scripts?: Record<string, string> };
    if (!packageJson.scripts?.[input.script]) throw new Error("That test script is not declared in the selected workspace.");
    return auditedMutation(access, operationId, "test", input.script, undefined, async () => {
      try {
        const result = await execFile("npm", ["run", input.script], { cwd: access.root, timeout: 120_000, maxBuffer: 100_000 });
        return { script: input.script, exitCode: 0, output: `${result.stdout}\n${result.stderr}`.slice(-20_000) };
      } catch (error) {
        const detail = error as { stdout?: string; stderr?: string; code?: number };
        return { script: input.script, exitCode: typeof detail.code === "number" ? detail.code : 1, output: `${detail.stdout ?? ""}\n${detail.stderr ?? ""}`.slice(-20_000) };
      }
    });
  }
  const file = await safePath(access, input.file);
  if (input.action === "write" || input.action === "patch") {
    const replay = replayCompleted(access, operationId, input.action, file.relative);
    if (replay) return replay;
  }
  if (input.action === "move") {
    const destination = await safePath(access, input.destination);
    const replay = replayCompleted(access, operationId, "move", `${file.relative} -> ${destination.relative}`);
    if (replay) return replay;
  }
  const before = input.action === "write" && input.expectedSha256 === null ? undefined : await readText(file.absolute);
  const beforeHash = before === undefined ? undefined : hash(before);
  if (input.action === "write" && input.expectedSha256 !== (beforeHash ?? null)) throw new Error("The file changed; read it again before writing.");
  if ((input.action === "patch" || input.action === "move") && input.expectedSha256 !== beforeHash) throw new Error("The file changed; read it again before editing.");
  if (input.action === "move") {
    const destination = await safePath(access, input.destination);
    if (destination.relative === file.relative) throw new Error("Choose a different destination.");
    try { await lstat(destination.absolute); throw new Error("The destination already exists."); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    return auditedMutation(access, operationId, "move", `${file.relative} -> ${destination.relative}`, beforeHash, async () => {
      await saveBackup(access, file.absolute, operationId);
      assertActiveAttempt(access);
      if (hash(await readText(file.absolute)) !== beforeHash) throw new Error("The source file changed during this move.");
      if (await realpath(path.dirname(destination.absolute)) !== path.dirname(destination.absolute)) throw new Error("The destination parent changed during this operation.");
      await link(file.absolute, destination.absolute);
      await unlink(file.absolute);
      return { file: file.relative, destination: destination.relative, sha256: beforeHash };
    });
  }
  let content: string;
  if (input.action === "patch") {
    if (!input.find || !before || before.split(input.find).length !== 2) throw new Error("The patch must match exactly one non-empty passage.");
    content = before.replace(input.find, input.replace);
  } else content = input.content;
  if (Buffer.byteLength(content, "utf8") > maxTextBytes) throw new Error("Workspace writes are limited to 1 MB of text.");
  return auditedMutation(access, operationId, input.action, file.relative, beforeHash, async () => {
    const parent = path.dirname(file.absolute);
    if ((await realpath(parent)) !== parent) throw new Error("The destination parent changed during this operation.");
    if (before !== undefined) await saveBackup(access, file.absolute, operationId);
    const temporary = path.join(parent, `.vault-${randomUUID()}.tmp`);
    const mode = before === undefined ? 0o600 : (await lstat(file.absolute)).mode & 0o777;
    await writeFile(temporary, content, { flag: "wx", mode });
    try {
      assertActiveAttempt(access);
      if (before === undefined) {
        await link(temporary, file.absolute);
        await unlink(temporary);
      } else {
        if (hash(await readText(file.absolute)) !== beforeHash) throw new Error("The file changed during this operation.");
        await rename(temporary, file.absolute);
      }
    } finally { await unlink(temporary).catch(() => undefined); }
    return { file: file.relative, sha256: hash(content), diff: smallDiff(before ?? "", content).preview };
  });
}
