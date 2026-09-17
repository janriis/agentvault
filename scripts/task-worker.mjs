import { Client } from "eve/client";
import { setTimeout as delay } from "node:timers/promises";
import { buildWorkerTaskPrompt, classifyTaskSessionEvents, findRunnableJobs, lastTaskInputResolvedAt, runWorkerJob, taskAgentRoute, taskSessionExpired, workerModelContext } from "../agent/lib/task-orchestration.ts";
import { attachTaskRunSession, finishTaskRun, getVaultSettings, getVaultState, heartbeatTaskRun, listTaskRuns } from "../agent/lib/vault-database.ts";
import { diagnosticErrorCode, diagnosticLog } from "../agent/lib/diagnostic-log.ts";
import { discoverOllamaModels } from "../agent/lib/ollama-discovery.ts";

const hostArg = process.argv.indexOf("--host");
const host = hostArg >= 0 ? process.argv[hostArg + 1] : process.env.AGENT_VAULT_APP_URL;
if (!host || !/^https?:\/\/[^/]+$/u.test(host)) {
  process.stderr.write("Set AGENT_VAULT_APP_URL or pass --host http://127.0.0.1:3001.\n");
  process.exit(2);
}

let stopping = false;
process.on("SIGINT", () => { stopping = true; diagnosticLog("worker", "stopping", { signal: "SIGINT" }); });
process.on("SIGTERM", () => { stopping = true; diagnosticLog("worker", "stopping", { signal: "SIGTERM" }); });

const observedTaskStates = new Map();
const lastHealthFailure = new Map();
let lastScanSignature = "";
let lastScanLoggedAt = 0;
let lastScanFailureAt = 0;
let lastModelCheckAt = 0;
let lastModelStatus = "";

async function checkLocalModel(now) {
  const settings = getVaultSettings();
  if (settings.defaultModel !== "ollama" || now - lastModelCheckAt < 60_000) return;
  lastModelCheckAt = now;
  const discovery = await discoverOllamaModels(settings.ollamaHost);
  const status = discovery.errors.length > 0 ? "unavailable" : discovery.models.length === 0 ? "no_models" :
    !discovery.models.some((model) => model.id === settings.defaultOllamaModel) ? "selected_model_missing" : "ready";
  const signature = `${status}:${settings.defaultOllamaModel}`;
  if (signature !== lastModelStatus) {
    diagnosticLog("worker", "model_status", { provider: "ollama", status, model: settings.defaultOllamaModel || "not_selected", installed: discovery.models.length });
    lastModelStatus = signature;
  }
}

function logTaskState(job, state, fields = {}) {
  const signature = `${state}:${job.previousRun?.attempt ?? 0}:${job.previousRun?.eveSessionId ?? ""}`;
  if (observedTaskStates.get(job.task.id) === signature) return;
  observedTaskStates.set(job.task.id, signature);
  diagnosticLog("worker", state, { taskId: job.task.id, agentId: job.agent.id, attempt: job.previousRun?.attempt ?? 0, ...fields });
}

const clients = new Map();
function clientFor(route, agentId) {
  const key = `${route}:${agentId}`;
  if (!clients.has(key)) clients.set(key, new Client({
    host: `${host}/eve/agents/${route}`,
    ...(route === "custom" ? { headers: { "x-vault-agent-id": agentId } } : {}),
    redirect: "error",
  }));
  return clients.get(key);
}

async function execute(job, run) {
  const route = taskAgentRoute(job.agent.id);
  const model = workerModelContext(job.agent);
  diagnosticLog("worker", "task_claimed", { taskId: job.task.id, agentId: job.agent.id, attempt: run.attempt, provider: model.provider, model: model.provider === "ollama" ? model.model : "subscription" });
  const client = clientFor(route, job.agent.id);
  await client.health();
  const { session, response } = await client.sessions.create({
    message: buildWorkerTaskPrompt(job),
    clientContext: { vaultAgentId: job.agent.id, vaultAgent: job.agent, vaultModel: model },
  });
  if (!attachTaskRunSession(job.task.id, run.taskRevision, run.attempt, session.state.sessionId)) {
    await session.cancel({ tasks: true }).catch(() => undefined);
    throw new Error("The task was cancelled before its EVE session could be attached.");
  }
  diagnosticLog("worker", "session_started", { taskId: job.task.id, agentId: job.agent.id, attempt: run.attempt, sessionId: session.state.sessionId });
  const heartbeat = setInterval(() => {
    if (!heartbeatTaskRun(job.task.id, run.taskRevision, run.attempt)) {
      clearInterval(heartbeat);
      void session.cancel({ tasks: true }).catch(() => undefined);
    }
  }, 30_000);
  let result;
  let timeout;
  try {
    result = await Promise.race([
      response.result(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("The EVE session exceeded the configured task timeout.")), getVaultSettings().taskTimeoutMinutes * 60_000);
      }),
    ]);
  } catch (error) {
    await session.cancel({ tasks: true }).catch(() => undefined);
    throw error;
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timeout);
  }
  if (result.status === "failed") throw new Error("The EVE session failed.");
  if (result.status === "waiting" && result.events.some((event) => event.type === "input.requested")) {
    diagnosticLog("worker", "session_waiting_input", { taskId: job.task.id, sessionId: session.state.sessionId });
    return undefined;
  }
  return result.message ?? "";
}

