import { ImageResponse } from "next/og";

const TAMANHOS = new Set(["180", "192", "512"]);

/** Ícone do app instalado (PNG gerado na hora). Público de propósito: o navegador busca o ícone sem sessão. `?maskable=1` deixa folga para o recorte do Android. */
export async function GET(request: Request, { params }: { params: Promise<{ tamanho: string }> }) {
  const { tamanho } = await params;
  if (!TAMANHOS.has(tamanho)) return new Response("Not found", { status: 404 });
  const lado = Number(tamanho);
  const folga = new URL(request.url).searchParams.get("maskable") === "1" ? 0.62 : 0.8;
  const fonte = Math.round(lado * folga * 0.62);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#4338ca", color: "#ffffff", fontSize: fonte, fontWeight: 700, fontFamily: "sans-serif" }}>
        IN
      </div>
    ),
    { width: lado, height: lado, headers: { "cache-control": "public, max-age=86400" } },
  );
}
