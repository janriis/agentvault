import { NextResponse } from "next/server";
import {
  getWorkspaceConfig,
  listWorkspaceDirectories,
  saveWorkspaceConfig,
} from "@/agent/lib/workspace-store";

export async function GET(request: Request) {
  try {
    const config = await getWorkspaceConfig();
    const requestedPath = new URL(request.url).searchParams.get("path") ?? config.selectedPath;
    const entries = await listWorkspaceDirectories(requestedPath);
    return NextResponse.json({
      workspace: config,
      currentPath: requestedPath,
      entries,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Workspace folder could not be read." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as { relativePath?: unknown } | null;
  if (!payload || typeof payload.relativePath !== "string") {
    return NextResponse.json({ error: "A project-relative folder is required." }, { status: 400 });
  }

  try {
    const workspace = await saveWorkspaceConfig(payload.relativePath);
    const entries = await listWorkspaceDirectories(workspace.selectedPath);
    return NextResponse.json({ workspace, currentPath: workspace.selectedPath, entries });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Workspace folder could not be selected." }, { status: 400 });
  }
}
