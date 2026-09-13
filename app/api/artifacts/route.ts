import { NextResponse } from "next/server";
import { listStoredArtifacts, upsertStoredArtifact, type StoredArtifact, type StoredArtifactType } from "@/agent/lib/artifact-store";

export async function GET() {
  return NextResponse.json({ artifacts: await listStoredArtifacts() });
}

export async function POST(request: Request) {
  return saveArtifact(request, 201);
}

export async function PUT(request: Request) {
  return saveArtifact(request, 200);
}

async function saveArtifact(request: Request, status: 200 | 201) {
  const payload = await request.json().catch(() => null) as Partial<StoredArtifact> | null;
  if (!payload || !isSafeId(payload.id) || typeof payload.title !== "string" || payload.title.trim().length === 0 || !isArtifactType(payload.type) || typeof payload.content !== "string") {
    return NextResponse.json({ error: "A valid artifact id, title, type, and content are required." }, { status: 400 });
  }

  const artifact: StoredArtifact = {
    id: payload.id,
    title: payload.title.trim().slice(0, 200),
    type: payload.type,
    owner: typeof payload.owner === "string" && payload.owner.trim().length > 0 ? payload.owner.trim().slice(0, 100) : "Agent Vault",
    updated: new Date().toISOString(),
    content: payload.content.slice(0, 1_000_000),
  };
  await upsertStoredArtifact(artifact);
  return NextResponse.json({ artifact }, { status });
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/u.test(value);
}

function isArtifactType(value: unknown): value is StoredArtifactType {
  return value === "note" || value === "plan" || value === "draft" || value === "file";
}
