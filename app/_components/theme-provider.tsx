"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark";

const storageKey = "agent-vault-theme";
const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>("light");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(storageKey);
    } catch {
      // The switch still works when browser storage is unavailable.
    }
    const preferred: Theme = saved === "dark" ? "dark" : "light";
    updateTheme(preferred);
    applyTheme(preferred);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const next: Theme = event.newValue === "dark" ? "dark" : "light";
      updateTheme(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = (next: Theme) => {
    updateTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Keep the current tab usable when storage is unavailable.
    }
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function ThemeSwitcher({ showLabel = false }: { readonly showLabel?: boolean }) {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeSwitcher must be used inside ThemeProvider.");
  const { theme, setTheme } = context;
  const isDark = theme === "dark";
  return (
    <Button
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-pressed={isDark}
      className={showLabel ? "min-h-11" : "size-11"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      size={showLabel ? "sm" : "icon-sm"}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      type="button"
      variant="outline"
    >
      {isDark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
      {showLabel ? <span>{isDark ? "Light mode" : "Dark mode"}</span> : null}
    </Button>
  );
}
