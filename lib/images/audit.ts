import type { Db } from "@/lib/sync/repo";

/** Padrão (ver `lib/images/standard.ts`): lado maior de 1024 px; 1:1 (peça solta) ou 4:5 (modelo); peso desejável até ~600 KB. */
export const LADO_PADRAO = 1024;
export const LADO_MINIMO = 800;
export const PESO_MAXIMO_BYTES = 600 * 1024;
const TOLERANCIA_PROPORCAO = 0.02;

export interface Medida {
  width: number | null;
  height: number | null;
  bytes: number | null;
  format: string | null;
  error: string | null;
}

export type Problema = "pequena" | "proporcao" | "pesada" | "formato" | "erro";
export const PROBLEMA_LABEL: Record<Problema, string> = {
  pequena: "Pequena",
  proporcao: "Fora de 1:1 e 4:5",
  pesada: "Pesada",
  formato: "Não é JPEG",
  erro: "Não foi possível medir",
};

/** O que há de errado com uma imagem em relação ao padrão (lista vazia = no padrão). */
export function problemasDaImagem(m: Medida): Problema[] {
  if (m.error || !m.width || !m.height) return ["erro"];
  const out: Problema[] = [];
  if (Math.max(m.width, m.height) < LADO_MINIMO) out.push("pequena");
  const proporcao = m.width / m.height;
  const ehQuadrada = Math.abs(proporcao - 1) <= TOLERANCIA_PROPORCAO;
  const ehQuatroCinco = Math.abs(proporcao - 0.8) <= TOLERANCIA_PROPORCAO;
  if (!ehQuadrada && !ehQuatroCinco) out.push("proporcao");
  if (m.bytes !== null && m.bytes > PESO_MAXIMO_BYTES) out.push("pesada");
  if (m.format && m.format !== "jpeg") out.push("formato");
  return out;
}

/** "1:1", "4:5" ou a proporção aproximada (ex.: "3:4" aparece como "0,75"), para mostrar na tela. */
export function proporcaoTexto(w: number | null, h: number | null): string {
  if (!w || !h) return "—";
  const p = w / h;
  if (Math.abs(p - 1) <= TOLERANCIA_PROPORCAO) return "1:1";
  if (Math.abs(p - 0.8) <= TOLERANCIA_PROPORCAO) return "4:5";
  return p.toFixed(2).replace(".", ",");
}

/* ---------- medição (baixar a imagem) ---------- */

export type Medidor = (url: string) => Promise<Medida>;

const falha = (error: string): Medida => ({ width: null, height: null, bytes: null, format: null, error });

/** Baixa a imagem da loja e lê largura, altura, formato e peso. Só aceita https. */
export const medirImagemRemota: Medidor = async (url) => {
  if (!/^https:\/\//i.test(url)) return falha("endereço não é https");
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return falha(`a loja respondeu ${res.status}`);
    if (!(res.headers.get("content-type") ?? "").startsWith("image/")) return falha("o endereço não devolveu uma imagem");
    const buf = Buffer.from(await res.arrayBuffer());
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf, { failOn: "none" }).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null, bytes: buf.length, format: meta.format ?? null, error: meta.width ? null : "não foi possível ler a imagem" };
  } catch (err) {
    return falha(err instanceof Error ? err.message : String(err));
  }
};

/* ---------- lote de medição (retomável) ---------- */

export interface ImagemPendente {
  image_id: string;
  src: string;
}

/** Imagens do espelho que ainda não foram medidas (ou cujo endereço mudou). `todas` ignora as medidas existentes. */
export async function imagensPendentes(db: Db, storeId: string, limite: number, todas = false): Promise<ImagemPendente[]> {
  return db.query<ImagemPendente>(
    `SELECT (i->>'id') AS image_id, (i->>'src') AS src
     FROM products p
     CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) AS i
     LEFT JOIN image_audit a ON a.store_id = p.store_id AND a.image_id = (i->>'id')::bigint
     WHERE p.store_id = $1::uuid AND (i->>'src') IS NOT NULL
       AND ($3::boolean OR a.image_id IS NULL OR a.src <> (i->>'src') OR (a.error IS NOT NULL AND a.checked_at < now() - interval '10 minutes'))
     ORDER BY p.id, (i->>'id')::bigint
     LIMIT $2`,
    [storeId, limite, todas],
  );
}

export async function gravarMedida(db: Db, storeId: string, p: ImagemPendente, m: Medida): Promise<void> {
  await db.query(
    `INSERT INTO image_audit (store_id, image_id, src, width, height, bytes, format, error, checked_at)
     VALUES ($1::uuid, $2::bigint, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (store_id, image_id) DO UPDATE SET src = $3, width = $4, height = $5, bytes = $6, format = $7, error = $8, checked_at = now()`,
    [storeId, p.image_id, p.src, m.width, m.height, m.bytes, m.format, m.error],
  );
}

export async function contarPendentes(db: Db, storeId: string): Promise<{ total: number; medidas: number }> {
  const rows = await db.query<{ total: string; medidas: string }>(
    `SELECT count(*)::text AS total, count(a.image_id)::text AS medidas
     FROM products p
     CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) AS i
     LEFT JOIN image_audit a ON a.store_id = p.store_id AND a.image_id = (i->>'id')::bigint AND a.src = (i->>'src')
     WHERE p.store_id = $1::uuid AND (i->>'src') IS NOT NULL`,
    [storeId],
  );
  return { total: Number(rows[0]?.total ?? 0), medidas: Number(rows[0]?.medidas ?? 0) };
}

