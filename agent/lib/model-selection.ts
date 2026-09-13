import type { ModelMessage } from "ai";

export const DEFAULT_MODEL_SELECTION = {
  provider: "chatgpt",
} as const;

export interface OllamaModelSelection {
  provider: "ollama";
  baseUrl: string;
  model: string;
}

export type VaultModelSelection =
  | typeof DEFAULT_MODEL_SELECTION
  | OllamaModelSelection;

const CLIENT_CONTEXT_PREFIX = "Client context:\n";
const DELEGATED_MODEL_PREFIX = "Agent Vault model selection: ";
const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|::1)$/u;

export function parseVaultModelSelection(
  messages: readonly ModelMessage[],
): VaultModelSelection {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = messages[index]?.content;
    const texts =
      typeof content === "string"
        ? [content]
        : content.map((part) =>
            "text" in part && typeof part.text === "string" ? part.text : "",
          );

    for (const text of texts) {
      const payload = text.startsWith(CLIENT_CONTEXT_PREFIX)
        ? text.slice(CLIENT_CONTEXT_PREFIX.length)
        : text.startsWith(DELEGATED_MODEL_PREFIX)
          ? text.slice(DELEGATED_MODEL_PREFIX.length)
          : text;

      try {
        const parsed: unknown = JSON.parse(payload);
        if (!isRecord(parsed) || !isRecord(parsed.vaultModel)) continue;

        const selection = parsed.vaultModel;
        if (selection.provider === "chatgpt") return DEFAULT_MODEL_SELECTION;

        if (
          selection.provider === "ollama" &&
          typeof selection.baseUrl === "string" &&
          typeof selection.model === "string" &&
          isLocalHttpUrl(selection.baseUrl) &&
          selection.model.length > 0 &&
          selection.model.length <= 200
        ) {
          return {
            provider: "ollama",
            baseUrl: selection.baseUrl.replace(/\/$/u, ""),
            model: selection.model,
          };
        }
      } catch {
        // Ignore ordinary conversation text that resembles the marker.
      }
    }
  }

  return DEFAULT_MODEL_SELECTION;
}

export function isLocalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOCAL_HOST_PATTERN.test(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
