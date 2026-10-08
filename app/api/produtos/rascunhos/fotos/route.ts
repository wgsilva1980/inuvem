import { requireAdminApi } from "@/lib/auth/admin";
import { MAX_UPLOAD_BYTES, sniffImageType } from "@/lib/catalog/images";
import { RascunhoInvalidoError, RascunhoNaoEncontradoError, adicionarFoto } from "@/lib/catalog/drafts";
import { query } from "@/lib/db";
import { blobStorage } from "@/lib/images/storage";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Guarda uma foto no rascunho (Blob privado). O navegador manda uma foto por requisição. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ error: "O armazenamento das fotos (Blob) não está configurado." }, { status: 409 });

  const form = await request.formData().catch(() => null);
  const id = Number(form?.get("rascunho"));
  const arquivo = form?.get("file");
  if (!form || !Number.isInteger(id) || id <= 0 || !(arquivo instanceof File)) return Response.json({ error: "Requisição inválida." }, { status: 400 });
  if (arquivo.size <= 0 || arquivo.size > MAX_UPLOAD_BYTES) return Response.json({ error: "A foto passa de 4 MB." }, { status: 400 });
  const bytes = Buffer.from(await arquivo.arrayBuffer());
  const tipo = sniffImageType(bytes);
  if (!tipo) return Response.json({ error: "O conteúdo do arquivo não é uma imagem JPEG, PNG, WEBP ou GIF." }, { status: 400 });

  try {
    const foto = await adicionarFoto({ query }, blobStorage, { storeId: store.id, id, nome: arquivo.name, contentType: tipo, bytes });
    return Response.json(foto);
  } catch (err) {
    if (err instanceof RascunhoNaoEncontradoError || err instanceof RascunhoInvalidoError) return Response.json({ error: err.message }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "draft.photo.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Não foi possível guardar a foto." }, { status: 502 });
  }
}
