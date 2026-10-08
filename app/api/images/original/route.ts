import sharp from "sharp";
import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { copiaDaFoto } from "@/lib/images/reenquadrar";
import { blobStorage } from "@/lib/images/storage";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LADO_MAX = 1600;

/**
 * Mostra, no editor de enquadramento, a cópia guardada do original de uma foto já padronizada (o Blob é privado, então passa por aqui).
 * Sai girada (EXIF) e reduzida: o editor só precisa da mesma proporção; o recorte é refeito no servidor sobre o arquivo completo.
 */
export async function GET(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const p = new URL(request.url).searchParams;
  const produto = Number(p.get("produto"));
  const imagem = Number(p.get("imagem"));
  if (!Number.isInteger(produto) || produto <= 0 || !Number.isInteger(imagem) || imagem <= 0) return Response.json({ error: "Foto inválida." }, { status: 400 });

  const copia = await copiaDaFoto({ query }, store.id, produto, imagem);
  if (!copia) return Response.json({ error: "Esta foto não tem cópia do original." }, { status: 404 });
  try {
    const bytes = await blobStorage.get(copia.blob_pathname);
    const jpeg = await sharp(bytes, { failOn: "none" })
      .rotate()
      .resize(LADO_MAX, LADO_MAX, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
    return new Response(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Não foi possível abrir a cópia do original." }, { status: 502 });
  }
}
