"use client";

import dynamic from "next/dynamic";

// The local dashboard is interactive and browser tools can annotate its DOM
// before hydration. Render it only after the client loads so those annotations
// cannot disagree with server-rendered workspace markup.
const VaultWorkspace = dynamic(
  () => import("./vault-workspace").then((module) => module.VaultWorkspace),
  { ssr: false },
);

export function VaultWorkspaceClient() {
  return <VaultWorkspace />;
}
