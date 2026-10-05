import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { pt, type I18n, type Product, type ProductInput, type Variant, type VariantInput } from "@/lib/nuvemshop/types";
import { mapVariant, toNumber } from "@/lib/sync/mappers";
import { upsertProducts, upsertVariantRows, type Db } from "@/lib/sync/repo";
import { valuesToStrings } from "@/lib/catalog/variants";
import { fromCents, toCents, type ItemChanges, type Plan, type PlanItem, type VariantChange } from "./operations";
import {
  claimItems,
  completeItem,
  createJob,
  finishIfDone,
  getJob,
  getJobItems,
  jobStatus,
  JobStateError,
  type ItemResult,
  type Job,
  type JobItem,
} from "./repo";

/** Acesso à API da Nuvemshop (injetado para testar sem rede). */
export interface BulkApi {
  getProduct(id: number): Promise<Product>;
  updateProduct(id: number, input: ProductInput): Promise<Product>;
  deleteProduct(id: number): Promise<void>;
  updateVariant(productId: number, variantId: number, input: VariantInput): Promise<Variant>;
}

const errorText = (err: unknown) => (err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err));

/* ---------- conferência: a loja ainda está como na pré-visualização? ---------- */

const money = (value: unknown): string | null => {
  const n = toNumber(value);
  return n === null ? null : fromCents(toCents(n));
};
const sameMoney = (a: string | null, b: string | null) => (a === null || b === null ? a === b : toCents(a) === toCents(b));
const sameIds = (a: number[], b: number[]) => {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.length === y.length && x.every((n, i) => n === y[i]);
};

/** Compara o que a loja tem agora com o "antes" do lote. Devolve o que diverge (vazio = pode aplicar). */
export function findMismatches(remote: Product, changes: ItemChanges): string[] {
  const out: string[] = [];
  const p = changes.product;
  if (p?.published && (remote.published ?? false) !== p.published.antes) out.push("situação (publicado)");
  if (p?.categories && !sameIds((remote.categories ?? []).map((c) => c.id), p.categories.antes)) out.push("categorias");
  if (p?.attributes) {
    const now = (remote.attributes ?? []).map((a) => pt(a));
    if (now.length !== p.attributes.antes.length || now.some((n, i) => n !== p.attributes!.antes[i])) out.push("propriedades das variações");
  }
  for (const vc of changes.variants) {
    const rv = (remote.variants ?? []).find((v) => v.id === vc.id);
    if (!rv) {
      out.push(`variante "${vc.label}" não existe mais`);
      continue;
    }
    if (vc.price && !sameMoney(money(rv.price), vc.price.antes)) out.push(`preço de "${vc.label}"`);
    if (vc.promotional_price && !sameMoney(money(rv.promotional_price), vc.promotional_price.antes)) out.push(`preço promocional de "${vc.label}"`);
    if (vc.values) {
      const agora = valuesToStrings(rv.values);
      if (agora.length !== vc.values.antes.length || agora.some((x, i) => x !== vc.values!.antes[i])) out.push(`valores de "${vc.label}"`);
    }
    if (vc.stock) {
      if (!(rv.stock_management ?? false)) out.push(`estoque de "${vc.label}" (controle desligado)`);
      else if ((rv.stock ?? null) !== vc.stock.antes && !(rv.stock == null && vc.stock.antes == null)) out.push(`estoque de "${vc.label}"`);
    }
  }
  return out;
}

/** `current` é a variante na loja agora: serve para manter outros idiomas dos valores. */
const variantInput = (vc: VariantChange, current?: Variant): VariantInput => {
  const input: VariantInput = {};
  if (vc.values) {
    const atuais = Array.isArray(current?.values) ? (current!.values as I18n[]) : [];
    // os objetos multi-idioma andam junto com o valor, mesmo quando a ordem muda ou uma propriedade é acrescentada
    const vals = vc.values;
    input.values = vals.depois.map((valor, i) => ({ ...(fonteDe(atuais, i, vals) ?? {}), pt: valor }));
  }
  if (vc.price) input.price = vc.price.depois;
  if (vc.promotional_price) input.promotional_price = vc.promotional_price.depois;
  if (vc.stock) input.stock = vc.stock.depois;
  return input;
};

