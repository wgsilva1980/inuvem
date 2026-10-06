"use server";

import { requireAdmin } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { rodarAltTeste, type ResultadoAltTeste } from "@/lib/images/alt-test";
import { makeTestImages } from "@/lib/images/test-images";
import { NuvemshopError, createProduct, deleteProduct } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface AltTesteState {
  result?: ResultadoAltTeste;
  message?: string;
}

/**
 * Cria um produto de teste (rascunho, "ZZ teste de alt (apagar)"), tenta gravar o alt por várias rotas, lê o que a loja guardou e
 * apaga o produto. Escreve na loja de verdade, por isso só roda quando o admin clica no botão.
 */
export async function runAltTest(_prev: AltTesteState | null, _formData: FormData): Promise<AltTesteState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  let productId: number | null = null;
  try {
    const client = await clientForStore(store);
    const [jpeg] = await makeTestImages();
    const result = await rodarAltTeste(
      {
        criarProduto: async () => {
          const p = await createProduct(client, { name: { pt: "ZZ teste de alt (apagar)" }, published: false, variants: [{ price: "1.00", stock_management: false }] });
          productId = p.id;
          return p.id;
        },
        post: (caminho, corpo) => client.post(caminho, corpo),
        put: (caminho, corpo) => client.put(caminho, corpo),
        get: (caminho) => client.get(caminho),
        apagarProduto: async (pid) => {
          await deleteProduct(client, pid);
          await query("DELETE FROM products WHERE store_id = $1::uuid AND id = $2::bigint", [store.id, pid]); // o webhook pode ter espelhado o produto de teste
        },
        esperar: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
      jpeg!.bytes.toString("base64"),
    );
    await query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso)
       VALUES ($1::uuid, $2, 'imagem.teste_alt', 'produto', $3, $4::jsonb, $5)`,
      [store.id, admin.email, productId === null ? null : String(productId), JSON.stringify({ apagado: result.produtoApagado, forma: result.formaQueGravou, erro: result.erro ?? null }), !result.erro],
    );
    return { result };
  } catch (err) {
    if (err instanceof NuvemshopError) return { message: err.userMessage };
    console.error(JSON.stringify({ level: "error", event: "image.alt_test.failed", message: err instanceof Error ? err.message : String(err) }));
    return { message: "Falha inesperada no teste." };
  }
}
