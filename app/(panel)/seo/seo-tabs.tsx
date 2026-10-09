import Link from "next/link";

const ABAS = [
  { href: "/seo", rotulo: "Produtos" },
  { href: "/seo/categorias", rotulo: "Categorias" },
  { href: "/seo/paginas", rotulo: "Páginas" },
] as const;

/** Abas do SEO: produtos, categorias e páginas da loja. */
export function SeoTabs({ atual }: { atual: (typeof ABAS)[number]["href"] }) {
  return (
    <nav aria-label="SEO por tipo" className="flex flex-wrap gap-2 text-sm">
      {ABAS.map((a) => (
        <Link key={a.href} href={a.href} aria-current={atual === a.href ? "page" : undefined} className={`rounded-full border px-3 py-1 ${atual === a.href ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`}>
          {a.rotulo}
        </Link>
      ))}
    </nav>
  );
}
