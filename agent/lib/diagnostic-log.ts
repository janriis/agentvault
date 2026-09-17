import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

type DiagnosticValue = string | number | boolean | null | undefined;
type DiagnosticFields = Record<string, DiagnosticValue>;

const privateField = /(?:prompt|message|content|body|token|secret|password|key)/iu;
let reportedWriteFailure = false;

export function diagnosticLogPath(dataDirectory = process.env.AGENT_VAULT_DATA_DIR ?? path.join(process.cwd(), ".data"), now = new Date()): string {
  return path.join(dataDirectory, "logs", `activity-${now.toISOString().slice(0, 10)}.jsonl`);
}

export function formatDiagnosticEvent(component: string, event: string, fields: DiagnosticFields = {}, now = new Date()): string {
  const safeFields: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/u.test(key) || privateField.test(key) || value === undefined) continue;
    if (typeof value === "string") safeFields[key] = value.replace(/[\r\n\t]/gu, " ").slice(0, 160);
    else if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) safeFields[key] = value;
  }
  return JSON.stringify({ at: now.toISOString(), component, event, pid: process.pid, ...safeFields });
}

export function diagnosticErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code.slice(0, 60);
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /\b(ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|EPIPE)\b/u.exec(message)?.[1] ?? "UNKNOWN";
}

export function diagnosticLog(component: string, event: string, fields: DiagnosticFields = {}): void {
  const now = new Date();
  const line = formatDiagnosticEvent(component, event, fields, now);
  const safe = JSON.parse(line) as Record<string, string | number | boolean | null>;
  try {
    const filePath = diagnosticLogPath(undefined, now);
    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    if (!reportedWriteFailure) {
      reportedWriteFailure = true;
      process.stderr.write(`[vault:diagnostics] Log file unavailable (${diagnosticErrorCode(error)}); continuing with terminal output.\n`);
    }
  }
  const details = Object.entries(safe).filter(([key]) => !["at", "component", "event", "pid"].includes(key))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ");
  process.stdout.write(`[vault:${component} ${now.toISOString()}] ${event}${details ? ` ${details}` : ""}\n`);
}
