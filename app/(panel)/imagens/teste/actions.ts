"use server";

import sharp from "sharp";
import { requireAdmin } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { runFormatTest, type FormatTestResult, type ProbeResult } from "@/lib/images/format-test";
import { makeTestImages } from "@/lib/images/test-images";
import { NuvemshopError, createImage, createProduct, deleteProduct } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface FormatTestState {
  result?: FormatTestResult;
  message?: string;
}

async function probe(url: string): Promise<ProbeResult> {
  const base: ProbeResult = { url, ok: false, status: null, contentType: null, bytes: null, width: null, height: null };
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
    base.status = res.status;
    base.contentType = res.headers.get("content-type");
    if (!res.ok) return base;
    const buf = Buffer.from(await res.arrayBuffer());
    base.bytes = buf.length;
    try {
      const meta = await sharp(buf).metadata();
      base.width = meta.width ?? null;
      base.height = meta.height ?? null;
    } catch {
      /* não era imagem legível: fica sem dimensões */
    }
    base.ok = true;
    return base;
  } catch (err) {
    return { ...base, erro: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Cria um produto de teste (rascunho, "ZZ teste de imagem"), envia a mesma imagem em JPEG e em WebP, confere as versões que a loja
 * gera e apaga o produto. Escreve na loja de verdade, por isso só roda quando o admin clica no botão.
 */
export async function runImageFormatTest(_prev: FormatTestState | null, _formData: FormData): Promise<FormatTestState> {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };

  let productId: number | null = null;
  try {
    const client = await clientForStore(store);
    const files = await makeTestImages();
    const result = await runFormatTest(
      {
        createProduct: async () => {
          const p = await createProduct(client, { name: { pt: "ZZ teste de imagem (apagar)" }, published: false, variants: [{ price: "1.00", stock_management: false }] });
          productId = p.id;
          return p.id;
        },
        uploadImage: async (pid, file) => (await createImage(client, pid, { attachment: file.bytes.toString("base64"), filename: file.filename })).src,
        probe,
        deleteProduct: async (pid) => {
          await deleteProduct(client, pid);
          await query("DELETE FROM products WHERE store_id = $1::uuid AND id = $2::bigint", [store.id, pid]); // o webhook pode ter espelhado o produto de teste
        },
      },
      files,
    );
    await query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso)
       VALUES ($1::uuid, $2, 'imagem.teste_formato', 'produto', $3, $4::jsonb, $5)`,
      [store.id, admin.email, productId === null ? null : String(productId), JSON.stringify({ apagado: result.produtoApagado, erro: result.erro ?? null }), !result.erro],
    );
    return { result };
  } catch (err) {
    if (err instanceof NuvemshopError) return { message: err.userMessage };
    console.error(JSON.stringify({ level: "error", event: "image.format_test.failed", message: err instanceof Error ? err.message : String(err) }));
    return { message: "Falha inesperada no teste." };
  }
}
