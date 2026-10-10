import type { ResultadoCampo } from "./campos";

export type StatusSonda = "ok" | "aviso" | "sem_dados" | "sem_permissao" | "indisponivel" | "erro";

export interface ResultadoSonda {
  id: string;
  titulo: string;
  caminho: string;
  usadoPor: string;
  status: StatusSonda;
  mensagem: string;
  campos: ResultadoCampo[];
  /** Campos do primeiro nível que a loja devolveu (nomes apenas). */
  recebidos: string[];
  itensLidos: number;
  ms: number;
}

export const ROTULO_STATUS: Record<StatusSonda, string> = {
  ok: "OK",
  aviso: "Faltam campos",
  sem_dados: "Sem dados para conferir",
  sem_permissao: "Sem permissão",
  indisponivel: "Não existe na API",
  erro: "Erro",
};

export interface ResultadoWebhooks {
  status: "ok" | "aviso" | "erro";
  mensagem: string;
  registrados: string[];
  faltando: string[];
}

export interface Diagnostico {
  geradoEm: string;
  duracaoMs: number;
  sondas: ResultadoSonda[];
  webhooks: ResultadoWebhooks;
}

export interface ValorObservado {
  valor: string;
  pedidos: number;
}

export interface ValoresDePedidos {
  pagamento: ValorObservado[];
  situacao: ValorObservado[];
  envio: ValorObservado[];
}

/** Relatório em texto simples, para copiar e colar numa conversa. Só nomes de campos e contagens: nenhum dado de loja ou cliente. */
export function relatorioTexto(d: Diagnostico): string {
  const linhas = [`Diagnóstico da API (${d.geradoEm}, ${Math.round(d.duracaoMs / 100) / 10} s)`];
  for (const s of d.sondas) {
    linhas.push(`\n[${ROTULO_STATUS[s.status]}] ${s.titulo} (${s.caminho}) · ${s.itensLidos} item(ns) lido(s)`);
    linhas.push(`  ${s.mensagem}`);
    const faltam = s.campos.filter((c) => !c.presente);
    if (faltam.length > 0 && s.status !== "ok") linhas.push(`  Campos recebidos: ${s.recebidos.join(", ") || "nenhum"}`);
    const tipos = s.campos.filter((c) => c.presente && c.tipo !== null).map((c) => `${c.caminho}:${c.tipo}`);
    if (tipos.length > 0) linhas.push(`  Tipos: ${tipos.join(", ")}`);
  }
  linhas.push(`\n[${d.webhooks.status === "ok" ? "OK" : d.webhooks.status === "aviso" ? "Faltam avisos" : "Erro"}] Webhooks: ${d.webhooks.mensagem}`);
  return linhas.join("\n");
}
