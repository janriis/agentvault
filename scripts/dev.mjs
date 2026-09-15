import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const portIndex = args.findIndex((arg) => arg === "-p" || arg === "--port");
const port = portIndex >= 0 ? args[portIndex + 1] : "3000";
if (!/^\d{2,5}$/u.test(port) || Number(port) > 65535) {
  process.stderr.write("Pass a valid port after -p or --port.\n");
  process.exit(2);
}

const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...args], { stdio: "inherit" });
const worker = spawn(process.execPath, ["scripts/task-worker.mjs", "--host", `http://127.0.0.1:${port}`], { stdio: "inherit" });
let closing = false;
function close(signal = "SIGTERM") {
  if (closing) return;
  closing = true;
  if (next.exitCode === null) next.kill(signal);
  if (worker.exitCode === null) worker.kill(signal);
}
process.on("SIGINT", () => close("SIGINT"));
process.on("SIGTERM", () => close("SIGTERM"));
next.on("exit", (code) => { close(); process.exitCode = code ?? 1; });
worker.on("exit", (code) => {
  if (!closing) {
    process.stderr.write("Task worker stopped; restarting the development server will resume background execution.\n");
    close();
    process.exitCode = code || 1;
  }
});
