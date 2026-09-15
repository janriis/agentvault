import { Client } from "eve/client";
import { setTimeout as delay } from "node:timers/promises";
import { buildWorkerTaskPrompt, findRunnableJobs, runWorkerJob, taskAgentRoute, workerModelContext } from "../agent/lib/task-orchestration.ts";
import { attachTaskRunSession, finishTaskRun, heartbeatTaskRun } from "../agent/lib/vault-database.ts";

const hostArg = process.argv.indexOf("--host");
const host = hostArg >= 0 ? process.argv[hostArg + 1] : process.env.AGENT_VAULT_APP_URL;
if (!host || !/^https?:\/\/[^/]+$/u.test(host)) {
  process.stderr.write("Set AGENT_VAULT_APP_URL or pass --host http://127.0.0.1:3001.\n");
  process.exit(2);
}

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

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
  const client = clientFor(route, job.agent.id);
  await client.health();
  const { session, response } = await client.sessions.create({
    message: buildWorkerTaskPrompt(job),
    clientContext: { vaultAgentId: job.agent.id, vaultAgent: job.agent, vaultModel: workerModelContext(job.agent) },
  });
  if (!attachTaskRunSession(job.task.id, run.taskRevision, run.attempt, session.state.sessionId)) {
    await session.cancel({ tasks: true }).catch(() => undefined);
    throw new Error("The task was cancelled before its EVE session could be attached.");
  }
  process.stdout.write(`Task ${job.task.id} started in EVE session ${session.state.sessionId}.\n`);
  const heartbeat = setInterval(() => {
    if (!heartbeatTaskRun(job.task.id, run.taskRevision, run.attempt)) {
      clearInterval(heartbeat);
      void session.cancel({ tasks: true }).catch(() => undefined);
    }
  }, 30_000);
  let result;
  try { result = await response.result(); } finally { clearInterval(heartbeat); }
  if (result.status === "failed") throw new Error("The EVE session failed.");
  return result.message ?? "";
}

process.stdout.write(`Agent Vault worker watching ${host}.\n`);
while (!stopping) {
  try {
    const jobs = findRunnableJobs();
    for (const job of jobs) {
      if (stopping) break;
      const client = clientFor(taskAgentRoute(job.agent.id), job.agent.id);
      try { await client.health(); } catch { continue; }
      if (job.previousRun && !job.previousRun.eveSessionId) {
        finishTaskRun(job.task.id, job.previousRun.taskRevision, job.previousRun.attempt, { status: "failed", error: "The worker stopped before an EVE session was created." });
        continue;
      }
      if (job.previousRun?.eveSessionId) {
        const session = client.sessions.attach(job.previousRun.eveSessionId);
        try {
          const snapshot = await session.snapshot();
          const events = snapshot.events;
          const settled = events.some((event) => event.type === "turn.completed" || event.type === "session.completed" || event.type === "session.failed" || event.type === "turn.failed");
          if (settled) {
            const failed = events.some((event) => event.type === "session.failed" || event.type === "turn.failed");
            const message = [...events].reverse().find((event) => event.type === "message.completed" && event.data.finishReason !== "tool-calls")?.data.message;
            finishTaskRun(job.task.id, job.previousRun.taskRevision, job.previousRun.attempt, failed || !message ? { status: "failed", error: failed ? "The resumed EVE session failed." : "The resumed EVE session returned no result." } : { status: "completed", result: message });
            continue;
          }
          // The durable EVE turn is still running or awaiting input. Do not create a second session.
          continue;
        } catch (error) {
          process.stderr.write(`Could not inspect EVE session ${job.previousRun.eveSessionId}: ${error instanceof Error ? error.message : String(error)}\n`);
          if (error && typeof error === "object" && "status" in error && (error.status === 404 || error.status === 410)) {
            finishTaskRun(job.task.id, job.previousRun.taskRevision, job.previousRun.attempt, { status: "failed", error: "The EVE session is no longer available." });
          }
          continue;
        }
      }
      const run = await runWorkerJob(job, execute);
      if (run) process.stdout.write(`Task ${job.task.id}: ${run.status} (attempt ${run.attempt}).\n`);
    }
  } catch (error) {
    process.stderr.write(`Worker check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  if (!stopping) await delay(3000);
}
