import { defineTool } from "eve/tools";
import { z } from "zod";
import { listStoredArtifacts } from "../lib/artifact-store";

export default defineTool({
  description: "List the persistent Agent Vault artifacts available to the current workspace. Use read_artifact to retrieve a full artifact.",
  inputSchema: z.object({ query: z.string().optional() }),
  async execute({ query }) {
    const normalizedQuery = query?.trim().toLowerCase();
    const artifacts = await listStoredArtifacts();
    return artifacts
      .filter((artifact) => normalizedQuery === undefined || normalizedQuery.length === 0 || `${artifact.title} ${artifact.type} ${artifact.owner}`.toLowerCase().includes(normalizedQuery))
      .map(({ id, title, type, owner, updated }) => ({ id, title, type, owner, updated }));
  },
});
