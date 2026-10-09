import "server-only";
import type { BulkApi } from "@/lib/bulk/engine";
import { deleteProduct, getProduct, updateProduct, updateVariant } from "@/lib/nuvemshop";
import { clientForStore } from "@/lib/stores";

type Loja = Parameters<typeof clientForStore>[0];

/** Acesso à API da Nuvemshop para os lotes de uma loja (mesmo que a tela de lotes usa). */
export async function bulkApiDaLoja(store: Loja): Promise<BulkApi> {
  const client = await clientForStore(store);
  return {
    getProduct: (pid) => getProduct(client, pid),
    updateProduct: (pid, input) => updateProduct(client, pid, input),
    deleteProduct: (pid) => deleteProduct(client, pid),
    updateVariant: (pid, vid, input) => updateVariant(client, pid, vid, input),
  };
}
