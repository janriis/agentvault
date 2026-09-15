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

function isPersistedVaultState(value: unknown): value is PersistedVaultState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedVaultState>;
  return [candidate.agents, candidate.people, candidate.rooms, candidate.tasks, candidate.activity].every(Array.isArray);
}
