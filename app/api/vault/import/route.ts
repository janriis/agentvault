import { NextResponse } from "next/server";
import { restoreVaultExport } from "@/agent/lib/vault-export";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as { document?: unknown; confirm?: unknown } | null;
  if (!payload || payload.confirm !== true) {
    return NextResponse.json({ error: "Restore requires an explicit confirmation." }, { status: 400 });
  }
  try {
    const restored = await restoreVaultExport(payload.document);
    return NextResponse.json({ restored });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The vault could not be restored." }, { status: 400 });
  }
}
