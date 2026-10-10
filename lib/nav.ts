/** Itens da navegação principal do painel. */
export const NAV_LINKS = [
  { href: "/produtos", label: "Produtos" },
  { href: "/categorias", label: "Categorias" },
  { href: "/contatos", label: "Contatos" },
  { href: "/promocoes", label: "Promoções" },
  { href: "/cupons", label: "Cupons" },
  { href: "/vendas", label: "Vendas" },
  { href: "/estoque", label: "Estoque" },
  { href: "/carrinhos", label: "Carrinhos" },
  { href: "/expedicao", label: "Expedição" },
] as const;

/** Itens do submenu "Administração". */
export const ADMIN_LINKS = [
  { href: "/imagens", label: "Imagens" },
  { href: "/seo", label: "SEO" },
  { href: "/conteudo", label: "Conteúdo" },
  { href: "/lote", label: "Lotes" },
  { href: "/historico", label: "Histórico" },
  { href: "/automacoes", label: "Automações" },
  { href: "/usuarios", label: "Usuários" },
] as const;

export const ADMIN_LABEL = "Administração";

/** A página atual é a do link ou qualquer subpágina dele (ex.: /produtos/123 ativa "Produtos"). */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
