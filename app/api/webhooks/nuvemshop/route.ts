import { getEnv } from "@/lib/env";
import { query, queryOne } from "@/lib/db";
import { getCategory, getProduct, updateProduct } from "@/lib/nuvemshop";
import { SIGNATURE_HEADER } from "@/lib/nuvemshop/webhook-verify";
import { clientForStore } from "@/lib/stores";
import { handleWebhook, type StoreRef } from "@/lib/webhooks/handler";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Webhooks de produtos e categorias. Público (a Nuvemshop não tem sessão): a autenticação é a assinatura HMAC. */
export async function POST(request: Request) {
  const raw = await request.text();
  const result = await handleWebhook(
    {
      db: { query },
      clientSecret: getEnv().NUVEMSHOP_CLIENT_SECRET,
      findStore: (nuvemshopStoreId) =>
        queryOne<StoreRef>("SELECT id, nuvemshop_store_id::text AS nuvemshop_store_id FROM stores WHERE nuvemshop_store_id = $1", [nuvemshopStoreId]),
      apiFor: async (store) => {
        const client = await clientForStore(store);
        return {
          getProduct: (id) => getProduct(client, id),
          getCategory: (id) => getCategory(client, id),
          setPublished: (id, published) => updateProduct(client, id, { published }),
        };
      },
    },
    raw,
    request.headers.get(SIGNATURE_HEADER),
  );
  return Response.json(result.body, { status: result.status });
}
