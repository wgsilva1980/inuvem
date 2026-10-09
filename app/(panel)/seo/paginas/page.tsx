import { requireAdmin } from "@/lib/auth/admin";
import { ItensView } from "../itens-view";

export const dynamic = "force-dynamic";

export default async function SeoPaginasPage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  return <ItensView tipo="pagina" filtro={sp.filtro} />;
}
