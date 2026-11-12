"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-white/10" />
    );
  }

  const darkMode = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={
        darkMode
          ? "Switch to light mode"
          : "Switch to dark mode"
      }
      title={
        darkMode
          ? "Light mode"
          : "Dark mode"
      }
      onClick={() =>
        setTheme(darkMode ? "light" : "dark")
      }
      className="
        relative flex h-9 w-9 items-center justify-center
        overflow-hidden rounded-xl
        text-slate-600
        transition-all duration-200
        hover:bg-slate-100 hover:text-slate-950
        active:scale-95
        dark:text-slate-300
        dark:hover:bg-white/10 dark:hover:text-white
      "
    >
      {darkMode ? (
        <Sun
          size={18}
          className="text-amber-400"
        />
      ) : (
        <Moon
          size={18}
          className="text-slate-600"
        />
      )}
    </button>
  );
}