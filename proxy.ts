import { getAuth } from "@/lib/auth/server";

type Middleware = ReturnType<ReturnType<typeof getAuth>["middleware"]>;

let middleware: Middleware | undefined;

// Exige sessão nas páginas do painel. A checagem de admin (allowlist) é feita no layout
// e em cada rota de API, independentemente deste filtro.
export default function proxy(...args: Parameters<Middleware>): ReturnType<Middleware> {
  middleware ??= getAuth().middleware({ loginUrl: "/login" });
  return middleware(...args);
}

export const config = {
  matcher: [
    // Cada exceção termina em "/" ou fim do caminho: "login" não deixa "/login-qualquer-coisa" escapar do filtro de sessão.
    "/((?!(?:api/auth|api/cron|api/health|api/sync|api/webhooks|api/nuvemshop/webhooks|api/nuvemshop/callback|login|_next/static|_next/image)(?:/|$)|favicon\\.ico$).*)",
  ],
};