process.stdout.write(`Agent Vault worker watching ${host}.\n`);
try {
  const state = getVaultState()?.state;
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const runs = listTaskRuns();
  const settings = getVaultSettings();
  diagnosticLog("worker", "started", { host, pollMs: 3000, tasks: tasks.length, queued: tasks.filter((task) => task.status === "queued").length, activeRuns: runs.filter((run) => run.status === "active").length, provider: settings.defaultModel, model: settings.defaultModel === "ollama" ? settings.defaultOllamaModel || "not_selected" : "subscription" });
} catch (error) {
  diagnosticLog("worker", "startup_snapshot_failed", { errorCode: diagnosticErrorCode(error) });
}
while (!stopping) {
  try {
    await checkLocalModel(Date.now());
    const jobs = findRunnableJobs();
    const now = Date.now();
    const signature = jobs.map((job) => `${job.task.id}:${job.previousRun?.status ?? "new"}:${job.previousRun?.attempt ?? 0}`).sort().join("|");
    if (signature !== lastScanSignature || now - lastScanLoggedAt >= 60_000) {
      diagnosticLog("worker", "scan", { runnable: jobs.length, resuming: jobs.filter((job) => job.previousRun?.eveSessionId).length });
      lastScanSignature = signature;
      lastScanLoggedAt = now;
    }
    const visibleIds = new Set(jobs.map((job) => job.task.id));
    for (const id of observedTaskStates.keys()) if (!visibleIds.has(id)) observedTaskStates.delete(id);
    for (const job of jobs) {
      if (stopping) break;
      if (!job.previousRun?.eveSessionId) logTaskState(job, "task_ready", { status: job.previousRun?.status ?? job.task.status });
      const client = clientFor(taskAgentRoute(job.agent.id), job.agent.id);
      try { await client.health(); } catch (error) {
        const key = `${taskAgentRoute(job.agent.id)}:${job.agent.id}`;
        if (now - (lastHealthFailure.get(key) ?? 0) >= 60_000) {
          diagnosticLog("worker", "eve_unavailable", { taskId: job.task.id, agentId: job.agent.id, route: taskAgentRoute(job.agent.id), errorCode: diagnosticErrorCode(error) });
          lastHealthFailure.set(key, now);
        }
        continue;
      }
      if (job.previousRun && !job.previousRun.eveSessionId) {
        diagnosticLog("worker", "session_missing", { taskId: job.task.id, attempt: job.previousRun.attempt });
        finishTaskRun(job.task.id, job.previousRun.taskRevision, job.previousRun.attempt, { status: "failed", error: "The worker stopped before an EVE session was created." });
        continue;
      }
      if (job.previousRun?.eveSessionId) {
        const session = client.sessions.attach(job.previousRun.eveSessionId);
        try {
          const snapshot = await session.snapshot();
          const outcome = classifyTaskSessionEvents(snapshot.events);
          logTaskState(job, `session_${outcome.status.replaceAll("-", "_")}`, { sessionId: job.previousRun.eveSessionId });
          if (outcome.status === "completed" || outcome.status === "failed") {
            finishTaskRun(job.task.id, job.previousRun.taskRevision, job.previousRun.attempt, outcome.status === "failed" ? { status: "failed", error: outcome.error } : { status: "completed", result: outcome.result });
            diagnosticLog("worker", "task_finished", { taskId: job.task.id, attempt: job.previousRun.attempt, status: outcome.status });
            continue;
          }
          if (outcome.status === "waiting-input") {
            heartbeatTaskRun(job.task.id, job.previousRun.taskRevision, job.previousRun.attempt);
            continue;
          }
          if (taskSessionExpired(job.previousRun, getVaultSettings().taskTimeoutMinutes, Date.now(), lastTaskInputResolvedAt(snapshot.events))) {
            diagnosticLog("worker", "session_expired", { taskId: job.task.id, attempt: job.previousRun.attempt, sessionId: job.previousRun.eveSessionId });
            finishTaskRun(job.task.id, job.previousRun.taskRevision, job.previousRun.attempt, { status: "failed", error: "The EVE session exceeded the configured task timeout." });
            await session.cancel({ tasks: true }).catch(() => undefined);
            continue;
          }
          // The durable EVE turn is still running or awaiting input. Do not create a second session.
          heartbeatTaskRun(job.task.id, job.previousRun.taskRevision, job.previousRun.attempt);
          continue;
        } catch (error) {
          logTaskState(job, "session_inspection_failed", { sessionId: job.previousRun.eveSessionId, errorCode: diagnosticErrorCode(error) });
          if (error && typeof error === "object" && "status" in error && (error.status === 404 || error.status === 410)) {
            finishTaskRun(job.task.id, job.previousRun.taskRevision, job.previousRun.attempt, { status: "failed", error: "The EVE session is no longer available." });
          }
          continue;
        }
      }
      const run = await runWorkerJob(job, execute);
      if (run) {
        diagnosticLog("worker", "task_finished", { taskId: job.task.id, agentId: job.agent.id, attempt: run.attempt, status: run.status, ...(run.status === "failed" ? { errorCode: diagnosticErrorCode(run.error) } : {}) });
      }
    }
  } catch (error) {
    if (Date.now() - lastScanFailureAt >= 60_000) {
      diagnosticLog("worker", "scan_failed", { errorCode: diagnosticErrorCode(error) });
      lastScanFailureAt = Date.now();
    }
  }
  if (!stopping) await delay(3000);
}
