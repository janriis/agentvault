import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/app/_components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Vault",
  description: "A personal vault of focused AI agents.",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider><TooltipProvider>{children}</TooltipProvider></ThemeProvider>
      </body>
    </html>
  );
}
