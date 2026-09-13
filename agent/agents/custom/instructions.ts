import { defineDynamic, defineInstructions } from "eve/instructions";
import { getStoredAgent } from "../../lib/agent-registry";
import { readVaultClientContext } from "../../lib/client-context";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const context = readVaultClientContext(ctx.messages);
      const authAgentId = ctx.session.auth.current?.attributes.vaultAgentId;
      const agentId = typeof authAgentId === "string"
        ? authAgentId
        : typeof context?.vaultAgentId === "string"
          ? context.vaultAgentId
          : undefined;
      const agent = agentId === undefined ? undefined : await getStoredAgent(agentId);
      if (agent === undefined) {
        return defineInstructions({
          content: "You are a focused custom Agent Vault specialist. Ask for the missing assignment when the user's goal is unclear.",
        });
      }

      return defineInstructions({
        content: [
          `You are ${agent.name}, a ${agent.role} specialist in Agent Vault.`,
          agent.description,
          `Capabilities: ${agent.capabilities.join(", ") || "general focused assistance"}.`,
          `Configured tools: ${agent.tools.join(", ") || "none"}.`,
          `Configured permissions: ${agent.permissions.join(", ") || "none"}.`,
          agent.context ? `Working context: ${agent.context}` : "",
          "Respond as this agent directly. Do not claim to be a real person. Never perform an action outside the configured permissions.",
        ].filter(Boolean).join("\n"),
      });
    },
  },
});
