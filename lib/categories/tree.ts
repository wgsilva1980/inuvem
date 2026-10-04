export interface CategoryNode {
  id: number;
  parent_id: number | null;
  name: string;
}

export interface FlatCategory extends CategoryNode {
  depth: number;
}

const byName = (a: CategoryNode, b: CategoryNode) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) || a.id - b.id;

/** Filhos diretos de cada categoria (a chave `null` guarda as raízes; pai que não existe no espelho conta como raiz). */
function childrenMap(rows: CategoryNode[]): Map<number | null, CategoryNode[]> {
  const ids = new Set(rows.map((r) => r.id));
  const map = new Map<number | null, CategoryNode[]>();
  for (const r of rows) {
    const key = r.parent_id !== null && ids.has(r.parent_id) && r.parent_id !== r.id ? r.parent_id : null;
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  for (const list of map.values()) list.sort(byName);
  return map;
}

/** Árvore achatada em ordem de exibição (pai antes dos filhos, irmãos por nome), com a profundidade de cada nó. Imune a ciclos. */
export function flattenTree(rows: CategoryNode[]): FlatCategory[] {
  const children = childrenMap(rows);
  const out: FlatCategory[] = [];
  const seen = new Set<number>();
  const walk = (parent: number | null, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      out.push({ ...node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Todos os descendentes de uma categoria (filhos, netos...). Serve para impedir que uma categoria vire filha de si mesma. */
export function descendantIds(rows: CategoryNode[], id: number): Set<number> {
  const children = childrenMap(rows);
  const out = new Set<number>();
  const walk = (parent: number) => {
    for (const node of children.get(parent) ?? []) {
      if (out.has(node.id) || node.id === id) continue;
      out.add(node.id);
      walk(node.id);
    }
  };
  walk(id);
  return out;
}

/** Nome com o caminho completo ("Roupas > Vestidos"), para listas planas. */
export function pathName(rows: CategoryNode[], id: number): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parts: string[] = [];
  const seen = new Set<number>();
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parent_id === null ? undefined : byId.get(cur.parent_id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
  }
  return parts.join(" > ") || `#${id}`;
}
