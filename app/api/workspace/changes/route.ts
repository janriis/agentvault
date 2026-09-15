import { NextResponse } from "next/server";
import { listFileChanges } from "@/agent/lib/vault-database";

export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("taskId") ?? undefined;
  if (taskId && !/^[a-zA-Z0-9_-]{1,160}$/u.test(taskId)) return NextResponse.json({ error: "A valid task id is required." }, { status: 400 });
  return NextResponse.json({ changes: listFileChanges(taskId) });
}
