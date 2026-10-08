"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { aplicarEnquadramento, type EnquadramentoFoto } from "@/lib/catalog/drafts-shared";
import { RascunhoInvalidoError, RascunhoNaoEncontradoError, definirFotos, descartarRascunho, lerEnquadramento, lerFoto, marcarCriado, removerFotoEnviada, salvarRascunho, type EntradaRascunho } from "@/lib/catalog/drafts";
import { query } from "@/lib/db";
import { blobStorage } from "@/lib/images/storage";
import { getActiveStore } from "@/lib/stores";
import { uploadProductImage } from "../[id]/media-actions";

export interface RascunhoResultado {
  ok?: boolean;
  id?: number;
  message?: string;
}

const validId = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

async function contexto() {
  const admin = await requireAdmin();
  const store = await getActiveStore();
  return { admin, store };
}

function falha(err: unknown, evento: string): RascunhoResultado {
  if (err instanceof RascunhoNaoEncontradoError || err instanceof RascunhoInvalidoError) return { message: err.message };
  console.error(JSON.stringify({ level: "error", event: evento, message: err instanceof Error ? err.message : String(err) }));
  return { message: "Falha inesperada. Tente de novo." };
}

/** Cria (id = null) ou atualiza os campos do rascunho. As fotos são enviadas à parte (uma por requisição). */
export async function salvarRascunhoCampos(id: number | null, entrada: EntradaRascunho): Promise<RascunhoResultado> {
  const { admin, store } = await contexto();
  if (!store) return { message: "Nenhuma loja conectada." };
  if (id !== null && !validId(id)) return { message: "Rascunho inválido." };
  try {
    const novo = await salvarRascunho({ query }, { storeId: store.id, actor: admin.email, id, entrada });
    revalidatePath("/produtos/rascunhos");
    return { ok: true, id: novo };
  } catch (err) {
    return falha(err, "draft.save.failed");
  }
}

/** Deixa no rascunho só as fotos listadas (pathnames), na ordem dada, com o enquadramento escolhido de cada uma; as outras saem do Blob. */
export async function definirFotosRascunho(id: number, ordem: string[], opcoes?: Record<string, EnquadramentoFoto>): Promise<RascunhoResultado> {
  const { store } = await contexto();
  if (!store) return { message: "Nenhuma loja conectada." };
  if (!validId(id) || !Array.isArray(ordem)) return { message: "Rascunho inválido." };
  try {
    await definirFotos({ query }, blobStorage, { storeId: store.id, id, ordem: ordem.filter((p): p is string => typeof p === "string").slice(0, 50), opcoes: opcoes && typeof opcoes === "object" ? opcoes : undefined });
    revalidatePath("/produtos/rascunhos");
    return { ok: true, id };
  } catch (err) {
    return falha(err, "draft.photos.failed");
  }
}

export async function descartarRascunhoAction(id: number): Promise<RascunhoResultado> {
  const { store } = await contexto();
  if (!store) return { message: "Nenhuma loja conectada." };
  if (!validId(id)) return { message: "Rascunho inválido." };
  try {
    await descartarRascunho({ query }, blobStorage, { storeId: store.id, id });
    revalidatePath("/produtos/rascunhos");
    return { ok: true };
  } catch (err) {
    return falha(err, "draft.discard.failed");
  }
}

/** O produto foi criado na loja: o rascunho deixa de ser "em aberto" (as fotos pendentes continuam guardadas). */
export async function marcarRascunhoCriado(id: number, productId: number): Promise<RascunhoResultado> {
  const { store } = await contexto();
  if (!store) return { message: "Nenhuma loja conectada." };
  if (!validId(id) || !validId(productId)) return { message: "Rascunho inválido." };
  try {
    await marcarCriado({ query }, { storeId: store.id, id, productId });
    revalidatePath("/produtos/rascunhos");
    return { ok: true, id };
  } catch (err) {
    return falha(err, "draft.mark.failed");
  }
}

/** Envia à loja (padronizada, como qualquer foto nova) uma foto guardada no rascunho e a tira do rascunho se der certo. */
export async function enviarFotoRascunho(id: number, productId: number, pathname: string, opcoes?: EnquadramentoFoto): Promise<RascunhoResultado> {
  const { store } = await contexto();
  if (!store) return { message: "Nenhuma loja conectada." };
  if (!validId(id) || !validId(productId) || typeof pathname !== "string") return { message: "Foto inválida." };
  try {
    const lida = await lerFoto({ query }, blobStorage, { storeId: store.id, id, pathname });
    if (!lida) return { message: "Foto não encontrada no rascunho." };
    const body = new FormData();
    body.set("file", new File([new Uint8Array(lida.bytes)], lida.foto.name, { type: lida.foto.contentType }));
    body.set("padronizar", "1");
    aplicarEnquadramento(body, lerEnquadramento(opcoes) ?? lida.foto.enquadramento ?? null);
    const r = await uploadProductImage(productId, body);
    if (!r.ok) return { message: r.message ?? "Falhou." };
    await removerFotoEnviada({ query }, blobStorage, { storeId: store.id, id, pathname });
    return { ok: true, id };
  } catch (err) {
    return falha(err, "draft.photo.send.failed");
  }
}
