import { EXIGENCIAS, escopoConcedido } from "@/lib/diagnostico/sondas";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/handler";

/** Vigia das integrações: confere, sem alterar nada, se o que o painel precisa para funcionar continua de pé. */
export type StatusVigia = "ok" | "aviso" | "erro" | "inativo";

export interface Verificacao {
  id: string;
  rotulo: string;
  status: StatusVigia;
  detalhe: string;
  /** O que fazer quando não está ok. */
  acao?: string;
}

/** Os itens que o vigia confere, na ordem em que aparecem. */
export const ROTULO_ITEM: Record<string, string> = {
  nuvemshop: "Conexão com a Nuvemshop",
  webhooks: "Avisos da Nuvemshop (webhooks)",
  catalogo: "Leitura diária do catálogo",
  pedidos: "Leitura dos pedidos",
  permissoes: "Permissões do app",
  email: "Envio de e-mail (resumo, relatório e alertas)",
  ia: "Recursos de IA",
};

export const ROTULO_STATUS: Record<StatusVigia, string> = { ok: "OK", aviso: "Atenção", erro: "Com problema", inativo: "Não usado" };

const HORA = 3_600_000;
/** A leitura diária do catálogo roda uma vez por dia: 48 h sem rodar é atraso; 96 h é falha. */
export const CATALOGO_AVISO_H = 48;
export const CATALOGO_ERRO_H = 96;
export const PEDIDOS_AVISO_H = 36;
export const PEDIDOS_ERRO_H = 96;

const horas = (de: string | null, agora: number) => (de ? (agora - Date.parse(de)) / HORA : null);
const idade = (h: number) => (h < 48 ? `${Math.round(h)} horas` : `${Math.floor(h / 24)} dias`);

export function verificarCatalogo(ultima: { status: string; quando: string } | null, agora: number): Verificacao {
  const base = { id: "catalogo", rotulo: "Leitura diária do catálogo" };
  if (!ultima) return { ...base, status: "aviso", detalhe: "O catálogo ainda não foi sincronizado.", acao: "Abra a página inicial e sincronize os produtos." };
  const h = horas(ultima.quando, agora)!;
  if (ultima.status === "failed") return { ...base, status: "erro", detalhe: `A última sincronização falhou (há ${idade(h)}).`, acao: "Abra a página inicial e sincronize de novo; se persistir, rode o diagnóstico." };
  if (ultima.status === "running") return { ...base, status: "ok", detalhe: "Sincronização em andamento." };
  if (h > CATALOGO_ERRO_H) return { ...base, status: "erro", detalhe: `A última sincronização foi há ${idade(h)}: a rotina diária parou.`, acao: "Confira o cron e a variável CRON_SECRET na Vercel e sincronize à mão." };
  if (h > CATALOGO_AVISO_H) return { ...base, status: "aviso", detalhe: `A última sincronização foi há ${idade(h)}.`, acao: "Sincronize à mão e confira se a rotina diária da Vercel está rodando." };
  return { ...base, status: "ok", detalhe: `Última sincronização há ${idade(h)}.` };
}

export function verificarPedidos(lidosEm: string | null, agora: number): Verificacao {
  const base = { id: "pedidos", rotulo: "Leitura dos pedidos" };
  if (!lidosEm) return { ...base, status: "inativo", detalhe: "Os pedidos ainda não foram lidos (Vendas → Ler pedidos)." };
  const h = horas(lidosEm, agora)!;
  if (h > PEDIDOS_ERRO_H) return { ...base, status: "erro", detalhe: `Os pedidos não são lidos há ${idade(h)}: a rotina diária parou.`, acao: "Leia os pedidos à mão em Vendas e confira o cron na Vercel." };
  if (h > PEDIDOS_AVISO_H) return { ...base, status: "aviso", detalhe: `Os pedidos foram lidos há ${idade(h)}.`, acao: "Leia os pedidos em Vendas." };
  return { ...base, status: "ok", detalhe: `Lidos há ${idade(h)}.` };
}

export function verificarPermissoes(concedidos: string[]): Verificacao {
  const base = { id: "permissoes", rotulo: "Permissões do app" };
  const faltam = EXIGENCIAS.filter((e) => e.exige.some((x) => !escopoConcedido(concedidos, x)));
  if (concedidos.length === 0) return { ...base, status: "aviso", detalhe: "A loja não informou as permissões concedidas.", acao: "Reautorize a loja no Portal de Parceiros da Nuvemshop." };
  return faltam.length === 0
    ? { ...base, status: "ok", detalhe: "Todas as permissões que o painel usa estão concedidas." }
    : { ...base, status: "aviso", detalhe: `Faltam permissões para: ${faltam.map((e) => e.funcionalidade).join("; ")}.`, acao: "Ative as permissões no app (Portal de Parceiros) e reautorize a loja." };
}

