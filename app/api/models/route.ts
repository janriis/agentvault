import { NextResponse } from "next/server";
import { getVaultSettings } from "@/agent/lib/vault-database";

interface DiscoveredModel {
  id: string;
  name: string;
  provider: "ollama";
  baseUrl: string;
  details?: string;
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: unknown;
    model?: unknown;
    details?: { parameter_size?: unknown; family?: unknown };
  }>;
}

export async function GET() {
  const baseUrl = normalizeBaseUrl(getVaultSettings().ollamaHost);

  if (baseUrl === null) {
    return NextResponse.json({ providers: [], models: [], errors: ["Set a local Ollama address in Settings."] });
  }

  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return NextResponse.json({ providers: [], models: [], errors: [`Ollama returned HTTP ${response.status}.`] });
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    const models = (payload.models ?? [])
      .map((model): DiscoveredModel | null => {
        const id = typeof model.name === "string" ? model.name : model.model;
        if (typeof id !== "string" || id.length === 0) return null;

        const family = typeof model.details?.family === "string" ? model.details.family : null;
        const size =
          typeof model.details?.parameter_size === "string" ? model.details.parameter_size : null;

        return {
          id,
          name: id,
          provider: "ollama",
          baseUrl,
          ...(family || size ? { details: [family, size].filter(Boolean).join(" · ") } : {}),
        };
      })
      .filter((model): model is DiscoveredModel => model !== null);

    return NextResponse.json({
      providers: [{ id: "ollama", name: "Ollama", baseUrl, modelCount: models.length }],
      models,
      errors: [],
    });
  } catch {
    return NextResponse.json({ providers: [], models: [], errors: [`Could not reach Ollama at ${baseUrl}. Check that it is running, then rescan.`] });
  }
}

function normalizeBaseUrl(value: string): string | null {
  const candidate = value.includes("://") ? value : `http://${value}`;

  try {
    const url = new URL(candidate);
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (!isLocal || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return null;
    }
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}
