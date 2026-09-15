import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  listDatabaseAgents,
  replaceDatabaseAgents,
} from "./vault-database";

export interface StoredAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  model: string;
  tools: string[];
  permissions: string[];
  allowedFolders?: string[];
  context?: string;
}

const DEFAULT_AGENTS: StoredAgent[] = [
  {
    id: "lead",
    name: "Vault Lead",
    role: "lead",
    description: "Coordinates rooms, delegates work, and keeps the vault moving.",
    capabilities: ["delegation", "synthesis", "planning"],
    model: "ChatGPT subscription",
    tools: ["Agent dispatch", "Workflow", "Web search"],
    permissions: ["Read workspace", "Create tasks"],
  },
  {
    id: "researcher",
    name: "Researcher",
    role: "researcher",
    description: "Investigates questions and returns sourced, confidence-aware findings.",
    capabilities: ["web research", "source review", "fact finding"],
    model: "ChatGPT subscription",
    tools: ["Web search", "Web fetch"],
    permissions: ["Read workspace"],
  },
  {
    id: "planner",
    name: "Planner",
    role: "planner",
    description: "Turns broad goals into milestones, dependencies, and next actions.",
    capabilities: ["roadmaps", "prioritization", "risk mapping"],
    model: "ChatGPT subscription",
    tools: ["Task board", "Workflow"],
    permissions: ["Read workspace", "Create tasks"],
  },
  {
    id: "writer",
    name: "Writer",
    role: "writer",
    description: "Drafts polished writing for the requested audience, voice, and channel.",
    capabilities: ["drafting", "editing", "tone adaptation"],
    model: "ChatGPT subscription",
    tools: ["Artifacts", "File workspace"],
    permissions: ["Read workspace", "Edit artifacts"],
  },
  {
    id: "reviewer",
    name: "Reviewer",
    role: "reviewer",
    description: "Stress-tests plans and drafts for gaps, risks, and correctness.",
    capabilities: ["quality review", "risk spotting", "red teaming"],
    model: "ChatGPT subscription",
    tools: ["Artifacts", "Task board"],
    permissions: ["Read workspace", "Comment artifacts"],
  },
];

const registryPath = path.join(
  process.env.AGENT_VAULT_DATA_DIR ?? path.join(process.cwd(), ".data"),
  "agents.json",
);

let writeQueue = Promise.resolve();

export async function listStoredAgents(): Promise<StoredAgent[]> {
  const stored = listDatabaseAgents().flatMap((record) => isStoredAgent(record.value) ? [record.value] : []);
  if (stored.length > 0) return stored;

  try {
    const parsed = JSON.parse(await readFile(registryPath, "utf8")) as unknown;
    if (Array.isArray(parsed) && parsed.every(isStoredAgent)) {
      replaceDatabaseAgents(parsed.map((agent) => ({ id: agent.id, value: agent })));
      return parsed;
    }
  } catch {
    // Seed the database with the authored defaults below.
  }
  replaceDatabaseAgents(DEFAULT_AGENTS.map((agent) => ({ id: agent.id, value: agent })));
  return DEFAULT_AGENTS;
}

export async function getStoredAgent(agentId: string): Promise<StoredAgent | undefined> {
  return (await listStoredAgents()).find((agent) => agent.id === agentId);
}

export function upsertStoredAgent(agent: StoredAgent): Promise<void> {
  const operation = writeQueue.then(async () => {
    const current = await listStoredAgents();
    const next = [agent, ...current.filter((item) => item.id !== agent.id)];
    replaceDatabaseAgents(next.map((item) => ({ id: item.id, value: item })));
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

function isStoredAgent(value: unknown): value is StoredAgent {
  if (!value || typeof value !== "object") return false;
  const agent = value as Partial<StoredAgent>;
  return typeof agent.id === "string" && typeof agent.name === "string" && typeof agent.role === "string";
}

export function defaultAgents(): StoredAgent[] {
  return DEFAULT_AGENTS;
}
