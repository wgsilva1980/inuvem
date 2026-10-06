"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { salvarAltEditado } from "@/lib/images/review";
import { altApiDoCliente, diagnosticarAlt, type PassoDiagnostico } from "@/lib/images/review-api";
import { NuvemshopError } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface AltState {
  ok?: boolean;
  message?: string;
}

/** Salva o texto alternativo editado e envia à loja. */
export async function salvarAltAction(productId: number, imageId: string, _prev: AltState | null, formData: FormData): Promise<AltState> {
  const admin = await requireAdmin();
  if (!Number.isInteger(productId) || productId <= 0 || !/^\d+$/.test(imageId)) return { message: "Foto inválida." };
  const texto = String(formData.get("alt") ?? "");
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  try {
    const client = await clientForStore(store);
    await salvarAltEditado({ query }, altApiDoCliente(client), { storeId: store.id, actor: admin.email, productId, imageId, texto });
    revalidatePath("/imagens/revisao");
    return { ok: true, message: "Texto salvo na loja." };
  } catch (err) {
    if (err instanceof NuvemshopError) return { message: err.userMessage };
    if (err instanceof Error && /^(a foto não|o texto alternativo|a loja não gravou)/.test(err.message)) return { message: err.message };
    console.error(JSON.stringify({ level: "error", event: "image.alt.save.failed", message: err instanceof Error ? err.message : String(err) }));
    return { message: "Falha inesperada. Tente novamente." };
  }
}

export interface DiagnosticoState {
  passos?: PassoDiagnostico[];
  message?: string;
}

/** Mostra como a loja reage ao envio do alt (formato aceito, resposta, leitura logo depois e após uma pausa). */
export async function diagnosticarAltAction(productId: number, imageId: string, texto: string): Promise<DiagnosticoState> {
  await requireAdmin();
  const limpo = texto.trim().replace(/\s+/g, " ").slice(0, 250);
  if (!Number.isInteger(productId) || productId <= 0 || !/^\d+$/.test(imageId) || !limpo) return { message: "Foto ou texto inválido." };
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  try {
    const client = await clientForStore(store);
    return { passos: await diagnosticarAlt(client, productId, Number(imageId), limpo) };
  } catch (err) {
    if (err instanceof NuvemshopError) return { message: err.userMessage };
    console.error(JSON.stringify({ level: "error", event: "image.alt.diagnostic.failed", message: err instanceof Error ? err.message : String(err) }));
    return { message: "Falha inesperada no diagnóstico." };
  }
}
