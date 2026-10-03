import { auth } from "@/lib/auth/server";

// Exige sessão nas páginas do painel. A checagem de admin (allowlist) é feita no layout
// e em cada rota de API, independentemente deste filtro.
export default auth.middleware({ loginUrl: "/login" });

export const config = {
  matcher: [
    "/((?!api/auth|api/cron|api/sync|api/webhooks|api/nuvemshop/callback|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
