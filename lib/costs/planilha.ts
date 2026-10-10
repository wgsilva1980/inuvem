import ExcelJS from "exceljs";
import { gerarXlsx } from "@/lib/export/xlsx";
import type { LinhaCusto } from "./repo";

export const MAX_LINHAS = 5000;
export const MAX_BYTES = 2 * 1024 * 1024;

export interface LinhaPlanilha {
  /** Número da linha na planilha (a primeira linha de dados é a 2). */
  linha: number;
  id: string | null;
  sku: string | null;
  /** null = célula vazia (a linha é ignorada); "invalido" = não deu para entender o valor. */
  custo: number | null | "invalido";
}

/** "12,50", "R$ 1.234,56", "12.5", 12.5 -> número em reais. Vazio -> null. Negativo, texto ou absurdo -> "invalido". */
export function lerCusto(v: unknown): number | null | "invalido" {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v < 10_000_000 ? Math.round(v * 100) / 100 : "invalido";
  let s = String(v).trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return "invalido";
  const n = Number(s);
  return n < 10_000_000 ? Math.round(n * 100) / 100 : "invalido";
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
const chave = (t: unknown) => semAcento(String(t ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const COL_ID = ["id", "id do produto", "id produto", "produto id", "product id"];
const COL_SKU = ["sku", "codigo", "codigo sku"];
const COL_CUSTO = ["custo", "custo r", "custo atual", "cost", "custo do produto", "custo unitario"];

/** Linhas (matrizes de células) -> linhas da planilha de custos, achando as colunas pelo cabeçalho. */
export function interpretar(linhas: unknown[][]): { linhas: LinhaPlanilha[]; erro?: string } {
  const cab = (linhas[0] ?? []).map(chave);
  const col = (nomes: string[]) => cab.findIndex((c) => nomes.includes(c));
  const iCusto = col(COL_CUSTO);
  const iId = col(COL_ID);
  const iSku = col(COL_SKU);
  if (iCusto < 0) return { linhas: [], erro: "Não achei a coluna “Custo” na primeira linha. Use os cabeçalhos “ID”, “SKU” (um dos dois) e “Custo”." };
  if (iId < 0 && iSku < 0) return { linhas: [], erro: "Não achei a coluna “ID” nem “SKU” na primeira linha." };
  const out: LinhaPlanilha[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i] ?? [];
    const texto = (idx: number) => (idx >= 0 && l[idx] !== null && l[idx] !== undefined ? String(l[idx]).trim() : "") || null;
    const id = texto(iId);
    const sku = texto(iSku);
    if (!id && !sku && lerCusto(l[iCusto]) === null) continue; // linha em branco
    out.push({ linha: i + 1, id: id && /^\d{1,15}$/.test(id.replace(/\.0$/, "")) ? id.replace(/\.0$/, "") : id, sku, custo: lerCusto(l[iCusto]) });
  }
  return { linhas: out };
}

/** CSV simples (aspas, vírgula, ponto e vírgula ou tab). */
export function lerCsv(texto: string): unknown[][] {
  const t = texto.replace(/^﻿/, "");
  const primeira = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].map((s) => ({ s, n: primeira.split(s).length })).sort((a, b) => b.n - a.n)[0]!.s;
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') (campo += '"', i++);
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) (linha.push(campo), (campo = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo);
      campo = "";
      if (linha.some((x) => x !== "")) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x !== "")) linhas.push(linha);
  return linhas;
}

const valorDaCelula = (v: ExcelJS.CellValue): unknown => {
  if (v && typeof v === "object") {
    if ("result" in v) return (v as { result: unknown }).result;
    if ("text" in v) return (v as { text: unknown }).text;
    if ("richText" in v) return (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join("");
    return null;
  }
  return v;
};

/** Lê uma planilha .xlsx ou .csv de custos. */
export async function lerPlanilha(buf: Buffer, nome: string): Promise<{ linhas: LinhaPlanilha[]; erro?: string }> {
  if (buf.length === 0) return { linhas: [], erro: "A planilha está vazia." };
  if (buf.length > MAX_BYTES) return { linhas: [], erro: "A planilha passa de 2 MB." };
  let matriz: unknown[][];
  try {
    if (/\.csv$/i.test(nome) || /\.txt$/i.test(nome)) matriz = lerCsv(buf.toString("utf8"));
    else {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      if (!ws) return { linhas: [], erro: "A planilha não tem nenhuma aba." };
      matriz = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const celulas: unknown[] = [];
        row.eachCell({ includeEmpty: true }, (c, n) => (celulas[n - 1] = valorDaCelula(c.value)));
        matriz.push(celulas);
      });
    }
  } catch {
    return { linhas: [], erro: "Não consegui ler o arquivo. Use uma planilha .xlsx ou .csv." };
  }
  if (matriz.length - 1 > MAX_LINHAS) return { linhas: [], erro: `A planilha passa de ${MAX_LINHAS} linhas.` };
  return interpretar(matriz);
}

/** Planilha para preencher: ID, produto, SKU, preço de venda e custo atual (vazio se não há). */
export async function gerarPlanilhaCustos(linhas: LinhaCusto[]): Promise<Buffer> {
  return gerarXlsx(
    "Custos",
    [
      { titulo: "ID", valor: (l: LinhaCusto) => l.id, largura: 14 },
      { titulo: "Produto", valor: (l) => l.nome, largura: 44 },
      { titulo: "SKU", valor: (l) => l.sku, largura: 18 },
      { titulo: "Preço de venda", valor: (l) => l.preco, formato: "#,##0.00", largura: 16 },
      { titulo: "Custo", valor: (l) => l.custo, formato: "#,##0.00", largura: 14 },
    ],
    linhas,
  );
}
