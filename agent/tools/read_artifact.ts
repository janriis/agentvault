import { defineTool } from "eve/tools";
import { z } from "zod";
import { readStoredArtifact } from "../lib/artifact-store";

export default defineTool({
  description: "Read one persistent Agent Vault artifact by id so you can use or review its exact content.",
  inputSchema: z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u) }),
  async execute({ id }) {
    const artifact = await readStoredArtifact(id);
    if (artifact === undefined) throw new Error(`Artifact “${id}” was not found.`);
    return artifact;
  },
});
