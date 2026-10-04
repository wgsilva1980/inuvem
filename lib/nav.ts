/** Itens da navegação principal do painel. */
export const NAV_LINKS = [
  { href: "/produtos", label: "Produtos" },
  { href: "/categorias", label: "Categorias" },
  { href: "/lote", label: "Lotes" },
  { href: "/historico", label: "Histórico" },
] as const;

/** A página atual é a do link ou qualquer subpágina dele (ex.: /produtos/123 ativa "Produtos"). */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
