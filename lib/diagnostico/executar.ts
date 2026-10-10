import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { NuvemshopClient } from "@/lib/nuvemshop/client";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/handler";
import type { Db } from "@/lib/sync/repo";
import { camposRecebidos, verificarCampos } from "./campos";
import type { Diagnostico, ResultadoSonda, ResultadoWebhooks, ValoresDePedidos } from "./relatorio";
import { SONDAS, type Sonda } from "./sondas";

/** Quantos itens de cada recurso são lidos para conferir os campos. */
export const AMOSTRA = 5;

function avaliar(sonda: Sonda, amostras: unknown[]): Pick<ResultadoSonda, "status" | "mensagem" | "campos" | "recebidos"> {
  if (amostras.length === 0) {
    return { status: "sem_dados", mensagem: `A loja não tem ${sonda.titulo.toLowerCase()} para conferir os campos. Os testes dos recursos que dependem disso ficam por fazer.`, campos: [], recebidos: [] };
  }
  const campos = verificarCampos(amostras, sonda.esperados);
  const faltamObrigatorios = campos.filter((c) => c.obrigatorio && !c.presente);
  const faltamOpcionais = campos.filter((c) => !c.obrigatorio && !c.presente);
  const recebidos = camposRecebidos(amostras);
  if (faltamObrigatorios.length > 0) {
    return { status: "aviso", mensagem: `Faltam campos de que o painel depende: ${faltamObrigatorios.map((c) => c.caminho).join(", ")}.`, campos, recebidos };
  }
  return {
    status: "ok",
    mensagem: faltamOpcionais.length === 0 ? "Todos os campos esperados chegaram." : `Tudo o que é obrigatório chegou. ${faltamOpcionais.length} campo(s) opcionais não vieram nesta amostra (podem estar vazios): ${faltamOpcionais.map((c) => c.caminho).join(", ")}.`,
    campos,
    recebidos,
  };
}

export async function executarSonda(client: NuvemshopClient, sonda: Sonda): Promise<ResultadoSonda> {
  const inicio = Date.now();
  const base = { id: sonda.id, titulo: sonda.titulo, caminho: sonda.caminho, usadoPor: sonda.usadoPor };
  try {
    const amostras = sonda.forma === "objeto" ? [await client.get<unknown>(sonda.caminho)] : (await client.getPage<unknown>(sonda.caminho, {}, 1, AMOSTRA)).items;
    return { ...base, ...avaliar(sonda, amostras), itensLidos: amostras.length, ms: Date.now() - inicio };
  } catch (err) {
    const ms = Date.now() - inicio;
    if (err instanceof NuvemshopError) {
      if (err.status === 401 || err.status === 403) return { ...base, status: "sem_permissao", mensagem: "A Nuvemshop negou a leitura. O app provavelmente não tem a permissão deste recurso: confira a lista de permissões e, se faltar, reautorize o app.", campos: [], recebidos: [], itensLidos: 0, ms };
      if (err.status === 404) return { ...base, status: "indisponivel", mensagem: "A Nuvemshop respondeu que este recurso não existe (404) para esta loja ou versão da API. O painel usa o modo alternativo, quando há um.", campos: [], recebidos: [], itensLidos: 0, ms };
      return { ...base, status: "erro", mensagem: err.userMessage, campos: [], recebidos: [], itensLidos: 0, ms };
    }
    return { ...base, status: "erro", mensagem: err instanceof Error ? err.message.slice(0, 200) : "Falha inesperada.", campos: [], recebidos: [], itensLidos: 0, ms };
  }
}

/** Confere se os webhooks que o painel assina estão registrados na loja (mantêm o espelho de produtos e categorias em dia). */
export async function conferirWebhooks(client: NuvemshopClient): Promise<ResultadoWebhooks> {
  try {
    const lista = (await client.get<unknown>("/webhooks")) as Array<{ event?: string }>;
    const registrados = [...new Set((Array.isArray(lista) ? lista : []).map((w) => w.event).filter((e): e is string => typeof e === "string"))].sort();
    const faltando = WEBHOOK_EVENTS.filter((e) => !registrados.includes(e));
    return faltando.length === 0
      ? { status: "ok", mensagem: "Todos os avisos que o painel espera estão registrados.", registrados, faltando: [] }
      : { status: "aviso", mensagem: `Faltam avisos (webhooks): ${faltando.join(", ")}. Use “Registrar webhooks” no início para o espelho se manter em dia.`, registrados, faltando: [...faltando] };
  } catch (err) {
    return { status: "erro", mensagem: err instanceof NuvemshopError ? err.userMessage : "Não foi possível ler os webhooks.", registrados: [], faltando: [] };
  }
}

/** Roda todas as leituras de teste, uma de cada vez (respeita o limite de pedidos da Nuvemshop). Só leitura: nada é alterado na loja. */
export async function executarDiagnostico(client: NuvemshopClient, agora: () => number = Date.now): Promise<Diagnostico> {
  const inicio = agora();
  const sondas: ResultadoSonda[] = [];
  for (const s of SONDAS) sondas.push(await executarSonda(client, s));
  const webhooks = await conferirWebhooks(client);
  return { geradoEm: new Date(agora()).toISOString(), duracaoMs: agora() - inicio, sondas, webhooks };
}

/* ---------- o que o espelho de pedidos já mostra ---------- */

/** Valores de situação que aparecem nos pedidos já lidos (do banco, sem chamar a loja). Servem para conferir o que o painel trata como “pago” e “enviado”. */
export async function valoresDePedidos(db: Db, storeId: string): Promise<ValoresDePedidos> {
  const campo = async (coluna: "payment_status" | "status" | "shipping_status") =>
    (await db.query<{ valor: string | null; n: string }>(`SELECT coalesce(${coluna}, '(vazio)') AS valor, count(*)::text AS n FROM orders WHERE store_id = $1::uuid GROUP BY 1 ORDER BY count(*) DESC`, [storeId])).map((r) => ({ valor: r.valor ?? "(vazio)", pedidos: Number(r.n) }));
  return { pagamento: await campo("payment_status"), situacao: await campo("status"), envio: await campo("shipping_status") };
}

export { ROTULO_STATUS, relatorioTexto } from "./relatorio";
export type { Diagnostico, ResultadoSonda, ResultadoWebhooks, StatusSonda, ValorObservado, ValoresDePedidos } from "./relatorio";
