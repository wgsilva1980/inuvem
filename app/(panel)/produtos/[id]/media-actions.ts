"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import {
  ProductMissingError,
  moveImage,
  moveImageTo,
  removeImage,
  safeFilename,
  uploadImage,
  sniffImageType,
  validateImageUpload,
  type ImageApi,
} from "@/lib/catalog/images";
import { DuplicateVariantError, InvalidVariantImageError, InvalidVariantValuesError, VariantConflictError, VariantNotFoundError } from "@/lib/catalog/update-variant";
import { padronizarImagem, type Enquadramento, type PadronizarOpcoes, type Tipo } from "@/lib/images/standardize";
import { query } from "@/lib/db";
import {
  NuvemshopError,
  createImage,
  deleteImage,
  getProduct,
  updateImage,
} from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";

export interface ActionState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const fail = (err: unknown, event: string): ActionState => {
  if (err instanceof InvalidVariantValuesError || err instanceof DuplicateVariantError) return { message: err.message };
  if (err instanceof VariantConflictError || err instanceof VariantNotFoundError || err instanceof InvalidVariantImageError || err instanceof ProductMissingError) {
    return { message: err.message };
  }
  if (err instanceof NuvemshopError) return { message: err.userMessage };
  console.error(JSON.stringify({ level: "error", event, message: err instanceof Error ? err.message : String(err) }));
  return { message: "Falha inesperada. Tente novamente." };
};

const validId = (n: number) => Number.isInteger(n) && n > 0;

async function withImages<T>(productId: number, fn: (ctx: { storeId: string; actor: string; api: ImageApi }) => Promise<T>): Promise<T | ActionState> {
  const admin = await requireAdmin();
  if (!validId(productId)) return { message: "Produto inválido." };
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  try {
    const client = await clientForStore(store);
    const api: ImageApi = {
      getProduct: (pid) => getProduct(client, pid),
      create: (pid, input) => createImage(client, pid, input),
      remove: (pid, iid) => deleteImage(client, pid, iid),
      setPosition: (pid, iid, position) => updateImage(client, pid, iid, { position }),
    };
    const result = await fn({ storeId: store.id, actor: admin.email, api });
    revalidatePath(`/produtos/${productId}`);
    revalidatePath("/produtos");
    return result;
  } catch (err) {
    revalidatePath(`/produtos/${productId}`); // a loja pode ter mudado mesmo com erro
    return fail(err, "image.operation.failed");
  }
}

export async function removeProductImage(productId: number, imageId: number): Promise<ActionState> {
  await requireAdmin(); // a autorização vem antes de qualquer leitura do corpo ou validação
  if (!validId(imageId)) return { message: "Imagem inválida." };
  return withImages(productId, async ({ storeId, actor, api }) => {
    await removeImage({ query }, api, { storeId, actor, productId, imageId });
    return { ok: true, message: "Imagem removida." } satisfies ActionState;
  });
}

export async function moveProductImage(productId: number, imageId: number, direction: -1 | 1): Promise<ActionState> {
  await requireAdmin(); // a autorização vem antes de qualquer leitura do corpo ou validação
  if (!validId(imageId) || (direction !== -1 && direction !== 1)) return { message: "Imagem inválida." };
  return withImages(productId, async ({ storeId, actor, api }) => {
    const moved = await moveImage({ query }, api, { storeId, actor, productId, imageId, direction });
    return { ok: true, message: moved ? "Ordem atualizada." : "A imagem já está na ponta." } satisfies ActionState;
  });
}

const TIPOS = new Set(["auto", "peca", "modelo"]);
const ENQUADRAMENTOS = new Set(["auto", "ajustar", "cortar"]);

/** Lê o arquivo do formulário e confere tipo, tamanho e conteúdo (o navegador não é confiável). */
async function lerArquivo(formData: FormData): Promise<{ file: File; bytes: Buffer; real: string } | ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { message: "Escolha um arquivo de imagem." };
  const problem = validateImageUpload(file);
  if (problem) return { message: problem };
  const bytes = Buffer.from(await file.arrayBuffer());
  const real = sniffImageType(bytes);
  if (!real) return { message: "O conteúdo do arquivo não é uma imagem JPEG, PNG, WEBP ou GIF." };
  return { file, bytes, real };
}

