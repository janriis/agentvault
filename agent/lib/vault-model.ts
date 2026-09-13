import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineDynamic } from "eve";
import { chatgpt } from "eve/models/openai";
import { parseVaultModelSelection } from "./model-selection";

export function createVaultModel() {
  return defineDynamic({
    events: {
      "step.started": (_event, ctx) => {
        const selection = parseVaultModelSelection(ctx.messages);

        if (selection.provider === "ollama") {
          const ollama = createOpenAICompatible({
            name: "ollama",
            baseURL: `${selection.baseUrl}/v1`,
            apiKey: "ollama",
          });

          return {
            model: ollama(selection.model),
            // Ollama does not expose a portable context-window value through
            // its model-list endpoint. Keep this conservative for now.
            modelContextWindowTokens: 32_768,
          };
        }

        return {
          model: chatgpt(),
          // The ChatGPT subscription model is not in the Gateway catalog.
          // This conservative value lets EVE manage compaction safely.
          modelContextWindowTokens: 32_768,
        };
      },
    },
  });
}