/** Mede imagens pendentes até estourar o orçamento de tempo, `concorrencia` por vez. Devolve quantas mediu e se ainda há pendentes. */
export async function medirPendentes(
  db: Db,
  args: { storeId: string; budgetMs: number; medir?: Medidor; concorrencia?: number; todas?: boolean; now?: () => number },
): Promise<{ medidas: number; restantes: boolean }> {
  const medir = args.medir ?? medirImagemRemota;
  const now = args.now ?? Date.now;
  const concorrencia = args.concorrencia ?? 8;
  const inicio = now();
  let medidas = 0;
  // `todas` só vale na primeira rodada (as seguintes pegam as que ficaram sem medida nova)
  let ignorarMedidas = args.todas ?? false;
  const vistas = new Set<string>();
  while (now() - inicio < args.budgetMs) {
    const lote = (await imagensPendentes(db, args.storeId, concorrencia * 3, ignorarMedidas)).filter((p) => !vistas.has(p.image_id));
    if (lote.length === 0) return { medidas, restantes: false };
    for (const p of lote) vistas.add(p.image_id);
    let proximo = 0;
    await Promise.all(
      Array.from({ length: Math.min(concorrencia, lote.length) }, async () => {
        while (proximo < lote.length) {
          const p = lote[proximo++]!;
          await gravarMedida(db, args.storeId, p, await medir(p.src));
          medidas++;
        }
      }),
    );
    if (ignorarMedidas && args.todas) ignorarMedidas = false; // reanálise: depois da 1ª rodada, só o que falta
  }
  return { medidas, restantes: true };
}

/* ---------- relatório ---------- */

export interface ImagemAuditada {
  id: string;
  position: number | null;
  src: string;
  medida: Medida | null;
  problemas: Problema[];
}

export interface ProdutoAuditado {
  id: string;
  name: string;
  imagens: ImagemAuditada[];
  /** Fotos de proporções diferentes no mesmo produto (vitrine fica irregular). */
  proporcoesMisturadas: boolean;
}

export interface ResumoAuditoria {
  produtos: number;
  semImagem: number;
  imagens: number;
  medidas: number;
  noPadrao: number;
  porProblema: Record<Problema, number>;
  proporcoesMisturadas: number;
}

interface Linha {
  product_id: string;
  name: string | null;
  image_id: string | null;
  position: number | null;
  src: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  format: string | null;
  error: string | null;
  checked: boolean;
}

/** Todos os produtos do espelho com suas imagens e medidas (o catálogo é pequeno, então o filtro e a paginação ficam em memória). */
export async function auditarProdutos(db: Db, storeId: string, productId?: number): Promise<ProdutoAuditado[]> {
  const rows = await db.query<Linha>(
    `SELECT p.id::text AS product_id, p.name,
            (i->>'id') AS image_id, nullif(i->>'position', '')::int AS position, (i->>'src') AS src,
            a.width, a.height, a.bytes, a.format, a.error, (a.image_id IS NOT NULL AND a.src = (i->>'src')) AS checked
     FROM products p
     LEFT JOIN LATERAL jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) WITH ORDINALITY AS t(i, n) ON true
     LEFT JOIN image_audit a ON a.store_id = p.store_id AND a.image_id = (i->>'id')::bigint
     WHERE p.store_id = $1::uuid AND ($2::bigint IS NULL OR p.id = $2::bigint)
     ORDER BY p.id, nullif(i->>'position', '')::int NULLS LAST, t.n`,
    [storeId, productId ?? null],
  );
  const out = new Map<string, ProdutoAuditado>();
  for (const r of rows) {
    let prod = out.get(r.product_id);
    if (!prod) out.set(r.product_id, (prod = { id: r.product_id, name: r.name || `Produto ${r.product_id}`, imagens: [], proporcoesMisturadas: false }));
    if (!r.image_id || !r.src) continue;
    const medida: Medida | null = r.checked ? { width: r.width, height: r.height, bytes: r.bytes, format: r.format, error: r.error } : null;
    prod.imagens.push({ id: r.image_id, position: r.position, src: r.src, medida, problemas: medida ? problemasDaImagem(medida) : [] });
  }
  for (const prod of out.values()) {
    const formatos = new Set(prod.imagens.flatMap((i) => (i.medida && !i.medida.error && i.medida.width && i.medida.height ? [proporcaoTexto(i.medida.width, i.medida.height)] : [])));
    prod.proporcoesMisturadas = formatos.size > 1;
  }
  return [...out.values()];
}

export function resumirAuditoria(produtos: ProdutoAuditado[]): ResumoAuditoria {
  const resumo: ResumoAuditoria = {
    produtos: produtos.length,
    semImagem: 0,
    imagens: 0,
    medidas: 0,
    noPadrao: 0,
    porProblema: { pequena: 0, proporcao: 0, pesada: 0, formato: 0, erro: 0 },
    proporcoesMisturadas: 0,
  };
  for (const p of produtos) {
    if (p.imagens.length === 0) resumo.semImagem++;
    if (p.proporcoesMisturadas) resumo.proporcoesMisturadas++;
    for (const i of p.imagens) {
      resumo.imagens++;
      if (!i.medida) continue;
      resumo.medidas++;
      if (i.problemas.length === 0) resumo.noPadrao++;
      for (const pr of i.problemas) resumo.porProblema[pr]++;
    }
  }
  return resumo;
}
