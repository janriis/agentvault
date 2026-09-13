import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { upsertStoredArtifact } from "../lib/artifact-store";

export default defineTool({
  description: "Create or replace a persistent Agent Vault artifact. Use a stable artifact id when updating existing work.",
  inputSchema: z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u),
    title: z.string().min(1).max(200),
    type: z.enum(["note", "plan", "draft", "file"]),
    content: z.string().max(1_000_000),
    owner: z.string().min(1).max(100).optional(),
  }),
  approval: always(),
  async execute({ id, title, type, content, owner }) {
    const artifact = {
      id,
      title: title.trim(),
      type,
      owner: owner?.trim() || "Agent Vault",
      updated: new Date().toISOString(),
      content,
    };
    await upsertStoredArtifact(artifact);
    return artifact;
  },
});
