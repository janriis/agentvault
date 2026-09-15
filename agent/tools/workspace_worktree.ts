import { defineTool } from "eve/tools";
import { z } from "zod";
import { beginWorkspaceWorktree } from "../lib/workspace-operations";

export default defineTool({
  description: "Start or reuse an isolated Git worktree for this active assigned task before risky code edits. The selected workspace must be the Git repository root. Subsequent workspace_file calls use the task worktree. This never modifies the original checkout, and it starts from committed HEAD rather than uncommitted changes.",
  inputSchema: z.object({}),
  label: { start: () => "Create isolated task worktree" },
  async execute(_input, ctx) { return beginWorkspaceWorktree(ctx.session.id, ctx.callId); },
});
