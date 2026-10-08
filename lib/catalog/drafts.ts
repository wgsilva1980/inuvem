import { z } from "zod";
import { UPLOAD_TYPES, safeFilename } from "@/lib/catalog/images";
import type { BackupStorage } from "@/lib/images/storage";
import type { Db } from "@/lib/sync/repo";
import { lerRecorte } from "@/lib/images/recorte";
import { MAX_FOTOS_RASCUNHO, type EnquadramentoFoto, type FormSalvo, type FotoSalva, type IaSalva, type RascunhoResumo, type RascunhoSalvo } from "./drafts-shared";

export { MAX_FOTOS_RASCUNHO };

export class RascunhoNaoEncontradoError extends Error {
  constructor() {
    super("Rascunho não encontrado. Ele pode ter sido descartado ou já virou produto.");
  }
}
export class RascunhoInvalidoError extends Error {}

const texto = (max: number) => z.string().max(max).catch("");
const formSchema = z.object({
  name: texto(255),
  description: texto(100_000),
  tags: texto(1000),
  categorias: z.array(z.number().int().positive()).max(50).catch([]),
  modo: z.enum(["simples", "variacoes"]).catch("simples"),
  cores: texto(2000),
  tamanhos: texto(2000),
  preco: texto(30),
  promocional: texto(30),
  peso: texto(30),
  controlar: z.boolean().catch(false),
  estoque: texto(15),
  seoTitulo: texto(200),
  seoDescricao: texto(600),
  iaMarcados: z.array(z.string().max(40)).max(30).catch([]),
});
const iaSchema = z.object({
  avisos: z.array(z.string().max(500)).max(10).catch([]),
  fotos: z.array(z.object({ alt: texto(300), qualidade: z.number().int().min(1).max(5).catch(3), observacao: texto(500) })).max(MAX_FOTOS_RASCUNHO).catch([]),
});

/** Valida o enquadramento que vem do navegador; o que não faz sentido vira nulo (a foto sobe no automático). */
export function lerEnquadramento(raw: unknown): EnquadramentoFoto | null {
  if (!raw || typeof raw !== "object") return null;
  const { tipo, enquadramento, recorte } = raw as Record<string, unknown>;
  if (tipo !== "auto" && tipo !== "peca" && tipo !== "modelo") return null;
  if (enquadramento !== "auto" && enquadramento !== "ajustar" && enquadramento !== "cortar" && enquadramento !== "manual") return null;
  const r = enquadramento === "manual" ? lerRecorte(recorte) : null;
  return { tipo, enquadramento, recorte: r };
}

interface Linha {
  id: string;
  title: string;
  notes: string;
  form: unknown;
  ai: unknown;
  photos: unknown;
  status: "rascunho" | "criado";
  product_id: string | null;
  updated_at: string;
}

const COLUNAS = `id::text AS id, title, notes, form, ai, photos, status, product_id::text AS product_id, to_char(updated_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS updated_at`;

const fotosDe = (v: unknown): FotoSalva[] => (Array.isArray(v) ? (v as FotoSalva[]).filter((f) => f && typeof f.pathname === "string") : []);

function aoFormato(r: Linha): RascunhoSalvo {
  const form = formSchema.safeParse(r.form);
  const ia = iaSchema.safeParse(r.ai);
  return {
    id: Number(r.id),
    titulo: r.title,
    notas: r.notes,
    form: form.success && Object.keys((r.form as object) ?? {}).length > 0 ? (form.data as FormSalvo) : null,
    ia: r.ai && ia.success ? (ia.data as IaSalva) : null,
    fotos: fotosDe(r.photos),
    status: r.status,
    productId: r.product_id === null ? null : Number(r.product_id),
    atualizadoEm: r.updated_at,
  };
}

export async function obterRascunho(db: Db, storeId: string, id: number): Promise<RascunhoSalvo | null> {
  const rows = await db.query<Linha>(`SELECT ${COLUNAS} FROM product_drafts WHERE store_id = $1::uuid AND id = $2::bigint`, [storeId, id]);
  return rows[0] ? aoFormato(rows[0]) : null;
}

