/**
 * Teste do texto alternativo (alt) na Nuvemshop: o PUT da foto aceita `alt` mas a loja o ignora. Este teste, num produto de teste
 * (rascunho, apagado no fim), tenta outras rotas para descobrir se alguma grava o alt: enviar a foto já com `alt`, trocar a origem
 * (`src`) junto com o `alt` e mandar `images` dentro do PUT do produto. Tudo injetado em `api`, para testar sem rede.
 */
export interface AltTestApi {
  criarProduto(): Promise<number>;
  post(caminho: string, corpo: unknown): Promise<unknown>;
  put(caminho: string, corpo: unknown): Promise<unknown>;
  get(caminho: string): Promise<unknown>;
  apagarProduto(productId: number): Promise<void>;
  esperar(ms: number): Promise<void>;
}

export interface PassoAlt {
  tentativa: string;
  resposta: string;
  /** O `alt` que a loja mostrou depois (null se a leitura falhou). */
  altDepois: string | null;
  gravou: boolean;
}

export interface ResultadoAltTeste {
  passos: PassoAlt[];
  produtoApagado: boolean;
  erro?: string;
  /** Primeira tentativa que gravou o alt (se alguma). */
  formaQueGravou: string | null;
}

const TEXTO = "Saia midi azul com fenda frontal";
const curto = (v: unknown) => {
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t === undefined ? "(vazio)" : t.length > 500 ? `${t.slice(0, 500)}…` : t;
};
const mensagem = (err: unknown) => {
  const e = err as { status?: number; apiMessage?: string; message?: string; body?: unknown };
  return `ERRO${e.status ? ` ${e.status}` : ""}: ${e.apiMessage ?? e.message ?? String(err)}${e.body ? ` ${curto(e.body)}` : ""}`;
};

type Foto = { id?: number; src?: string; alt?: unknown };

/** Procura o alt de uma foto num objeto de foto ou de produto (lista `images`). */
function altDa(obj: unknown, imageId: number): unknown {
  const o = obj as { alt?: unknown; images?: Foto[] } | null;
  if (!o) return null;
  if (Array.isArray(o.images)) return o.images.find((i) => i.id === imageId)?.alt ?? null;
  return o.alt ?? null;
}
const contemTexto = (alt: unknown) => JSON.stringify(alt ?? "").includes(TEXTO);

export async function rodarAltTeste(api: AltTestApi, jpegBase64: string): Promise<ResultadoAltTeste> {
  const passos: PassoAlt[] = [];
  let productId: number | null = null;
  let erro: string | undefined;
  let formaQueGravou: string | null = null;

  const tentar = async (tentativa: string, imageId: number | null, fn: () => Promise<unknown>, ler: () => Promise<unknown>) => {
    let resposta: string;
    try {
      resposta = `alt na resposta = ${curto(altDa(await fn(), imageId ?? -1))}`;
    } catch (err) {
      resposta = mensagem(err);
    }
    let depois: string | null = null;
    let gravou = false;
    try {
      await api.esperar(1500);
      const alt = altDa(await ler(), imageId ?? -1);
      depois = curto(alt);
      gravou = contemTexto(alt);
    } catch (err) {
      depois = null;
      resposta += ` | leitura: ${mensagem(err)}`;
    }
    passos.push({ tentativa, resposta, altDepois: depois, gravou });
    if (gravou && !formaQueGravou) formaQueGravou = tentativa;
  };

  try {
    productId = await api.criarProduto();
    const base = `/products/${productId}`;
    const lerFoto = (id: number) => () => api.get(`${base}/images/${id}`);
    const lerProduto = (id: number) => () => api.get(base).then((p) => ({ images: (p as { images?: Foto[] }).images ?? [], id }));

    // 1) enviar a foto já com alt (duas formas)
    const criadas: Record<string, Foto> = {};
    for (const [rotulo, alt] of [
      ["POST foto com alt = { pt }", { pt: TEXTO }],
      ["POST foto com alt = [texto]", [TEXTO]],
    ] as const) {
      let foto: Foto | null = null;
      await tentar(
        rotulo,
        null,
        async () => {
          foto = (await api.post(`${base}/images`, { attachment: jpegBase64, filename: "teste-alt.jpg", alt })) as Foto;
          return { alt: foto.alt, id: foto.id };
        },
        async () => ({ alt: foto ? (await api.get(`${base}/images/${foto.id}`) as Foto).alt : null }),
      );
      if (foto) criadas[rotulo] = foto;
    }

    // 2) sobre uma foto sem alt: PUT com src + alt, e images no PUT do produto
    const alvo = await api.post(`${base}/images`, { attachment: jpegBase64, filename: "teste-alt-2.jpg" }).then((f) => f as Foto).catch((e) => ((erro = `Não consegui criar a foto de teste: ${mensagem(e)}`), null));
    if (alvo?.id && alvo.src) {
      const id = alvo.id;
      const src = alvo.src;
      for (const [rotulo, alt] of [
        ["PUT foto { src, alt: { pt } }", { pt: TEXTO }],
        ["PUT foto { src, alt: [texto] }", [TEXTO]],
      ] as const) {
        await tentar(rotulo, id, () => api.put(`${base}/images/${id}`, { src, alt }), lerFoto(id));
      }
      for (const [rotulo, alt] of [
        ["PUT produto { images: [{ id, alt: { pt } }] }", { pt: TEXTO }],
        ["PUT produto { images: [{ id, alt: [texto] }] }", [TEXTO]],
      ] as const) {
        await tentar(rotulo, id, () => api.put(base, { images: [{ id, alt }] }), lerProduto(id));
      }
    }
  } catch (err) {
    erro = mensagem(err);
  }

  let produtoApagado = false;
  if (productId !== null) {
    try {
      await api.apagarProduto(productId);
      produtoApagado = true;
    } catch {
      produtoApagado = false;
    }
  }
  return { passos, produtoApagado, erro, formaQueGravou };
}
