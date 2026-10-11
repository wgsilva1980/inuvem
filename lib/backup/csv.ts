/**
 * CSV para o Excel brasileiro: separador ";", BOM UTF-8 e fim de linha CRLF. Células que começam com = + - @ (ou tab/CR) ganham um apóstrofo na frente
 * para o Excel não executá-las como fórmula (os dados vêm da loja e de clientes, então não são confiáveis).
 */
export type Celula = string | number | boolean | null | undefined | Date;

export function celula(v: Celula): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : typeof v === "number" ? String(v).replace(".", ",") : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv(cabecalho: string[], linhas: Celula[][]): string {
  return `﻿${[cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n")}\r\n`;
}