/** Rascunhos em aberto (mais recentes primeiro). `incluirCriados` traz também os que já viraram produto. */
export async function listarRascunhos(db: Db, storeId: string, incluirCriados = false): Promise<RascunhoResumo[]> {
  const rows = await db.query<Linha>(
    `SELECT ${COLUNAS} FROM product_drafts WHERE store_id = $1::uuid ${incluirCriados ? "" : "AND status = 'rascunho'"} ORDER BY product_drafts.updated_at DESC, product_drafts.id DESC LIMIT 200`,
    [storeId],
  );
  return rows.map((r) => {
    const d = aoFormato(r);
    return { id: d.id, titulo: d.titulo || d.form?.name || "(sem nome)", fotos: d.fotos.length, status: d.status, productId: d.productId, atualizadoEm: d.atualizadoEm };
  });
}

export async function contarRascunhos(db: Db, storeId: string): Promise<number> {
  return Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM product_drafts WHERE store_id = $1::uuid AND status = 'rascunho'`, [storeId]))[0]?.n ?? 0);
}

export interface EntradaRascunho {
  notas: string;
  form: unknown;
  ia: unknown;
}

/** Cria (id = null) ou atualiza os campos do rascunho; as fotos não mudam aqui. Devolve o ID. */
export async function salvarRascunho(db: Db, args: { storeId: string; actor: string; id: number | null; entrada: EntradaRascunho }): Promise<number> {
  const form = formSchema.parse(args.entrada.form ?? {});
  const ia = args.entrada.ia ? iaSchema.parse(args.entrada.ia) : null;
  const notas = String(args.entrada.notas ?? "").slice(0, 3000);
  const titulo = form.name.trim().slice(0, 255);
  if (args.id === null) {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO product_drafts (store_id, created_by, title, notes, form, ai) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb) RETURNING id::text AS id`,
      [args.storeId, args.actor, titulo, notas, JSON.stringify(form), ia ? JSON.stringify(ia) : null],
    );
    return Number(r!.id);
  }
  const rows = await db.query<{ id: string }>(
    `UPDATE product_drafts SET title = $3, notes = $4, form = $5::jsonb, ai = $6::jsonb, updated_at = clock_timestamp()
     WHERE store_id = $1::uuid AND id = $2::bigint AND status = 'rascunho' RETURNING id::text AS id`,
    [args.storeId, args.id, titulo, notas, JSON.stringify(form), ia ? JSON.stringify(ia) : null],
  );
  if (rows.length === 0) throw new RascunhoNaoEncontradoError();
  return args.id;
}

/** Guarda uma foto no Blob e a acrescenta ao rascunho. */
export async function adicionarFoto(
  db: Db,
  storage: BackupStorage,
  args: { storeId: string; id: number; nome: string; contentType: string; bytes: Buffer },
): Promise<FotoSalva> {
  const rascunho = await obterRascunho(db, args.storeId, args.id);
  if (!rascunho || rascunho.status !== "rascunho") throw new RascunhoNaoEncontradoError();
  if (rascunho.fotos.length >= MAX_FOTOS_RASCUNHO) throw new RascunhoInvalidoError(`Um rascunho guarda no máximo ${MAX_FOTOS_RASCUNHO} fotos.`);
  const ext = UPLOAD_TYPES[args.contentType];
  if (!ext) throw new RascunhoInvalidoError("Formato de foto não aceito.");
  const sufixo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const pathname = `rascunhos/${args.storeId}/${args.id}/${sufixo}.${ext}`;
  await storage.put(pathname, args.bytes, args.contentType);
  const foto: FotoSalva = { pathname, name: safeFilename(args.nome, args.contentType), contentType: args.contentType, bytes: args.bytes.length };
  const rows = await db.query<{ id: string }>(
    `UPDATE product_drafts SET photos = photos || $3::jsonb, updated_at = clock_timestamp() WHERE store_id = $1::uuid AND id = $2::bigint AND status = 'rascunho' RETURNING id::text AS id`,
    [args.storeId, args.id, JSON.stringify([foto])],
  );
  if (rows.length === 0) {
    await storage.del?.([pathname]).catch(() => undefined);
    throw new RascunhoNaoEncontradoError();
  }
  return foto;
}

