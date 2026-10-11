import Link from "next/link";

const ABAS = [
  { href: "/conteudo", rotulo: "Blocos para descrições" },
  { href: "/conteudo/paginas", rotulo: "Páginas da loja (IA)" },
  { href: "/conteudo/medidas", rotulo: "Guia de medidas" },
] as const;

/** Abas de Conteúdo: blocos reutilizáveis, páginas escritas com a IA e o guia de medidas. */
export function ConteudoTabs({ atual }: { atual: (typeof ABAS)[number]["href"] }) {
  return (
    <nav aria-label="Conteúdo" className="flex flex-wrap gap-2 text-sm">
      {ABAS.map((a) => (
        <Link key={a.href} href={a.href} aria-current={atual === a.href ? "page" : undefined} className={`rounded-full border px-3 py-1 ${atual === a.href ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`}>
          {a.rotulo}
        </Link>
      ))}
    </nav>
  );
}
