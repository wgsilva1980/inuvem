import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Upload de imagem do produto: a Vercel limita o corpo da requisição a 4,5 MB (o painel limita o arquivo a 4 MB).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  serverExternalPackages: ["@neondatabase/serverless"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" }, // painel de administração: ninguém pode embuti-lo em outro site (clickjacking)
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          // Sem script-src de propósito (o Next injeta scripts em linha); estas diretivas fecham o resto sem quebrar a página.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
        ],
      },
    ];
  },
  // O /api/health compara as migrations aplicadas com os arquivos do código.
  outputFileTracingIncludes: { "/api/health": ["./db/migrations/**/*"] },
};

export default nextConfig;
