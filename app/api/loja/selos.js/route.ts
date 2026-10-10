import { SCRIPT_SELOS } from "@/lib/badges/script";

export const dynamic = "force-static";

/** Script público da vitrine (sem dados e sem login). O que ele mostra vem de /api/loja/selos, que respeita o “ligado/desligado” do painel. */
export function GET() {
  return new Response(SCRIPT_SELOS, {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=300", "x-content-type-options": "nosniff" },
  });
}
