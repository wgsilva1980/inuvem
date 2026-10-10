import { selosPorHandle } from "@/lib/badges/public";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", vary: "Origin" };

/** Selos de um produto para a vitrine. Público e sem cookies: só devolve avisos (últimas unidades, fim da promoção, WhatsApp) de produtos publicados. */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  try {
    const r = await selosPorHandle({ query }, p.get("s") ?? "", (p.get("h") ?? "").toLowerCase());
    // vazio e cacheado por pouco tempo: a vitrine não insiste e o banco não é consultado a cada visita
    return Response.json(r ?? {}, { headers: { ...CORS, "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "loja.selos.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({}, { status: 200, headers: { ...CORS, "cache-control": "public, s-maxage=10" } });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "access-control-max-age": "86400" } });
}
