/** Funções puras para pôr e tirar um bloco de conteúdo na descrição de um produto (sem banco nem rede). */
export const BLOCO_NOME_MAX = 80;
export const BLOCO_HTML_MAX = 20000;

const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, "\n");

export const marcaAbre = (id: string) => `<!--inuvem:bloco:${id}-->`;
export const marcaFecha = (id: string) => `<!--/inuvem:bloco:${id}-->`;
const envolver = (id: string, html: string) => `${marcaAbre(id)}${html}${marcaFecha(id)}`;

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const comMarcas = (id: string) => new RegExp(`${escapar(marcaAbre(id))}([\\s\\S]*?)${escapar(marcaFecha(id))}`);

/** O HTML da descrição com os espaços entre tags e as quebras de linha normalizados, para comparar sem se enganar com formatação. */
const compacto = (html: string) => normalizeNewlines(html).replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

export interface BlocoRef {
  id: string;
  html: string;
}

/** Onde o bloco está na descrição: entre as marcas do painel, ou (se um editor tirou as marcas) como o mesmo HTML. */
function localizar(descricao: string, bloco: BlocoRef): { inicio: number; fim: number; marcado: boolean; igual: boolean } | null {
  const m = comMarcas(bloco.id).exec(descricao);
  if (m) return { inicio: m.index, fim: m.index + m[0].length, marcado: true, igual: compacto(m[1] as string) === compacto(bloco.html) };
  const i = descricao.indexOf(bloco.html);
  if (bloco.html.length > 0 && i >= 0) return { inicio: i, fim: i + bloco.html.length, marcado: false, igual: true };
  return null;
}

export const temBloco = (descricao: string | null | undefined, bloco: BlocoRef): boolean => localizar(descricao ?? "", bloco) !== null;

const juntar = (antes: string, depois: string) => `${antes}${antes && depois ? "\n" : ""}${depois}`;

export type ResultadoDescricao = { depois: string } | { motivo: string };

/** Acrescenta o bloco (no fim ou no começo) ou, se já está na descrição, atualiza no mesmo lugar. */
export function aplicarBloco(descricao: string | null | undefined, bloco: BlocoRef, posicao: "fim" | "inicio" = "fim"): ResultadoDescricao {
  const atual = normalizeNewlines(descricao ?? "");
  const achou = localizar(atual, bloco);
  if (achou) {
    if (achou.igual && achou.marcado) return { motivo: "já tem este bloco, igual ao atual" };
    if (achou.igual && !achou.marcado) return { motivo: "já tem este bloco (sem a marca do painel)" };
    return { depois: `${atual.slice(0, achou.inicio)}${envolver(bloco.id, bloco.html)}${atual.slice(achou.fim)}` };
  }
  const novo = envolver(bloco.id, bloco.html);
  return { depois: posicao === "inicio" ? juntar(novo, atual.trim()) : juntar(atual.trim(), novo) };
}

/** Tira o bloco da descrição (e a quebra de linha que sobrar). Não deixa a descrição vazia: a loja recusa texto vazio. */
export function removerBloco(descricao: string | null | undefined, bloco: BlocoRef): ResultadoDescricao {
  const atual = normalizeNewlines(descricao ?? "");
  const achou = localizar(atual, bloco);
  if (!achou) return { motivo: "não tem este bloco" };
  const depois = juntar(atual.slice(0, achou.inicio).replace(/\s+$/, ""), atual.slice(achou.fim).replace(/^\s+/, ""));
  if (depois.replace(/<[^>]*>/g, "").trim() === "" && !/<img/i.test(depois)) return { motivo: "a descrição ficaria vazia" };
  return { depois };
}

