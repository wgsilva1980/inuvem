import type { NuvemshopClient } from "./client";
import type { StockPriceItem } from "./types";

/** Atualização em lote de preço/estoque. Ver ressalvas de payload em `StockPriceItem`. */
export const updateStockPrice = (c: NuvemshopClient, items: StockPriceItem[]) => c.patch<unknown>("/products/stock-price", items);
