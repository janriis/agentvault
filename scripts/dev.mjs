import { spawn } from "node:child_process";
import { diagnosticErrorCode, diagnosticLog, diagnosticLogPath } from "../agent/lib/diagnostic-log.ts";

const args = process.argv.slice(2);
const portIndex = args.findIndex((arg) => arg === "-p" || arg === "--port");
const port = portIndex >= 0 ? args[portIndex + 1] : "3000";
if (!/^\d{2,5}$/u.test(port) || Number(port) > 65535) {
  process.stderr.write("Pass a valid port after -p or --port.\n");
  process.exit(2);
}

const workerEnabled = process.env.AGENT_VAULT_WORKER !== "off";
diagnosticLog("dev", "starting", { port: Number(port), workerEnabled, logFile: diagnosticLogPath() });
process.stdout.write(workerEnabled
  ? "[vault:dev] The web server and task worker start together; previously queued agent tasks may resume.\n"
  : "[vault:dev] The task worker is disabled; queued agent tasks will not run.\n");
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...args], { stdio: "inherit" });
const worker = workerEnabled ? spawn(process.execPath, ["scripts/task-worker.mjs", "--host", `http://127.0.0.1:${port}`], { stdio: "inherit" }) : undefined;
diagnosticLog("dev", "children_started", { webPid: next.pid, workerPid: worker?.pid });
next.on("error", (error) => diagnosticLog("dev", "web_start_failed", { errorCode: diagnosticErrorCode(error) }));
worker?.on("error", (error) => diagnosticLog("dev", "worker_start_failed", { errorCode: diagnosticErrorCode(error) }));
let closing = false;
function close(signal = "SIGTERM") {
  if (closing) return;
  closing = true;
  diagnosticLog("dev", "stopping", { signal });
  if (next.exitCode === null) next.kill(signal);
  if (worker?.exitCode === null) worker.kill(signal);
}
process.on("SIGINT", () => close("SIGINT"));
process.on("SIGTERM", () => close("SIGTERM"));
next.on("exit", (code, signal) => { diagnosticLog("dev", "web_exited", { code, signal }); close(); process.exitCode = code ?? 1; });
worker?.on("exit", (code) => {
  diagnosticLog("dev", "worker_exited", { code });
  if (!closing) {
    process.stderr.write("Task worker stopped; restarting the development server will resume background execution.\n");
    close();
    process.exitCode = code || 1;
  }
});