/** Quem veio de uma posição antiga leva o objeto multi-idioma dela; posições novas começam vazias. */
function fonteDe<T>(base: T[], i: number, c: { trocar?: boolean; de?: Array<number | null> }): T | undefined {
  if (c.de) {
    const j = c.de[i];
    return j === null || j === undefined ? undefined : base[j];
  }
  if (c.trocar) return [...base].reverse()[i];
  return base[i];
}

/** Corpo do PUT do produto. `remote` é o produto na loja agora: serve para manter outros idiomas dos nomes das propriedades. */
const productInput = (c: ItemChanges["product"], remote: Product): ProductInput => {
  const input: ProductInput = {};
  if (c?.published) input.published = c.published.depois;
  if (c?.categories) input.categories = c.categories.depois;
  if (c?.attributes) {
    // os objetos multi-idioma andam junto com o nome, mesmo quando a ordem muda ou uma propriedade é acrescentada
    const base = remote.attributes ?? [];
    const attrs = c.attributes;
    input.attributes = attrs.depois.map((nome, i) => ({ ...(fonteDe(base, i, attrs) ?? {}), pt: nome }));
  }
  return input;
};

/** O "antes" e o "depois" de um item, num formato enxuto para o histórico. */
function sides(changes: ItemChanges, side: "antes" | "depois") {
  const out: Record<string, unknown> = {};
  if (changes.product?.excluir) out.excluido = side === "antes" ? changes.product.excluir : true;
  if (changes.product?.published) out.publicado = changes.product.published[side];
  if (changes.product?.categories) out.categorias = changes.product.categories[side];
  if (changes.product?.attributes) out.propriedades = changes.product.attributes[side];
  for (const v of changes.variants) {
    const fields: Record<string, unknown> = {};
    if (v.price) fields.preco = v.price[side];
    if (v.promotional_price) fields.preco_promocional = v.promotional_price[side];
    if (v.stock) fields.estoque = v.stock[side];
    if (v.values) fields.valores = v.values[side];
    (out.variantes ??= {} as Record<string, unknown>) as Record<string, unknown>;
    (out.variantes as Record<string, unknown>)[String(v.id)] = fields;
  }
  return out;
}