function opcoesDoFormulario(formData: FormData): PadronizarOpcoes {
  const tipo = String(formData.get("tipo") ?? "auto");
  const enquadramento = String(formData.get("enquadramento") ?? "auto");
  return { tipo: TIPOS.has(tipo) ? (tipo as PadronizarOpcoes["tipo"]) : "auto", enquadramento: ENQUADRAMENTOS.has(enquadramento) ? (enquadramento as PadronizarOpcoes["enquadramento"]) : "auto" };
}

export interface PreviewState {
  ok?: boolean;
  message?: string;
  /** GIF (ou "sem padronizar"): vai como está. */
  semPadronizar?: boolean;
  dataUrl?: string;
  largura?: number;
  altura?: number;
  bytes?: number;
  tipo?: Tipo;
  enquadramento?: Enquadramento;
  fundo?: string;
  fundoUniforme?: boolean;
  avisos?: string[];
  original?: { largura: number; altura: number; bytes: number };
}

/** Mostra como a foto ficará no padrão (1024×1024 ou 820×1024, JPEG) sem enviar nada à loja. */
export async function previewProductImage(formData: FormData): Promise<PreviewState> {
  await requireAdmin();
  const lido = await lerArquivo(formData);
  if (!("bytes" in lido)) return lido;
  if (lido.real === "image/gif") return { ok: true, semPadronizar: true, message: "GIF é enviado como está (padronizar perderia a animação)." };
  try {
    const r = await padronizarImagem(lido.bytes, opcoesDoFormulario(formData));
    return {
      ok: true,
      dataUrl: `data:image/jpeg;base64,${r.bytes.toString("base64")}`,
      largura: r.largura,
      altura: r.altura,
      bytes: r.bytes.length,
      tipo: r.tipo,
      enquadramento: r.enquadramento,
      fundo: r.fundo,
      fundoUniforme: r.fundoUniforme,
      avisos: r.avisos,
      original: r.original,
    };
  } catch {
    return { message: "Não foi possível ler esta imagem. Tente outro arquivo." };
  }
}

/**
 * Envia a foto à loja. Por padrão ela é padronizada aqui no servidor (as mesmas opções da prévia) antes de seguir; `padronizar=0`
 * (ou GIF) envia o arquivo como está.
 */
export async function uploadProductImage(productId: number, formData: FormData): Promise<ActionState> {
  await requireAdmin(); // a autorização vem antes de qualquer leitura do corpo ou validação
  const lido = await lerArquivo(formData);
  if (!("bytes" in lido)) return lido;
  const { file, real } = lido;
  let { bytes } = lido;
  let filename = safeFilename(file.name, real);
  let detalhes: Record<string, unknown> | undefined;

  if (real !== "image/gif" && formData.get("padronizar") !== "0") {
    try {
      const r = await padronizarImagem(bytes, opcoesDoFormulario(formData));
      bytes = r.bytes;
      filename = safeFilename(file.name, "image/jpeg");
      detalhes = { padronizada: true, tipo: r.tipo, enquadramento: r.enquadramento, largura: r.largura, altura: r.altura, original: r.original };
    } catch {
      return { message: "Não foi possível padronizar esta imagem. Tente outro arquivo." };
    }
  }
  return withImages(productId, async ({ storeId, actor, api }) => {
    await uploadImage({ query }, api, { storeId, actor, productId, filename, bytes, detalhes });
    return { ok: true, message: "Imagem enviada à Nuvemshop." } satisfies ActionState;
  });
}

export async function setMainProductImage(productId: number, imageId: number): Promise<ActionState> {
  await requireAdmin(); // a autorização vem antes de qualquer leitura do corpo ou validação
  if (!validId(imageId)) return { message: "Imagem inválida." };
  return withImages(productId, async ({ storeId, actor, api }) => {
    const moved = await moveImageTo({ query }, api, { storeId, actor, productId, imageId, toIndex: 0 });
    return { ok: true, message: moved ? "Imagem principal atualizada." : "Esta já é a imagem principal." } satisfies ActionState;
  });
}
