import { NextResponse } from "next/server";
import { discoverOllamaModels } from "@/agent/lib/ollama-discovery";
import { getVaultSettings } from "@/agent/lib/vault-database";

export async function GET() {
  return NextResponse.json(await discoverOllamaModels(getVaultSettings().ollamaHost));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter a local Ollama address to check." }, { status: 400 });
  }
  const host = (body as { host?: unknown } | null)?.host;
  if (typeof host !== "string" || host.length > 200) {
    return NextResponse.json({ error: "Enter a local Ollama address to check." }, { status: 400 });
  }
  return NextResponse.json(await discoverOllamaModels(host));
}
