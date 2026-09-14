import { NextResponse } from "next/server";
import { createVaultBackup } from "@/agent/lib/vault-export";

export async function POST() {
  try {
    const backup = await createVaultBackup();
    return NextResponse.json({ backup }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "The local vault backup could not be created." }, { status: 500 });
  }
}
