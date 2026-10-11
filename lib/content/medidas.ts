import { sanitizeDescription } from "@/lib/catalog/description";

export const MAX_TAMANHOS = 12;
export const MAX_COLUNAS = 8;
export const TEXTO_MAX = 4000;

export type TipoMedida = "corpo" | "peca";

export interface TabelaMedidas {
  colunas: string[];
  linhas: Array<{ tamanho: string; valores: string[] }>;
}

export interface GuiaMontado {
  titulo: string;
  html: string;
  erros: string[];
  avisos: string[];
}

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const limpar = (s: string) => s.replace(/\s+/g, " ").trim();
const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
/** Número, faixa ("86-90"), fração ("1/2") ou decimal com vírgula: o painel não aceita texto solto numa tabela de medidas. */
const VALOR = /^\d{1,3}(?:[.,]\d{1,2})?(?:\s*(?:-|–|\/)\s*\d{1,3}(?:[.,]\d{1,2})?)?$/;

/** Como medir cada parte do corpo; a coluna é reconhecida pelo nome (busto, cintura…). Texto genérico: confira se combina com as suas peças. */
const COMO_MEDIR: Array<{ achar: RegExp; rotulo: string; texto: string }> = [
  { achar: /busto|peito|torax/, rotulo: "Busto", texto: "meça ao redor da parte mais cheia do busto, com a fita bem reta nas costas e sem apertar." },
  { achar: /cintura/, rotulo: "Cintura", texto: "meça ao redor da parte mais fina do tronco, na altura do umbigo, sem apertar a fita." },
  { achar: /quadril/, rotulo: "Quadril", texto: "meça ao redor da parte mais larga do quadril, com os pés juntos e a fita bem reta." },
  { achar: /ombro/, rotulo: "Ombro", texto: "meça de uma ponta do ombro à outra, passando pelas costas." },
  { achar: /manga/, rotulo: "Manga", texto: "meça do ombro até o punho, com o braço levemente dobrado." },
  { achar: /comprimento|altura/, rotulo: "Comprimento", texto: "meça a peça esticada sobre uma superfície plana, do ponto mais alto (ombro ou cós) até a barra." },
];

/** Lê a tabela colada: 1ª linha = títulos, as demais = tamanho e valores. Separador: tab (colar do Excel), ponto e vírgula ou barra vertical. */
export function lerTabela(texto: string): { tabela: TabelaMedidas | null; erros: string[] } {
  const erros: string[] = [];
  const linhas = texto.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (linhas.length < 2) return { tabela: null, erros: ["Informe a linha de títulos e ao menos um tamanho."] };
  const separar = (l: string) => (l.includes("\t") ? l.split("\t") : l.includes(";") ? l.split(";") : l.split("|")).map(limpar);
  const cab = separar(linhas[0]!);
  if (cab.length < 2) return { tabela: null, erros: ["A primeira linha precisa ter o título do tamanho e ao menos uma medida, separados por ponto e vírgula, tab ou barra (|)."] };
  const colunas = cab.slice(1);
  if (colunas.length > MAX_COLUNAS) erros.push(`No máximo ${MAX_COLUNAS} medidas por tabela.`);
  if (colunas.some((c) => c === "" || c.length > 30)) erros.push("Cada título de medida precisa ter de 1 a 30 caracteres.");
  const dados = linhas.slice(1);
  if (dados.length > MAX_TAMANHOS) erros.push(`No máximo ${MAX_TAMANHOS} tamanhos por tabela.`);
  const vistos = new Set<string>();
  const out: TabelaMedidas["linhas"] = [];
  dados.forEach((l, i) => {
    const partes = separar(l);
    const n = i + 2;
    const tamanho = partes[0] ?? "";
    if (tamanho === "" || tamanho.length > 12) return void erros.push(`Linha ${n}: o tamanho precisa ter de 1 a 12 caracteres.`);
    if (vistos.has(tamanho.toLowerCase())) erros.push(`Linha ${n}: o tamanho ${tamanho} aparece duas vezes.`);
    vistos.add(tamanho.toLowerCase());
    const valores = partes.slice(1);
    if (valores.length !== colunas.length) return void erros.push(`Linha ${n} (${tamanho}): esperava ${colunas.length} medida(s) e encontrei ${valores.length}.`);
    for (const [j, v] of valores.entries()) {
      if (!VALOR.test(v)) erros.push(`Linha ${n} (${tamanho}), ${colunas[j]}: “${v}” não é um número (use 86, 86,5 ou uma faixa como 86-90).`);
    }
    out.push({ tamanho, valores: valores.map((v) => v.replace(/\s*(-|–)\s*/, "–")) });
  });
  return erros.length > 0 ? { tabela: null, erros } : { tabela: { colunas, linhas: out }, erros: [] };
}

