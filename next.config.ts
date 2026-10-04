import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@neondatabase/serverless"],
  // O /api/health compara as migrations aplicadas com os arquivos do código.
  outputFileTracingIncludes: { "/api/health": ["./db/migrations/**/*"] },
};

export default nextConfig;
