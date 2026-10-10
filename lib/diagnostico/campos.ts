/**
 * Confere quais campos uma resposta da Nuvemshop realmente traz. Só olha NOMES e TIPOS: nunca devolve valores, para o diagnóstico
 * poder mostrar uma amostra de pedido ou cliente sem expor dado pessoal.
 */
export interface Esperado {
  /** Caminho do campo. "customer.id"; listas com "[]" ("products[].product_id"); alternativas com "|" ("subject|asunto"). */
  caminho: string;
  /** Sem este campo, a funcionalidade quebra (se for false, só perde um detalhe). */
  obrigatorio: boolean;
  /** Para que o painel usa o campo. */
  uso: string;
}

export interface ResultadoCampo extends Esperado {
  presente: boolean;
  /** Tipo do primeiro valor achado (string, number, boolean, object, array) ou null. */
  tipo: string | null;
}

const vazio = (v: unknown) => v === undefined || v === null || v === "";
const tipoDe = (v: unknown) => (Array.isArray(v) ? "array" : typeof v);

/** Todos os valores (não vazios) que o caminho alcança numa amostra, atravessando listas. */
function valoresDe(raiz: unknown, partes: string[]): unknown[] {
  let atuais: unknown[] = [raiz];
  for (const parte of partes) {
    const lista = parte.endsWith("[]");
    const nome = lista ? parte.slice(0, -2) : parte;
    const prox: unknown[] = [];
    for (const a of atuais) {
      if (!a || typeof a !== "object") continue;
      const v = (a as Record<string, unknown>)[nome];
      if (lista) {
        if (Array.isArray(v)) prox.push(...v);
      } else if (!vazio(v)) prox.push(v);
    }
    atuais = prox;
  }
  return atuais.filter((v) => !vazio(v));
}

export function verificarCampos(amostras: unknown[], esperados: Esperado[]): ResultadoCampo[] {
  return esperados.map((e) => {
    for (const alternativa of e.caminho.split("|")) {
      for (const amostra of amostras) {
        const achados = valoresDe(amostra, alternativa.split("."));
        if (achados.length > 0) return { ...e, presente: true, tipo: tipoDe(achados[0]) };
      }
    }
    return { ...e, presente: false, tipo: null };
  });
}

/** Nomes dos campos do primeiro nível das amostras (para diagnosticar quando a loja usa nomes diferentes dos esperados). */
export function camposRecebidos(amostras: unknown[]): string[] {
  const out = new Set<string>();
  for (const a of amostras) if (a && typeof a === "object" && !Array.isArray(a)) for (const k of Object.keys(a)) out.add(k);
  return [...out].sort();
}
