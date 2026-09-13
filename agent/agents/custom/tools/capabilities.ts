import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import webFetch from "eve/tools/web_fetch";
import webSearch from "eve/tools/web_search";
import { readFile } from "eve/tools/read_file";
import { writeFile as writeFileTool } from "eve/tools/write_file";
import listArtifacts from "../../../tools/list_artifacts";
import readArtifact from "../../../tools/read_artifact";
import writeArtifact from "../../../tools/write_artifact";
import { getStoredAgent } from "../../../lib/agent-registry";
import { readVaultClientContext } from "../../../lib/client-context";

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      const context = readVaultClientContext(ctx.messages);
      const authAgentId = ctx.session.auth.current?.attributes.vaultAgentId;
      const agentId = typeof authAgentId === "string"
        ? authAgentId
        : typeof context?.vaultAgentId === "string"
          ? context.vaultAgentId
          : undefined;
      const agent = agentId === undefined ? undefined : await getStoredAgent(agentId);
      if (agent === undefined) return null;

      const tools = new Set(agent.tools);
      const permissions = new Set(agent.permissions);
      const resolved: Record<string, unknown> = {};

      if (tools.has("Artifacts")) {
        resolved.list_artifacts = listArtifacts;
        resolved.read_artifact = readArtifact;
      }

      if (tools.has("Artifacts") && permissions.has("Edit artifacts")) {
        resolved.write_artifact = writeArtifact;
      }

      if (tools.has("Web search")) resolved.web_search = webSearch;
      if (tools.has("Web fetch")) {
        resolved.web_fetch = defineTool({
          ...webFetch,
          execute: (input, toolContext) => webFetch.execute(input, toolContext),
        });
      }

      if (tools.has("File workspace") && permissions.has("Read workspace")) {
        resolved.read_file = defineTool({
          ...readFile,
          execute: (input, toolContext) => readFile.execute(input, toolContext),
        });
      }

      if (tools.has("File workspace") && permissions.has("Edit artifacts")) {
        resolved.write_file = defineTool({
          ...writeFileTool,
          execute: (input, toolContext) => writeFileTool.execute(input, toolContext),
          approval: always(),
        });
      }

      return resolved;
    },
  },
});
