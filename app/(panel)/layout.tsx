import { requireAdmin } from "@/lib/auth/admin";
import { Button } from "@/components/ui/button";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between gap-3 py-4">
        <span className="text-lg font-semibold">INuvem</span>
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
