import type { ModelMessage } from "ai";

const CLIENT_CONTEXT_PREFIX = "Client context:\n";

export function readVaultClientContext(messages: readonly ModelMessage[]): Record<string, unknown> | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = messages[index]?.content;
    const texts = typeof content === "string" ? [content] : content.map((part) => "text" in part && typeof part.text === "string" ? part.text : "");
    for (const text of texts) {
      const payload = text.startsWith(CLIENT_CONTEXT_PREFIX)
        ? text.slice(CLIENT_CONTEXT_PREFIX.length)
        : text;
      try {
        const parsed = JSON.parse(payload) as unknown;
        if (isRecord(parsed)) return parsed;
      } catch {
        // Ignore malformed or ordinary user content.
      }
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
