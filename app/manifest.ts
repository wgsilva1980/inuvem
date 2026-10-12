import type { MetadataRoute } from "next";

/** Deixa o painel instalável na tela inicial do celular. Abre direto na conferência da expedição. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "INuvem — Painel da loja",
    short_name: "INuvem",
    description: "Painel privado da loja: conferência e envio de pedidos pelo celular.",
    start_url: "/expedicao/conferir",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#09090b",
    theme_color: "#4338ca",
    lang: "pt-BR",
    icons: [
      { src: "/api/pwa/icone/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/pwa/icone/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/api/pwa/icone/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
