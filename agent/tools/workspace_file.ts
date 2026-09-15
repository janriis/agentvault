import { defineTool } from "eve/tools";
import { z } from "zod";
import { runWorkspaceOperation } from "../lib/workspace-operations";

const file = z.string().min(1).max(300);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);

export default defineTool({
  description: "Use the selected local host workspace only for your active assigned task. Read, search, preview a diff, safely write or patch with a SHA-256 precondition, move without overwriting, or run an approved test script. Paths are workspace-relative and agent folder permissions are enforced. Host files are not the EVE sandbox.",
  inputSchema: z.discriminatedUnion("action", [
    z.object({ action: z.literal("read"), file }),
    z.object({ action: z.literal("search"), folder: file, query: z.string().min(1).max(200) }),
    z.object({ action: z.literal("diff"), file, proposedContent: z.string().max(1_000_000) }),
    z.object({ action: z.literal("write"), file, content: z.string().max(1_000_000), expectedSha256: digest.nullable() }),
    z.object({ action: z.literal("patch"), file, find: z.string().min(1).max(100_000), replace: z.string().max(100_000), expectedSha256: digest }),
    z.object({ action: z.literal("move"), file, destination: file, expectedSha256: digest }),
    z.object({ action: z.literal("test"), script: z.enum(["test:unit", "typecheck"]) }),
  ]),
  approval: ({ toolInput }) => toolInput && typeof toolInput === "object" && "action" in toolInput && toolInput.action === "test" ? "user-approval" : "not-applicable",
  label: { start: (input) => `Workspace ${input.action}${"file" in input ? ` · ${input.file}` : ""}` },
  async execute(input, ctx) {
    return runWorkspaceOperation(ctx.session.id, ctx.callId, input);
  },
});
