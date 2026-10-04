import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Button } from "@/components/ui/button";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between gap-3 py-4">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-lg font-semibold">
            INuvem
          </Link>
          <Link href="/produtos" className="text-muted hover:text-foreground">
            Produtos
          </Link>
          <Link href="/categorias" className="text-muted hover:text-foreground">
            Categorias
          </Link>
          <Link href="/lote" className="text-muted hover:text-foreground">
            Lotes
          </Link>
          <Link href="/historico" className="text-muted hover:text-foreground">
            Histórico
          </Link>
        </nav>
        <form action={signOut} className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">{admin.email}</span>
          <Button type="submit" variant="outline">
            Sair
          </Button>
        </form>
      </header>
      {children}
    </div>
  );
}
