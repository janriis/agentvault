import { defineTool } from "eve/tools";
import { z } from "zod";
import { AGENT_CATALOG } from "../lib/agent-catalog";

export default defineTool({
  description:
    "List the specialist agents available in this vault and explain when to use each one. Call this when choosing a delegation target or when the user asks what the vault can do.",
  inputSchema: z.object({}),
  outputSchema: z.array(
    z.object({
      id: z.string(),
      purpose: z.string(),
      bestFor: z.string(),
      output: z.string(),
    }),
  ),
  execute() {
    return AGENT_CATALOG;
  },
});
