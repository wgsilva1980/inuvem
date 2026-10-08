import sharp from "sharp";
import { requireAdminApi } from "@/lib/auth/admin";
import { lerFoto } from "@/lib/catalog/drafts";
import { query } from "@/lib/db";
import { blobStorage } from "@/lib/images/storage";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Mostra uma foto guardada num rascunho (o Blob é privado, então passa por aqui): girada e reduzida, só para visualizar. */
export async function GET(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const p = new URL(request.url).searchParams;
  const id = Number(p.get("rascunho"));
  const pathname = p.get("p") ?? "";
  if (!Number.isInteger(id) || id <= 0 || !pathname) return Response.json({ error: "Foto inválida." }, { status: 400 });
  try {
    const lida = await lerFoto({ query }, blobStorage, { storeId: store.id, id, pathname });
    if (!lida) return Response.json({ error: "Foto não encontrada." }, { status: 404 });
    const jpeg = await sharp(lida.bytes, { failOn: "none" }).rotate().resize(900, 900, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
    return new Response(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" } });
  } catch {
    return Response.json({ error: "Não foi possível abrir a foto." }, { status: 502 });
  }
}
