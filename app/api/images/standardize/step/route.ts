import { requireAdminApi } from "@/lib/auth/admin";
import { isSameOrigin } from "@/lib/security";
import { query } from "@/lib/db";
import { baixarImagem, desfazerProduto, padronizarPendentes, verificarImagemNaLoja, type ReplaceDeps } from "@/lib/images/replace";
import { blobStorage } from "@/lib/images/storage";
import { NuvemshopError, createImage, deleteImage, getProduct, updateImage, updateVariant } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Padroniza mais um pedaço das fotos (a tela repete até `restantes` ser falso) ou, com `desfazer`, devolve as cópias de um produto.
 * Retomável: o que falta é calculado do espelho; as cópias ficam no Blob e na tabela image_backup.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ error: "O armazenamento das cópias (Blob) não está configurado." }, { status: 409 });

  const body = (await request.json().catch(() => ({}))) as { produtoId?: unknown; ignorar?: unknown; desfazer?: unknown };
  const produtoId = Number.isInteger(body.produtoId) && (body.produtoId as number) > 0 ? (body.produtoId as number) : undefined;
  const ignorar = Array.isArray(body.ignorar) ? body.ignorar.filter((n): n is number => Number.isInteger(n)) : [];
  if (body.desfazer === true && produtoId === undefined) return Response.json({ error: "Informe o produto." }, { status: 400 });

  try {
    const client = await clientForStore(store);
    const deps: ReplaceDeps = {
      db: { query },
      storage: blobStorage,
      baixar: baixarImagem,
      verificar: verificarImagemNaLoja,
      api: {
        getProduct: (pid) => getProduct(client, pid),
        create: (pid, input) => createImage(client, pid, input),
        remove: (pid, iid) => deleteImage(client, pid, iid),
        setPosition: (pid, iid, position) => updateImage(client, pid, iid, { position }),
        setVariantImage: (pid, vid, imageId) => updateVariant(client, pid, vid, { image_id: imageId }),
      },
    };
    if (body.desfazer === true) return Response.json(await desfazerProduto(deps, { storeId: store.id, actor: admin.email, productId: produtoId! }));
    return Response.json(await padronizarPendentes(deps, { storeId: store.id, actor: admin.email, budgetMs: 25_000, produtoId, ignorar }));
  } catch (err) {
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "image.standardize.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao padronizar as imagens." }, { status: 500 });
  }
}
