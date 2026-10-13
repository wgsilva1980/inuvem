import type { Db } from "@/lib/sync/repo";

export const NOME_ARQUIVO = "hidden-menu-urls.tpl";
/** Caminho de categoria aceito no arquivo: letras minúsculas, números e hífen, separados por barra (sem barra no início nem no fim). */
export const CAMINHO_VALIDO = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

interface Linha {
  id: string;
  parent_id: string | null;
  name: string;
  handle: string | null;
  oculta: boolean;
}

export interface ListaOculta {
  /** Caminhos das categorias ocultas, ordenados e sem repetição. */
  caminhos: string[];
  /** Categorias ocultas que ficaram de fora porque o caminho não é válido (nome da categoria). */
  descartadas: string[];
}

/** Caminho da categoria como aparece no menu da loja: os endereços (handles) da raiz até ela. Vazio se algum endereço falta ou há ciclo. */
function caminhoDe(id: string, porId: Map<string, Linha>): string {
  const partes: string[] = [];
  let atual: Linha | undefined = porId.get(id);
  for (let i = 0; atual && i < 12; i++) {
    if (!atual.handle) return "";
    partes.unshift(atual.handle.trim().replace(/^\/+|\/+$/g, ""));
    if (!atual.parent_id || atual.parent_id === "0") return partes.join("/");
    atual = porId.get(atual.parent_id);
  }
  return "";
}

/** Categorias ocultas no painel (as do espelho com visibilidade “hidden”) como caminhos de menu válidos. */
export async function listaOculta(db: Db, storeId: string): Promise<ListaOculta> {
  const rows = await db.query<Linha>(
    `SELECT id::text AS id, parent_id::text AS parent_id, name, handle, coalesce(raw_json->>'visibility', 'visible') = 'hidden' AS oculta
     FROM categories WHERE store_id = $1::uuid`,
    [storeId],
  );
  const porId = new Map(rows.map((r) => [r.id, r]));
  const caminhos = new Set<string>();
  const descartadas: string[] = [];
  for (const r of rows.filter((x) => x.oculta)) {
    const c = caminhoDe(r.id, porId);
    if (CAMINHO_VALIDO.test(c)) caminhos.add(c);
    else descartadas.push(r.name);
  }
  return { caminhos: [...caminhos].sort(), descartadas };
}

/** Texto exato do arquivo; só a lista muda (sem nenhuma categoria oculta, a lista é `[]`). */
export function montarArquivo(caminhos: string[]): string {
  const lista = caminhos.length === 0 ? "[]" : `[\n${caminhos.map((c) => `    '${c}'`).join(",\n")}\n]`;
  return `{# Gerado pelo painel INuvem. Não edite à mão: o arquivo é sobrescrito a cada atualização. #}
{% macro is_hidden(url) %}
{% set hidden_menu_paths = ${lista} %}
{% set menu_path = url | split('://') | last | split('/') | slice(1) | join('/') | trim('/') %}
{% if menu_path in hidden_menu_paths %}1{% endif %}
{% endmacro %}
`;
}
