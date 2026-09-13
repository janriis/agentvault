import type { NextConfig } from "next";
import path from "node:path";
import { withEve } from "eve/next";

// EVE runs named agents in child workers whose working directory is a runtime
// snapshot. Pin the shared registry to the application directory so those
// workers and the Next.js API routes read the same data.
process.env.AGENT_VAULT_DATA_DIR ??= path.join(process.cwd(), ".data");

const nextConfig: NextConfig = {};

export default withEve(nextConfig, {
  agents: {
    coordinator: "./agent",
    researcher: "./agent/subagents/researcher",
    planner: "./agent/subagents/planner",
    writer: "./agent/subagents/writer",
    reviewer: "./agent/subagents/reviewer",
    custom: "./agent/agents/custom",
  },
});
