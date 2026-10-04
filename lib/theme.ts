export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "inuvem-theme";

export const THEME_LABEL: Record<ThemeChoice, string> = { system: "Automático", light: "Claro", dark: "Escuro" };

/** Ordem em que o botão alterna: automático → claro → escuro → automático. */
export function nextTheme(current: ThemeChoice): ThemeChoice {
  return current === "system" ? "light" : current === "light" ? "dark" : "system";
}

export function parseTheme(value: string | null | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * Script que roda antes da primeira pintura para aplicar o tema escolhido (evita o "flash" do tema errado).
 * Mantido como texto fixo: não recebe nenhum dado do usuário.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
