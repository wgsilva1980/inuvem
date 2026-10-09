import "server-only";
import { query } from "@/lib/db";
import { getCategory, getStorePage, listAllPages, updateCategory, updateStorePage, type NuvemshopClient } from "@/lib/nuvemshop";
import type { StoreRow } from "@/lib/stores";
import { clientForStore } from "@/lib/stores";
import { itensDeCategorias, itensDePaginas, type ItemApis, type ItemParaSeo, type TipoItem } from "./item";

export function apisDoCliente(client: NuvemshopClient): ItemApis {
  return {
    categoria: { get: (id) => getCategory(client, id), update: (id, input) => updateCategory(client, id, input) },
    pagina: { get: (id) => getStorePage(client, id), update: (id, input) => updateStorePage(client, id, input) },
  };
}

/** Itens do tipo (categorias do espelho, páginas lidas da loja agora), opcionalmente só os `ids`. */
export async function carregarItens(store: StoreRow, tipo: TipoItem, ids?: string[]): Promise<ItemParaSeo[]> {
  if (tipo === "categoria") return itensDeCategorias({ query }, store.id, ids);
  return itensDePaginas(await listAllPages(await clientForStore(store)), ids);
}
