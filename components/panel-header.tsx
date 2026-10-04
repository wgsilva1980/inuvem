"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { NAV_LINKS as LINKS, isActive } from "@/lib/nav";

/**
 * Cabeçalho do painel. A partir de `md` mostra os links na barra; abaixo disso, um botão abre um menu
 * com os links e a conta (e-mail + Sair), com alvos de toque de 44 px. A página atual leva aria-current.
 */
export function PanelHeader({ email, signOut }: { email: string; signOut: () => Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Fecha o menu ao navegar e com Esc.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const linkClass = (href: string) =>
    `rounded-md px-3 py-2 text-sm font-medium transition ${isActive(pathname, href) ? "bg-border/60 text-foreground" : "text-muted hover:text-foreground"}`;

  return (
    <header className="relative py-3">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="rounded-md" aria-label="INuvem — página inicial">
          <Brand className="text-lg" />
        </Link>

        <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass(l.href)} aria-current={isActive(pathname, l.href) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>

        <form action={signOut} className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <span className="max-w-48 truncate text-sm text-muted">{email}</span>
          <Button type="submit" variant="outline">
            Sair
          </Button>
        </form>

        <button
          type="button"
          className="inline-flex size-11 items-center justify-center rounded-md border border-border-strong bg-card md:hidden"
          aria-expanded={open}
          aria-controls="menu-mobile"
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {open ? <path d="M4 4l12 12M16 4L4 16" /> : <path d="M3 5h14M3 10h14M3 15h14" />}
          </svg>
        </button>
      </div>

      {open && (
        <div id="menu-mobile" className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-border bg-card p-2 shadow-lg md:hidden">
          <nav aria-label="Principal" className="flex flex-col">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`flex min-h-11 items-center ${linkClass(l.href)}`}
                aria-current={isActive(pathname, l.href) ? "page" : undefined}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <form action={signOut} className="mt-2 flex flex-col gap-2 border-t border-border p-3">
            <span className="truncate text-sm text-muted">{email}</span>
            <ThemeToggle className="min-h-11 justify-center" />
            <Button type="submit" variant="outline" className="min-h-11">
              Sair
            </Button>
          </form>
        </div>
      )}
    </header>
  );
}
