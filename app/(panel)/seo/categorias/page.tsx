import { requireAdmin } from "@/lib/auth/admin";
import { ItensView } from "../itens-view";

export const dynamic = "force-dynamic";

export default async function SeoCategoriasPage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  return <ItensView tipo="categoria" filtro={sp.filtro} />;
}