/** Avisos que não impedem o guia mas merecem conferência: medida que diminui de um tamanho para o seguinte, ou tamanho fora de ordem. */
export function avisosDaTabela(t: TabelaMedidas): string[] {
  const avisos: string[] = [];
  const num = (v: string) => Number(v.split(/–|\//)[0]!.replace(",", "."));
  t.colunas.forEach((c, j) => {
    for (let i = 1; i < t.linhas.length; i++) {
      const a = num(t.linhas[i - 1]!.valores[j]!);
      const b = num(t.linhas[i]!.valores[j]!);
      if (b < a) {
        avisos.push(`${c}: diminui de ${t.linhas[i - 1]!.tamanho} (${t.linhas[i - 1]!.valores[j]}) para ${t.linhas[i]!.tamanho} (${t.linhas[i]!.valores[j]}). Confira se os tamanhos estão do menor para o maior.`);
        break;
      }
    }
  });
  return avisos;
}

/** Monta o guia em HTML simples: tabela, nota da unidade e “como medir” das partes reconhecidas. Todos os valores são os digitados, nenhum é calculado ou sugerido. */
export function montarGuia(texto: string, opts: { tipo: TipoMedida; comoMedir: boolean }): GuiaMontado {
  const titulo = "Guia de medidas";
  if (texto.length > TEXTO_MAX) return { titulo, html: "", erros: [`A tabela pode ter no máximo ${TEXTO_MAX} caracteres.`], avisos: [] };
  const { tabela, erros } = lerTabela(texto);
  if (!tabela) return { titulo, html: "", erros, avisos: [] };
  const nota =
    opts.tipo === "corpo"
      ? "As medidas abaixo são do corpo, em centímetros (cm). Compare com as suas medidas para escolher o tamanho."
      : "As medidas abaixo são da peça, em centímetros (cm), tiradas com a peça esticada sobre uma superfície plana. Compare com uma peça sua que serve bem.";
  const cabecalho = `<tr><th>Tamanho</th>${tabela.colunas.map((c) => `<th>${escapar(c)}</th>`).join("")}</tr>`;
  const corpo = tabela.linhas.map((l) => `<tr><td><strong>${escapar(l.tamanho)}</strong></td>${l.valores.map((v) => `<td>${escapar(v)}</td>`).join("")}</tr>`).join("");
  const reconhecidas = opts.comoMedir ? COMO_MEDIR.filter((m) => tabela.colunas.some((c) => m.achar.test(semAcento(c)))) : [];
  const como = reconhecidas.length > 0 ? `<h3>Como medir</h3><ul>${reconhecidas.map((m) => `<li><strong>${m.rotulo}:</strong> ${m.texto}</li>`).join("")}</ul>` : "";
  const html = sanitizeDescription(`<h2>${titulo}</h2><p>${nota}</p><table><thead>${cabecalho}</thead><tbody>${corpo}</tbody></table>${como}`);
  return { titulo, html, erros: [], avisos: avisosDaTabela(tabela) };
}
