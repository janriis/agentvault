import { NextResponse } from "next/server";
import { buildVaultExport } from "@/agent/lib/vault-export";

export async function GET() {
  try {
    const document = await buildVaultExport();
    const filename = `agent-vault-export-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(`${JSON.stringify(document, null, 2)}\n`, {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch {
    return NextResponse.json({ error: "The vault export could not be created." }, { status: 500 });
  }
}
