"use client";

import { useEffect, useState } from "react";
import { THEME_KEY, THEME_LABEL, nextTheme, parseTheme, type ThemeChoice } from "@/lib/theme";

function apply(choice: ThemeChoice) {
  if (choice === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", choice);
}

/** Botão que alterna o tema: automático (sistema) → claro → escuro. A escolha fica salva neste navegador. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    try {
      setChoice(parseTheme(localStorage.getItem(THEME_KEY)));
    } catch {
      /* sem armazenamento: fica no automático */
    }
  }, []);

  function onClick() {
    const next = nextTheme(choice);
    setChoice(next);
    apply(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* a troca vale só nesta visita */
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-10 items-center gap-2 rounded-md border border-border-strong bg-card px-3 text-sm font-medium hover:bg-border/40 ${className}`.trim()}
      aria-label={`Tema: ${THEME_LABEL[choice]}. Alternar tema`}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {choice === "dark" ? <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" /> : choice === "light" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></> : <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8m-4-4v4" /></>}
      </svg>
      {THEME_LABEL[choice]}
    </button>
  );
}
