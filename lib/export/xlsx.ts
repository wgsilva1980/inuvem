import ExcelJS from "exceljs";

export interface Coluna<T> {
  titulo: string;
  valor: (linha: T) => string | number | boolean | Date | null | undefined;
  /** Largura em caracteres. */
  largura?: number;
  /** Formato numérico do Excel (ex.: `#,##0.00`). */
  formato?: string;
}

/** Gera uma planilha .xlsx (uma aba, cabeçalho em negrito e congelado, filtro automático). */
export async function gerarXlsx<T>(aba: string, colunas: Coluna<T>[], linhas: T[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "INuvem";
  wb.created = new Date();
  const ws = wb.addWorksheet(aba.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = colunas.map((c) => ({ header: c.titulo, width: c.largura ?? 16, style: c.formato ? { numFmt: c.formato } : {} }));
  ws.getRow(1).font = { bold: true };
  for (const l of linhas) ws.addRow(colunas.map((c) => c.valor(l) ?? null));
  if (colunas.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Resposta de download do .xlsx; o nome leva a data (AAAA-MM-DD). */
export function respostaXlsx(buf: Buffer, base: string): Response {
  const dia = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": XLSX_MIME, "content-disposition": `attachment; filename="${base}-${dia}.xlsx"`, "cache-control": "no-store" },
  });
}
