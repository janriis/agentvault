import { NextResponse } from "next/server";
import { listStoredAgents, upsertStoredAgent, type StoredAgent } from "@/agent/lib/agent-registry";
import { maybeCreateScheduledBackup } from "@/agent/lib/vault-export";
import { cleanWorkspaceRelativePath } from "@/agent/lib/workspace-operations";

export async function GET() {
  return NextResponse.json({ agents: await listStoredAgents() });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as Partial<StoredAgent> | null;
  if (!payload || !isSafeId(payload.id) || typeof payload.name !== "string" || payload.name.trim().length === 0) {
    return NextResponse.json({ error: "A valid agent id and name are required." }, { status: 400 });
  }

  let allowedFolders: string[];
  try { allowedFolders = workspaceFolders(payload.allowedFolders); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Allowed folders are invalid." }, { status: 400 }); }

  const agent: StoredAgent = {
    id: payload.id,
    name: payload.name.trim(),
    role: typeof payload.role === "string" ? payload.role : "custom",
    description: typeof payload.description === "string" ? payload.description : "A focused Agent Vault specialist.",
    capabilities: stringArray(payload.capabilities),
    model: typeof payload.model === "string" ? payload.model : "ChatGPT subscription",
    tools: stringArray(payload.tools),
    permissions: stringArray(payload.permissions),
    allowedFolders,
    ...(typeof payload.context === "string" ? { context: payload.context } : {}),
  };

  await upsertStoredAgent(agent);
  await maybeCreateScheduledBackup().catch(() => undefined);
  return NextResponse.json({ agent }, { status: 201 });
}

function workspaceFolders(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return ["."];
  return value.slice(0, 20).map((folder) => cleanWorkspaceRelativePath(folder, true));
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/u.test(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 30) : [];
}