/**
 * Deixa no rascunho só as fotos de `ordem` (pathnames), nessa ordem; as demais são apagadas do Blob. `opcoes` (por pathname) guarda o
 * enquadramento escolhido de cada foto; foto sem entrada mantém o que já tinha.
 */
export async function definirFotos(
  db: Db,
  storage: BackupStorage,
  args: { storeId: string; id: number; ordem: string[]; opcoes?: Record<string, unknown> },
): Promise<FotoSalva[]> {
  const rascunho = await obterRascunho(db, args.storeId, args.id);
  if (!rascunho || rascunho.status !== "rascunho") throw new RascunhoNaoEncontradoError();
  const porCaminho = new Map(rascunho.fotos.map((f) => [f.pathname, f]));
  const novas: FotoSalva[] = [];
  for (const p of args.ordem) {
    const f = porCaminho.get(p);
    if (!f || novas.some((x) => x.pathname === f.pathname)) continue;
    if (args.opcoes && p in args.opcoes) {
      const o = lerEnquadramento(args.opcoes[p]);
      const { enquadramento: _antigo, ...resto } = f; // eslint-disable-line @typescript-eslint/no-unused-vars
      novas.push(o && !(o.tipo === "auto" && o.enquadramento === "auto") ? { ...resto, enquadramento: o } : resto);
    } else novas.push(f);
  }
  const mantidas = new Set(novas.map((f) => f.pathname));
  const removidas = rascunho.fotos.filter((f) => !mantidas.has(f.pathname)).map((f) => f.pathname);
  await db.query(`UPDATE product_drafts SET photos = $3::jsonb, updated_at = clock_timestamp() WHERE store_id = $1::uuid AND id = $2::bigint`, [args.storeId, args.id, JSON.stringify(novas)]);
  if (removidas.length > 0) await storage.del?.(removidas).catch(() => undefined);
  return novas;
}

/** Marca o rascunho como criado (guarda o ID do produto). As fotos continuam no Blob até serem enviadas. */
export async function marcarCriado(db: Db, args: { storeId: string; id: number; productId: number }): Promise<void> {
  await db.query(`UPDATE product_drafts SET status = 'criado', product_id = $3::bigint, updated_at = clock_timestamp() WHERE store_id = $1::uuid AND id = $2::bigint`, [args.storeId, args.id, args.productId]);
}

/** Apaga o rascunho e as fotos dele no Blob. */
export async function descartarRascunho(db: Db, storage: BackupStorage, args: { storeId: string; id: number }): Promise<void> {
  const rows = await db.query<{ photos: unknown }>(`DELETE FROM product_drafts WHERE store_id = $1::uuid AND id = $2::bigint RETURNING photos`, [args.storeId, args.id]);
  if (rows.length === 0) throw new RascunhoNaoEncontradoError();
  const caminhos = fotosDe(rows[0]!.photos).map((f) => f.pathname);
  if (caminhos.length > 0) await storage.del?.(caminhos).catch(() => undefined);
}

/** Lê os bytes de uma foto do rascunho (só as que estão na lista dele). */
export async function lerFoto(db: Db, storage: BackupStorage, args: { storeId: string; id: number; pathname: string }): Promise<{ foto: FotoSalva; bytes: Buffer } | null> {
  const rascunho = await obterRascunho(db, args.storeId, args.id);
  const foto = rascunho?.fotos.find((f) => f.pathname === args.pathname);
  if (!foto) return null;
  return { foto, bytes: await storage.get(foto.pathname) };
}

/** Tira do rascunho (e do Blob) uma foto já enviada à loja. */
export async function removerFotoEnviada(db: Db, storage: BackupStorage, args: { storeId: string; id: number; pathname: string }): Promise<void> {
  const rows = await db.query<{ photos: unknown }>(`SELECT photos FROM product_drafts WHERE store_id = $1::uuid AND id = $2::bigint`, [args.storeId, args.id]);
  if (rows.length === 0) return;
  const resto = fotosDe(rows[0]!.photos).filter((f) => f.pathname !== args.pathname);
  await db.query(`UPDATE product_drafts SET photos = $3::jsonb WHERE store_id = $1::uuid AND id = $2::bigint`, [args.storeId, args.id, JSON.stringify(resto)]);
  await storage.del?.([args.pathname]).catch(() => undefined);
}
