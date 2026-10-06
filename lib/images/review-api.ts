import { getImage, updateImage } from "@/lib/nuvemshop";
import type { NuvemshopClient } from "@/lib/nuvemshop/client";
import type { AltApi } from "./review";

export const altApiDoCliente = (client: NuvemshopClient): AltApi => ({
  updateAlt: (pid, iid, alt) => updateImage(client, pid, iid, { alt }),
  getImage: (pid, iid) => getImage(client, pid, iid),
});

export interface PassoDiagnostico {
  passo: string;
  resultado: string;
}

const curto = (v: unknown) => {
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t.length > 700 ? `${t.slice(0, 700)}…` : t;
};
const alt = (v: unknown) => curto((v as { alt?: unknown } | null)?.alt ?? null);
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Descobre como a loja trata o `alt` de uma foto: mostra o que ela devolve antes e depois de cada tentativa de envio
 * (objeto por idioma e lista), lendo logo em seguida e de novo depois de uma pausa. O texto enviado é o que a pessoa quer gravar.
 * Se uma das formas pegar, o texto fica gravado (não há nada a desfazer).
 */
export async function diagnosticarAlt(client: NuvemshopClient, productId: number, imageId: number, texto: string): Promise<PassoDiagnostico[]> {
  const base = `/products/${productId}/images/${imageId}`;
  const passos: PassoDiagnostico[] = [];
  const registrar = (passo: string, resultado: string) => passos.push({ passo, resultado });
  const tentar = async (rotulo: string, fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (err) {
      registrar(rotulo, `ERRO: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  const antes = await tentar("GET antes", () => client.get(base));
  if (antes) registrar("GET antes", `alt = ${alt(antes)}`);

  for (const [rotulo, corpo] of [
    ["PUT { alt: { pt: texto } }", { alt: { pt: texto } }],
    ["PUT { alt: [texto] }", { alt: [texto] }],
  ] as const) {
    const resp = await tentar(rotulo, () => client.put(base, corpo));
    if (resp) registrar(rotulo, `resposta: alt = ${alt(resp)}`);
    const logo = await tentar(`${rotulo} → GET logo`, () => client.get(base));
    if (logo) registrar(`${rotulo} → GET logo`, `alt = ${alt(logo)}`);
    await esperar(3000);
    const depois = await tentar(`${rotulo} → GET após 3 s`, () => client.get(base));
    if (depois) registrar(`${rotulo} → GET após 3 s`, `alt = ${alt(depois)}`);
    const gravou = JSON.stringify((depois as { alt?: unknown } | null)?.alt ?? "").includes(texto);
    if (gravou) {
      registrar("Conclusão", `o formato “${rotulo}” gravou o texto`);
      return passos;
    }
  }
  registrar("Conclusão", "nenhum formato gravou o texto (a loja aceita a chamada mas não guarda o alt por esta rota)");
  return passos;
}
