import type { Db } from "@/lib/sync/repo";
import type { LinhaPlanilha } from "./planilha";
import { definirCustos } from "./repo";

export interface ResultadoImportacao {
  atualizados: number;
  /** Linhas ignoradas, com o motivo (as primeiras 20). */
  ignoradas: Array<{ linha: number; motivo: string }>;
  totalIgnoradas: number;
}

/**
 * Importa os custos de uma planilha já lida. Cada linha acha o produto pelo ID ou, se não houver ID, pelo SKU de uma variação. Linha com custo
 * vazio é pulada (não apaga nada); valor inválido, produto não encontrado ou SKU que aponta para mais de um produto ficam de fora com o motivo.
 * O mesmo produto em duas linhas vale pela última.
 */
export async function importarCustos(db: Db, args: { storeId: string; actor: string; linhas: LinhaPlanilha[] }): Promise<ResultadoImportacao> {
  const ignoradas: ResultadoImportacao["ignoradas"] = [];
  const motivo = (linha: number, m: string) => ignoradas.push({ linha, motivo: m });
  const candidatas = args.linhas.filter((l) => l.custo !== null);

  const skus = [...new Set(candidatas.filter((l) => !l.id && l.sku).map((l) => l.sku as string))];
  const porSku = new Map<string, Set<string>>();
  if (skus.length > 0) {
    for (const r of await db.query<{ sku: string; product_id: string }>("SELECT sku, product_id::text AS product_id FROM variants WHERE store_id = $1::uuid AND sku = ANY($2::text[])", [args.storeId, skus])) {
      porSku.set(r.sku, (porSku.get(r.sku) ?? new Set()).add(r.product_id));
    }
  }

  const finais = new Map<string, number>();
  for (const l of candidatas) {
    if (l.custo === "invalido") {
      motivo(l.linha, "custo inválido (use um número como 12,50)");
      continue;
    }
    let id: string | null = null;
    if (l.id) {
      if (!/^\d{1,15}$/.test(l.id)) {
        motivo(l.linha, `ID inválido (“${l.id.slice(0, 20)}”)`);
        continue;
      }
      id = l.id;
    } else if (l.sku) {
      const ids = porSku.get(l.sku);
      if (!ids || ids.size === 0) {
        motivo(l.linha, `SKU “${l.sku.slice(0, 30)}” não encontrado`);
        continue;
      }
      if (ids.size > 1) {
        motivo(l.linha, `SKU “${l.sku.slice(0, 30)}” aparece em mais de um produto; use o ID`);
        continue;
      }
      id = [...ids][0]!;
    } else {
      motivo(l.linha, "sem ID nem SKU");
      continue;
    }
    finais.set(id, l.custo as number);
  }

  const r = await definirCustos(db, { storeId: args.storeId, actor: args.actor, origem: "planilha", itens: [...finais].map(([productId, custo]) => ({ productId, custo })) });
  // IDs que não existem na loja
  const desconhecidos = new Set(r.desconhecidos);
  if (desconhecidos.size > 0) {
    for (const l of candidatas) if (l.id && desconhecidos.has(l.id)) motivo(l.linha, `produto ${l.id} não encontrado`);
  }
  ignoradas.sort((a, b) => a.linha - b.linha);
  return { atualizados: r.gravados, ignoradas: ignoradas.slice(0, 20), totalIgnoradas: ignoradas.length };
}
