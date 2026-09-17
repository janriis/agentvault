export interface DiscoveredOllamaModel {
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

export function normalizeOllamaHost(value: string): string | null {
  const candidate = value.includes("://") ? value : `http://${value}`;

  try {
    const url = new URL(candidate);
    const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!isLocal || !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function discoverOllamaModels(host: string, request: typeof fetch = fetch) {
  const baseUrl = normalizeOllamaHost(host);
  if (!baseUrl) {
    return { providers: [], models: [], errors: ["Set a valid loopback Ollama address (localhost, 127.0.0.1, or [::1]) in Settings."] };
  }

  try {
    const response = await request(`${baseUrl}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return { providers: [], models: [], errors: [`Ollama returned HTTP ${response.status}.`] };
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    const models = (Array.isArray(payload.models) ? payload.models : [])
      .map((model): DiscoveredOllamaModel | null => {
        const id = typeof model.name === "string" ? model.name : model.model;
        if (typeof id !== "string" || id.length === 0) return null;

        const family = typeof model.details?.family === "string" ? model.details.family : null;
        const size = typeof model.details?.parameter_size === "string" ? model.details.parameter_size : null;
        return {
          id,
          name: id,
          provider: "ollama",
          baseUrl,
          ...(family || size ? { details: [family, size].filter(Boolean).join(" · ") } : {}),
        };
      })
      .filter((model): model is DiscoveredOllamaModel => model !== null);

    return {
      providers: [{ id: "ollama", name: "Ollama", baseUrl, modelCount: models.length }],
      models,
      errors: [],
    };
  } catch {
    return { providers: [], models: [], errors: [`Could not reach Ollama at ${baseUrl}. Check that it is running, then try again.`] };
  }
}
