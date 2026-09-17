import { NextResponse } from "next/server";
import { getVaultSettings, saveVaultSettings, type VaultSettings } from "@/agent/lib/vault-database";
import { discoverOllamaModels } from "@/agent/lib/ollama-discovery";
import { maybeCreateScheduledBackup } from "@/agent/lib/vault-export";

export async function GET() {
  return NextResponse.json({ settings: getVaultSettings() });
}

export async function PUT(request: Request) {
  const payload = await request.json().catch(() => null) as { settings?: unknown } | null;
  if (!payload?.settings || typeof payload.settings !== "object") {
    return NextResponse.json({ error: "A settings object is required." }, { status: 400 });
  }
  const next = payload.settings as Partial<VaultSettings>;
  const current = getVaultSettings();
  const modelChanged = next.defaultModel !== current.defaultModel ||
    next.defaultOllamaModel !== current.defaultOllamaModel || next.ollamaHost !== current.ollamaHost;
  if (next.defaultModel === "ollama") {
    if (typeof next.defaultOllamaModel !== "string" || !next.defaultOllamaModel.trim()) {
      return NextResponse.json({ error: "Choose an installed Ollama model before saving." }, { status: 400 });
    }
    if (modelChanged) {
      const discovered = await discoverOllamaModels(next.ollamaHost ?? current.ollamaHost);
      if (discovered.errors.length > 0) return NextResponse.json({ error: discovered.errors[0] }, { status: 400 });
      if (!discovered.models.some((model) => model.id === next.defaultOllamaModel)) {
        return NextResponse.json({ error: "The selected Ollama model is not installed at this address." }, { status: 400 });
      }
    }
  }
  try {
    const result = saveVaultSettings(next as VaultSettings, modelChanged);
    await maybeCreateScheduledBackup().catch(() => undefined);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The settings could not be saved." }, { status: 400 });
  }
}
