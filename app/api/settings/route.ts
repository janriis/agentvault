import { NextResponse } from "next/server";
import { getVaultSettings, saveVaultSettings, type VaultSettings } from "@/agent/lib/vault-database";

export async function GET() {
  return NextResponse.json({ settings: getVaultSettings() });
}

export async function PUT(request: Request) {
  const payload = await request.json().catch(() => null) as { settings?: unknown } | null;
  if (!payload?.settings || typeof payload.settings !== "object") {
    return NextResponse.json({ error: "A settings object is required." }, { status: 400 });
  }
  try {
    const settings = saveVaultSettings(payload.settings as VaultSettings);
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ error: "The settings could not be saved." }, { status: 400 });
  }
}
