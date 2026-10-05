import { del, get, put } from "@vercel/blob";

export type AcessoBlob = "private" | "public";

export interface TesteArmazenamento {
  configurado: boolean;
  /** Modo em que o armazenamento aceitou gravar (o das cópias de segurança deve ser "private"). */
  acesso: AcessoBlob | null;
  gravou: boolean;
  leu: boolean;
  apagou: boolean;
  erro: string | null;
}

/** Grava um arquivinho de teste no Vercel Blob, lê de volta e apaga. Não toca na loja. */
export async function testarArmazenamento(env: Record<string, string | undefined> = process.env): Promise<TesteArmazenamento> {
  const r: TesteArmazenamento = { configurado: Boolean(env.BLOB_READ_WRITE_TOKEN), acesso: null, gravou: false, leu: false, apagou: false, erro: null };
  if (!r.configurado) {
    r.erro = "A variável BLOB_READ_WRITE_TOKEN não existe neste ambiente. Conecte o Blob ao projeto (Storage) e faça um novo deploy.";
    return r;
  }
  const caminho = `testes/armazenamento-${Date.now()}.txt`;
  const conteudo = "inuvem: teste de armazenamento";
  let ultimoErro = "";
  for (const acesso of ["private", "public"] as const) {
    try {
      const blob = await put(caminho, conteudo, { access: acesso, addRandomSuffix: true, contentType: "text/plain" });
      r.acesso = acesso;
      r.gravou = true;
      try {
        if (acesso === "private") {
          const lido = await get(blob.pathname, { access: "private" });
          r.leu = lido?.statusCode === 200 && (await new Response(lido.stream).text()) === conteudo;
        } else {
          r.leu = (await (await fetch(blob.url)).text()) === conteudo;
        }
      } catch (err) {
        r.erro = `Gravou, mas não conseguiu ler de volta: ${err instanceof Error ? err.message : String(err)}`;
      }
      try {
        await del(blob.url);
        r.apagou = true;
      } catch (err) {
        r.erro ??= `Gravou, mas não conseguiu apagar o arquivo de teste: ${err instanceof Error ? err.message : String(err)}`;
      }
      return r;
    } catch (err) {
      ultimoErro = err instanceof Error ? err.message : String(err);
    }
  }
  r.erro = `Não foi possível gravar: ${ultimoErro}`;
  return r;
}
