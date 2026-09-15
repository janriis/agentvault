import { NextResponse } from "next/server";
import {
  getVaultState,
  saveVaultState,
  VaultStateConflictError,
  VaultStateValidationError,
  type PersistedVaultState,
} from "@/agent/lib/vault-database";
import { maybeCreateScheduledBackup } from "@/agent/lib/vault-export";

export async function GET() {
  await maybeCreateScheduledBackup().catch(() => undefined);
  return NextResponse.json({ record: getVaultState() ?? null });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as { state?: unknown; expectedRevision?: unknown } | null;
  if (!payload || !isPersistedVaultState(payload.state)) {
    return NextResponse.json({ error: "A complete vault state is required." }, { status: 400 });
  }
  if (payload.expectedRevision !== undefined && (!Number.isInteger(payload.expectedRevision) || (payload.expectedRevision as number) < 0)) {
    return NextResponse.json({ error: "The vault revision is invalid." }, { status: 400 });
  }

  const current = getVaultState();
  if (current && payload.expectedRevision === undefined) return NextResponse.json({ error: "The current vault revision is required for updates." }, { status: 428 });
  if (current && payload.expectedRevision !== current.revision) return NextResponse.json({ error: "The vault changed in another session.", currentRevision: current.revision }, { status: 409 });
  if (current && !sameTaskDefinitions(current.state.tasks, payload.state.tasks)) return NextResponse.json({ error: "Use the Task Board action endpoint to create, edit, or move tasks." }, { status: 400 });

  try {
    const record = saveVaultState(payload.state, payload.expectedRevision as number | undefined);
    await maybeCreateScheduledBackup().catch(() => undefined);
    return NextResponse.json({ record });
  } catch (error) {
    if (error instanceof VaultStateConflictError) {
      return NextResponse.json({ error: error.message, currentRevision: error.currentRevision }, { status: 409 });
    }
    if (error instanceof VaultStateValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "The vault state could not be saved." }, { status: 500 });
  }
}

function sameTaskDefinitions(left: unknown[], right: unknown[]): boolean {
  const definition = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const task = value as Record<string, unknown>;
    return [task.id, task.title, task.description, task.acceptanceCriteria ?? null, task.assigneeId, task.assigneeType, task.roomId ?? null, task.sourceKey ?? null, task.priority, task.revision ?? 0, task.dependsOn ?? []];
  };
  return JSON.stringify(left.map(definition)) === JSON.stringify(right.map(definition));
}

function isPersistedVaultState(value: unknown): value is PersistedVaultState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedVaultState>;
  return [candidate.agents, candidate.people, candidate.rooms, candidate.tasks, candidate.activity].every(Array.isArray);
}