export interface RespostaWebhooks {
  /** A Nuvemshop respondeu? */
  ok: boolean;
  /** Status HTTP quando falhou (401 = token inválido ou revogado). */
  status?: number;
  mensagem?: string;
  webhooks: Array<{ event: string; url: string }>;
}

/** O token funciona e a Nuvemshop responde? Vem da mesma chamada que lista os webhooks. */
export function verificarConexao(r: RespostaWebhooks): Verificacao {
  const base = { id: "nuvemshop", rotulo: "Conexão com a Nuvemshop" };
  if (r.ok) return { ...base, status: "ok", detalhe: "A Nuvemshop respondeu com o token atual." };
  if (r.status === 401) return { ...base, status: "erro", detalhe: "A Nuvemshop recusou o acesso: o token é inválido ou foi revogado.", acao: "Reconecte a loja na página inicial (Conectar com a Nuvemshop)." };
  return { ...base, status: "aviso", detalhe: r.mensagem ?? "Não consegui falar com a Nuvemshop agora.", acao: "Pode ser uma instabilidade passageira; a próxima verificação tenta de novo." };
}

/** Os avisos (webhooks) que mantêm o espelho em dia estão registrados e apontam para este painel? `precisaPedidoPago` = alerta de pedido pago ligado. */
export function verificarWebhooks(r: RespostaWebhooks, args: { appUrl: string; precisaPedidoPago: boolean }): Verificacao {
  const base = { id: "webhooks", rotulo: "Avisos da Nuvemshop (webhooks)" };
  if (!r.ok) return { ...base, status: "aviso", detalhe: "Não foi possível conferir (a conexão com a Nuvemshop falhou).", acao: "Resolva a conexão primeiro." };
  const url = `${args.appUrl.replace(/\/+$/, "")}/api/webhooks/nuvemshop`;
  const esperados: string[] = [...WEBHOOK_EVENTS, ...(args.precisaPedidoPago ? ["order/paid"] : [])];
  const faltam = esperados.filter((e) => !r.webhooks.some((w) => w.event === e && w.url === url));
  if (faltam.length === 0) return { ...base, status: "ok", detalhe: `${esperados.length} avisos registrados para este painel.` };
  const foraDoEndereco = faltam.filter((e) => r.webhooks.some((w) => w.event === e));
  return {
    ...base,
    status: faltam.some((e) => e.startsWith("product/")) ? "erro" : "aviso",
    detalhe: `Faltam ${faltam.length} de ${esperados.length}: ${faltam.join(", ")}.${foraDoEndereco.length > 0 ? ` ${foraDoEndereco.length === 1 ? "Um deles está" : "Alguns estão"} registrado(s) para outro endereço.` : ""}`,
    acao: faltam.includes("order/paid") && faltam.length === 1 ? "Em Alertas, clique em “Ativar aviso de pedido pago”." : "Na página inicial, use “Registrar webhooks” (e, para pedido pago, “Ativar aviso de pedido pago” em Alertas).",
  };
}

export interface EstadoEmail {
  /** Alguma função que envia e-mail está ligada (resumo diário, relatório mensal ou alertas). */
  emUso: boolean;
  chaveConfigurada: boolean;
  /** Último erro de envio recente (resumo, relatório ou alerta), se houver. */
  ultimoErro: string | null;
}

export function verificarEmail(e: EstadoEmail): Verificacao {
  const base = { id: "email", rotulo: "Envio de e-mail (resumo, relatório e alertas)" };
  if (!e.emUso) return { ...base, status: "inativo", detalhe: "Nenhuma função de e-mail está ligada." };
  if (!e.chaveConfigurada) return { ...base, status: "aviso", detalhe: "Há e-mails ligados, mas falta a chave RESEND_API_KEY: nada é enviado.", acao: "Cadastre a chave do Resend na Vercel e faça um novo deploy (veja Resumo diário)." };
  if (e.ultimoErro) return { ...base, status: "aviso", detalhe: `O último envio teve falha: ${e.ultimoErro}`, acao: "Confira o remetente (RESEND_FROM) e o domínio verificado no Resend." };
  return { ...base, status: "ok", detalhe: "Chave configurada e sem falhas recentes." };
}

export function verificarIa(chaveConfigurada: boolean): Verificacao {
  const base = { id: "ia", rotulo: "Recursos de IA" };
  return chaveConfigurada
    ? { ...base, status: "ok", detalhe: "Chave da API da Anthropic configurada." }
    : { ...base, status: "aviso", detalhe: "Falta a chave ANTHROPIC_API_KEY: cadastro por foto, SEO, Corrigir com a IA e páginas com IA não funcionam.", acao: "Cadastre ANTHROPIC_API_KEY na Vercel e faça um novo deploy." };
}
