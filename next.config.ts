import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Upload de imagem do produto: a Vercel limita o corpo da requisição a 4,5 MB (o painel limita o arquivo a 4 MB).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  serverExternalPackages: ["@neondatabase/serverless"],
  // O /api/health compara as migrations aplicadas com os arquivos do código.
  outputFileTracingIncludes: { "/api/health": ["./db/migrations/**/*"] },
};

export default nextConfig;
