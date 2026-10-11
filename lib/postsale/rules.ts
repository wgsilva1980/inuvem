/** Regras puras do pós-venda. */
export const ESPERAS_DIAS = [5, 7, 10, 15] as const;
export const ESPERA_PADRAO = 7;
/** Só entram pedidos enviados há no máximo este tempo: depois disso, perguntar “deu tudo certo?” já não faz sentido. */
export const JANELA_MAXIMA_DIAS = 45;
/** Depois de avisada, a cliente não recebe outro pós-venda por este tempo (nem de outro pedido). */
export const ESPERA_APOS_AVISO_DIAS = 30;
export const MAX_LISTA = 100;
export const JANELA_RESULTADO_DIAS = 90;

export type TipoMensagem = "tudo-certo" | "avaliacao";
export const TIPOS: Record<TipoMensagem, { rotulo: string; descricao: string; assunto: string }> = {
  "tudo-certo": { rotulo: "Deu tudo certo?", descricao: "Pergunta se o pedido chegou bem e se ela precisa de ajuda (troca, tamanho, dúvida).", assunto: "Seu pedido da Donatelle Concept chegou bem?" },
  avaliacao: { rotulo: "Pedir avaliação", descricao: "Pergunta se gostou e pede que conte como foi, com uma foto se quiser.", assunto: "Conta pra gente o que achou?" },
};
export const ehTipo = (x: unknown): x is TipoMensagem => typeof x === "string" && x in TIPOS;

export function esperaValida(v: unknown): number {
  const n = Number(v);
  return (ESPERAS_DIAS as readonly number[]).includes(n) ? n : ESPERA_PADRAO;
}

export { primeiroNome } from "@/lib/reactivation/rules";

/** Texto fixo (sem IA e sem promessa de desconto, prazo ou política): só o que o painel sabe, o número do pedido e há quantos dias foi enviado. */
export function mensagemDePosVenda(args: { tipo: TipoMensagem; primeiroNome: string | null; numero: number | null; diasDesdeEnvio: number }): string {
  const saudacao = args.primeiroNome ? `Oi, ${args.primeiroNome}!` : "Olá!";
  const pedido = args.numero !== null ? `seu pedido #${args.numero}` : "seu pedido";
  const quando = args.diasDesdeEnvio <= 0 ? "foi enviado hoje" : args.diasDesdeEnvio === 1 ? "foi enviado ontem" : `foi enviado há ${args.diasDesdeEnvio} dias`;
  if (args.tipo === "avaliacao") {
    return `${saudacao} Aqui é da Donatelle Concept. ${pedido[0]!.toLocaleUpperCase("pt-BR")}${pedido.slice(1)} ${quando}. Gostou das peças? Se puder, conta pra gente como foi (pode mandar uma foto também). Sua opinião ajuda muito a gente e outras clientes. 💛\n\nDonatelle Concept`;
  }
  return `${saudacao} Aqui é da Donatelle Concept. Passando para saber se ${pedido} chegou bem (${quando}). Se precisar de ajuda com tamanho, troca ou qualquer dúvida, é só responder esta mensagem. 💛\n\nDonatelle Concept`;
}