async function audit(db: Db, a: { storeId: string; actor: string; job: Job; item: JobItem; resultado: ItemResult; sucesso: boolean }) {
  const op = a.job.operation.type;
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
     VALUES ($1::uuid, $2, $3, 'produto', $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)`,
    [
      a.storeId,
      a.actor,
      `lote.${op}`,
      String(a.item.product_id),
      JSON.stringify({ lote: a.job.id, ...sides(a.item.changes, "antes") }),
      JSON.stringify(sides(a.item.changes, "depois")),
      JSON.stringify(a.resultado),
      a.sucesso,
    ],
  );
}

/** Reflete a loja no espelho (a Nuvemshop é a fonte da verdade). Falha aqui não invalida o que já foi aplicado. */
async function refreshMirror(db: Db, api: BulkApi, storeId: string, productId: number) {
  try {
    await upsertProducts(db, storeId, [await api.getProduct(productId)]);
  } catch {
    /* o webhook de produto atualizado ou a próxima sincronização corrigem */
  }
}

/* ---------- execução de um produto ---------- */

export async function runItem(db: Db, api: BulkApi, ctx: { storeId: string; actor: string; job: Job }, item: JobItem): Promise<"ok" | "error" | "conflict"> {
  const { storeId, actor, job } = ctx;
  const productId = Number(item.product_id);
  const finish = async (status: "ok" | "error" | "conflict", resultado: ItemResult) => {
    await completeItem(db, job.id, item.seq, status, resultado);
    await audit(db, { storeId, actor, job, item, resultado, sucesso: status === "ok" });
    return status;
  };

  if (item.changes.product?.excluir) return runDelete(db, api, ctx, item, finish);

  let remote: Product;
  try {
    remote = await api.getProduct(productId);
  } catch (err) {
    return finish("error", { mensagem: err instanceof NuvemshopError && err.status === 404 ? "O produto não existe mais na loja." : errorText(err) });
  }

  const mismatches = findMismatches(remote, item.changes);
  if (mismatches.length > 0) {
    await upsertProducts(db, storeId, [remote]); // o espelho passa a refletir a loja
    return finish("conflict", { mensagem: `A loja mudou desde a pré-visualização: ${mismatches.slice(0, 3).join(", ")}${mismatches.length > 3 ? "…" : ""}. Nada foi alterado neste produto.` });
  }

  const partes: NonNullable<ItemResult["partes"]> = [];
  let failed = false;
  const attempt = async (tipo: "produto" | "variante", id: number | undefined, fn: () => Promise<unknown>) => {
    if (failed) {
      partes.push({ tipo, id, ok: false, erro: "não executado (houve erro antes)" });
      return;
    }
    try {
      await fn();
      partes.push({ tipo, id, ok: true });
    } catch (err) {
      failed = true;
      partes.push({ tipo, id, ok: false, erro: errorText(err) });
    }
  };

  const pInput = productInput(item.changes.product, remote);
  if (Object.keys(pInput).length > 0) await attempt("produto", undefined, () => api.updateProduct(productId, pInput));
  for (const vc of item.changes.variants) {
    await attempt("variante", vc.id, async () => {
      const updated = await api.updateVariant(productId, vc.id, variantInput(vc, (remote.variants ?? []).find((x) => x.id === vc.id)));
      await upsertVariantRows(db, storeId, [mapVariant(updated, productId)]);
    });
  }

  // Alterações em várias etapas que só fazem sentido juntas (ordem das propriedades + valores das variantes):
  // se algo falhar, ou a loja não ficar como esperado, desfaz o que já foi aplicado.
  let mensagemAtomica: string | undefined;
  if (precisaDeTudoOuNada(item.changes)) {
    let motivo: string | null = failed ? (partes.find((p) => !p.ok && p.erro && !p.erro.startsWith("não executado"))?.erro ?? "uma das etapas falhou") : null;
    if (!failed) {
      motivo = await conferirAplicado(api, productId, item.changes);
      if (motivo) failed = true;
    }
    // frase sem ponto final repetido e com a primeira letra maiúscula
    const frase = (motivo ?? "").replace(/[.\s]+$/, "").replace(/^./, (c) => c.toLocaleUpperCase("pt-BR"));
    if (failed && partes.some((p) => p.ok)) {
      const falhas = await desfazerPartes(api, remote, productId, partes);
      mensagemAtomica =
        falhas.length === 0
          ? `${frase}. A alteração foi desfeita: o produto ficou como estava.`
          : `ATENÇÃO: ${frase}. Não foi possível desfazer tudo (${falhas.join("; ")}). Confira este produto na loja.`;
    } else if (failed) {
      mensagemAtomica = `${frase}. Nada foi alterado neste produto.`;
    }
  }
  await refreshMirror(db, api, storeId, productId);

  const resultado: ItemResult = { partes };
  if (failed) resultado.mensagem = mensagemAtomica ?? partes.find((p) => !p.ok && p.erro && !p.erro.startsWith("não executado"))?.erro;
  return finish(failed ? "error" : "ok", resultado);
}

/** Exclusão do produto: confere que ele ainda é o mesmo da pré-visualização (nome), exclui na loja e tira do espelho. 404 = já excluído. */
async function runDelete(
  db: Db,
  api: BulkApi,
  ctx: { storeId: string; job: Job },
  item: JobItem,
  finish: (status: "ok" | "error" | "conflict", resultado: ItemResult) => Promise<"ok" | "error" | "conflict">,
): Promise<"ok" | "error" | "conflict"> {
  const productId = Number(item.product_id);
  const esperado = item.changes.product?.excluir?.nome ?? "";
  const removeMirror = () => db.query("DELETE FROM products WHERE store_id = $1::uuid AND id = $2::bigint", [ctx.storeId, productId]);
  try {
    const remote = await api.getProduct(productId);
    const agora = pt(remote.name as I18n);
    if (esperado !== `Produto ${productId}` && agora !== esperado) {
      await upsertProducts(db, ctx.storeId, [remote]);
      return finish("conflict", { mensagem: `O produto foi renomeado na loja desde a pré-visualização (agora “${agora}”). Nada foi excluído.` });
    }
  } catch (err) {
    if (err instanceof NuvemshopError && err.status === 404) {
      await removeMirror();
      return finish("ok", { partes: [{ tipo: "produto", ok: true }], mensagem: "O produto já não existia na loja." });
    }
    return finish("error", { mensagem: errorText(err) });
  }
  try {
    await api.deleteProduct(productId);
  } catch (err) {
    if (!(err instanceof NuvemshopError && err.status === 404)) return finish("error", { mensagem: errorText(err), partes: [{ tipo: "produto", ok: false, erro: errorText(err) }] });
  }
  await removeMirror();
  return finish("ok", { partes: [{ tipo: "produto", ok: true }] });
}

/* ---------- alterações de tudo ou nada ---------- */

/** Propriedades e valores das variantes mudam juntos: um sem o outro deixa cada valor sob a propriedade errada. */
export const precisaDeTudoOuNada = (changes: ItemChanges): boolean => Boolean(changes.product?.attributes) && changes.variants.some((v) => v.values);

/** Depois de aplicar, relê o produto e confere nomes e valores. Devolve o que não bate, ou null se está como esperado. */
async function conferirAplicado(api: BulkApi, productId: number, changes: ItemChanges): Promise<string | null> {
  let atual: Product;
  try {
    atual = await api.getProduct(productId);
  } catch (err) {
    return `não foi possível reler o produto para conferir (${errorText(err)})`;
  }
  const esperadosAttrs = changes.product?.attributes?.depois;
  if (esperadosAttrs) {
    const nomes = (atual.attributes ?? []).map((a) => pt(a));
    if (nomes.length !== esperadosAttrs.length || nomes.some((n, i) => n !== esperadosAttrs[i])) return `a loja ficou com as propriedades "${nomes.join(" | ")}" em vez de "${esperadosAttrs.join(" | ")}"`;
  }
  for (const vc of changes.variants) {
    if (!vc.values) continue;
    const rv = (atual.variants ?? []).find((v) => v.id === vc.id);
    const agora = valuesToStrings(rv?.values);
    if (!rv || agora.length !== vc.values.depois.length || agora.some((x, i) => x !== vc.values!.depois[i])) return `a variante "${vc.label}" ficou com valores diferentes do esperado`;
  }
  return null;
}

/** Restaura o que foi aplicado (do último para o primeiro), usando os objetos originais da loja. Devolve o que não conseguiu desfazer. */
async function desfazerPartes(api: BulkApi, original: Product, productId: number, partes: NonNullable<ItemResult["partes"]>): Promise<string[]> {
  const falhas: string[] = [];
  for (const parte of [...partes].reverse()) {
    if (!parte.ok) continue;
    try {
      if (parte.tipo === "variante") {
        const antes = (original.variants ?? []).find((v) => v.id === parte.id);
        await api.updateVariant(productId, parte.id as number, { values: antes?.values ?? [] });
      } else {
        await api.updateProduct(productId, { attributes: original.attributes ?? [] });
      }
      parte.ok = false;
      parte.erro = "desfeita (houve um problema depois)";
    } catch (err) {
      falhas.push(`${parte.tipo === "variante" ? `variante ${parte.id}` : "propriedades"}: ${errorText(err)}`);
    }
  }
  return falhas;
}

/* ---------- passo do lote (chamado repetidamente pela tela) ---------- */

export interface StepResult {
  done: boolean;
  status: Job["status"];
  processed: number;
}

/**
 * Processa produtos pendentes até estourar o orçamento de tempo (a Vercel limita cada chamada). Retomável:
 * o estado fica no banco, e dois passos simultâneos nunca pegam o mesmo produto.
 */
export async function stepJob(
  db: Db,
  api: BulkApi,
  args: { storeId: string; actor: string; jobId: string; budgetMs: number; batch?: number; now?: () => number },
): Promise<StepResult> {
  const now = args.now ?? Date.now;
  const started = now();
  const job = await getJob(db, args.storeId, args.jobId);
  if (!job) throw new JobStateError("Lote não encontrado.");
  if (job.status !== "running") return { done: true, status: job.status, processed: 0 };

  let processed = 0;
  while (now() - started < args.budgetMs) {
    const status = await jobStatus(db, args.jobId);
    if (status !== "running") return { done: true, status: status ?? "cancelled", processed };
    const items = await claimItems(db, args.jobId, args.batch ?? 3);
    if (items.length === 0) {
      const finished = await finishIfDone(db, args.jobId);
      return { done: finished || (await jobStatus(db, args.jobId)) !== "running", status: finished ? "completed" : "running", processed };
    }
    for (const item of items) {
      await runItem(db, api, { storeId: args.storeId, actor: args.actor, job }, item);
      processed++;
    }
  }
  return { done: false, status: "running", processed };
}

/* ---------- reverter ---------- */

/** Mapa de volta: para cada posição antiga, de qual posição nova ela veio (null se foi removida ao reverter). */
const inverterDe = (de: Array<number | null>, nAntes: number): Array<number | null> =>
  Array.from({ length: nAntes }, (_, i) => {
    const j = de.indexOf(i);
    return j >= 0 ? j : null;
  });

/** Troca "antes" e "depois", só das partes que foram de fato aplicadas. */
export function buildRevertChanges(changes: ItemChanges, resultado: ItemResult | null): ItemChanges | null {
  const partes = resultado?.partes ?? [];
  const okProduct = partes.some((p) => p.tipo === "produto" && p.ok);
  const okVariants = new Set(partes.filter((p) => p.tipo === "variante" && p.ok).map((p) => p.id));
  const out: ItemChanges = { variants: [] };

  if (changes.product?.excluir) return null; // exclusão não tem volta
  if (okProduct && changes.product) {
    out.product = {};
    if (changes.product.published) out.product.published = { antes: changes.product.published.depois, depois: changes.product.published.antes };
    if (changes.product.categories) out.product.categories = { antes: changes.product.categories.depois, depois: changes.product.categories.antes };
    if (changes.product.attributes) {
      const a = changes.product.attributes;
      out.product.attributes = { antes: a.depois, depois: a.antes, ...(a.trocar ? { trocar: true } : {}), ...(a.de ? { de: inverterDe(a.de, a.antes.length) } : {}) };
    }
  }
  for (const v of changes.variants) {
    if (!okVariants.has(v.id)) continue;
    const inv: VariantChange = { id: v.id, label: v.label, sku: v.sku };
    if (v.price) inv.price = { antes: v.price.depois, depois: v.price.antes };
    if (v.promotional_price) inv.promotional_price = { antes: v.promotional_price.depois, depois: v.promotional_price.antes };
    if (v.values) inv.values = { antes: v.values.depois, depois: v.values.antes, ...(v.values.trocar ? { trocar: true } : {}), ...(v.values.de ? { de: inverterDe(v.values.de, v.values.antes.length) } : {}) };
    if (v.stock) {
      // o estoque original pode ser "sem quantidade" (null): ao reverter, volta para 0, o mais próximo possível
      inv.stock = { antes: v.stock.depois, depois: v.stock.antes ?? 0 };
    }
    out.variants.push(inv);
  }
  return out.product || out.variants.length > 0 ? out : null;
}

/** Cria um lote (em pré-visualização) que desfaz o que o lote original aplicou com sucesso. Cada lote só pode ser revertido uma vez. */
export async function createRevertJob(db: Db, args: { storeId: string; actor: string; jobId: string }): Promise<string> {
  const job = await getJob(db, args.storeId, args.jobId);
  if (!job) throw new JobStateError("Lote não encontrado.");
  if (job.operation.type === "excluir") throw new JobStateError("Produtos excluídos não podem ser restaurados pelo painel. Recrie-os em “Novo produto”.");
  if (job.operation.type === "reverter") throw new JobStateError("Um lote de reversão não pode ser revertido; crie uma nova operação.");
  if (job.status !== "completed" && job.status !== "cancelled") throw new JobStateError("Só é possível reverter um lote que já terminou ou foi cancelado.");

  const items = await getJobItems(db, job.id);
  const planItems: PlanItem[] = [];
  for (const it of items) {
    if (it.status !== "ok" && it.status !== "error") continue;
    const changes = buildRevertChanges(it.changes, it.resultado);
    if (changes) planItems.push({ productId: Number(it.product_id), productName: it.product_name, changes });
  }
  if (planItems.length === 0) throw new JobStateError("Este lote não aplicou nenhuma alteração; não há o que reverter.");

  const plan: Plan = { items: planItems, ignorados: [] };
  try {
    return await createJob(db, {
      storeId: args.storeId,
      actor: args.actor,
      operation: { type: "reverter", of: job.id },
      descricao: `Reverter: ${job.descricao}`,
      plan,
      revertsJobId: job.id,
    });
  } catch {
    throw new JobStateError("Este lote já foi revertido.");
  }
}
