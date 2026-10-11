import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { executarTesteDeGravacao } from "@/lib/diagnostico/gravacao";
import { createCoupon, createProduct, deleteProduct, getProduct, getVariant, updateCoupon, updateProduct, updateVariant } from "@/lib/nuvemshop";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ confirmo: z.literal(true) });

/**
 * Teste de gravação: cria um produto de teste oculto e um cupom desativado, mexe neles (estoque, preço, nome, SEO) e apaga tudo, para confirmar que o painel
 * consegue escrever na loja. Só toca no que ele mesmo cria. Exige confirmação explícita; até 5 por hora.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if (!bodySchema.safeParse(await request.json().catch(() => null)).success) return Response.json({ error: "Confirme que quer rodar o teste." }, { status: 400 });
  if ((await hit({ query }, `diagnostico-gravacao:${admin.email}`, 3600)) > 5) return Response.json({ error: "Muitos testes na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  let produtoId: number | null = null;
  try {
    const c = await clientForStore(store);
    const r = await executarTesteDeGravacao({
      criarProduto: (input) => createProduct(c, input),
      lerProduto: (id) => getProduct(c, id),
      alterarProduto: (id, input) => updateProduct(c, id, input),
      lerVariacao: (pid, vid) => getVariant(c, pid, vid),
      alterarVariacao: (pid, vid, input) => updateVariant(c, pid, vid, input),
      apagarProduto: (id) => deleteProduct(c, id),
      criarCupom: (input) => createCoupon(c, input),
      alterarCupom: (id, input) => updateCoupon(c, id, input),
      apagarCupom: (id) => c.delete(`/coupons/${id}`),
    });
    produtoId = r.produtoDeTesteId;
    await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois, sucesso) VALUES ($1::uuid, $2, 'diagnostico.gravacao', 'loja', $3::jsonb, $4)`, [
      store.id,
      admin.email,
      JSON.stringify({ passos: Object.fromEntries(r.passos.map((p) => [p.id, p.status])), sobras: r.sobras.length }),
      r.tudoCerto,
    ]);
    return Response.json(r);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "diagnostico.gravacao.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada no teste. Confira em Produtos e em Cupons, no admin da Nuvemshop, se ficou algo com “ZZ TESTE INUVEM” ou “INUVEMTESTE”." }, { status: 500 });
  } finally {
    // o webhook de produto criado pode ter colocado o produto de teste no espelho: tira de lá (a loja já o apagou, ou o aviso de exclusão chega e faz o mesmo)
    if (produtoId !== null) await query("DELETE FROM products WHERE store_id = $1::uuid AND id = $2::bigint", [store.id, produtoId]).catch(() => undefined);
  }
}
