import { acaoGrupo, type AcaoGrupo } from "@/lib/history/labels";

const PATHS: Record<AcaoGrupo, string> = {
  produto: "M3 7l9-4 9 4v10l-9 4-9-4V7zm0 0l9 4m0 0l9-4m-9 4v10", // caixa
  variante: "M4 6h16M4 12h10M4 18h16", // linhas (opções)
  imagem: "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M9 9.5h.01", // foto
  categoria: "M3 7h7l2 2h9v10H3z", // pasta
  lote: "M5 4h14v4H5zM5 10h14v4H5zM5 16h14v4H5z", // pilha
  outro: "M12 8v4m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z",
};
const FAIL = "M6 6l12 12M18 6L6 18";

/** Ícone do tipo de evento; em falha troca por um X. Decorativo: o texto ao lado já diz o que é. */
export function HistoryIcon({ acao, falhou = false }: { acao: string; falhou?: boolean }) {
  return (
    <span aria-hidden="true" className={`flex size-8 shrink-0 items-center justify-center rounded-full border ${falhou ? "border-danger/40 text-danger" : "border-border-strong text-muted"}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={falhou ? FAIL : PATHS[acaoGrupo(acao)]} />
      </svg>
    </span>
  );
}
