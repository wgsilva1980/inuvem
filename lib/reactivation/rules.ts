/** Regras puras da reativação de clientes. */
export const FAIXAS_DIAS = [60, 90, 120, 180, 365] as const;
export const DIAS_PADRAO = 90;
/** Depois de avisada, a cliente some da lista por este tempo (não insistir). */
export const ESPERA_APOS_AVISO_DIAS = 30;
export const MAX_LISTA = 100;
/** Janela para medir quantas avisadas voltaram a comprar. */
export const JANELA_RESULTADO_DIAS = 90;

export function diasValidos(v: unknown): number {
  const n = Number(v);
  return (FAIXAS_DIAS as readonly number[]).includes(n) ? n : DIAS_PADRAO;
}

export function primeiroNome(nome: string | null | undefined): string | null {
  const p = (nome ?? "").replace(/\s+/g, " ").trim().split(" ")[0];
  if (!p || p.length > 30 || /[@\d]/.test(p)) return null;
  return p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1).toLocaleLowerCase("pt-BR");
}

/** Texto fixo (sem IA e sem promessa de desconto): não inventa cupom nem prazo. */
export function mensagemDeReativacao(args: { primeiroNome: string | null }): string {
  const saudacao = args.primeiroNome ? `Oi, ${args.primeiroNome}!` : "Olá!";
  return `${saudacao} Tudo bem? Aqui é da Donatelle Concept. Faz um tempinho que você não passa por aqui e queríamos te mostrar as novidades que chegaram. Se quiser ajuda para escolher, é só responder esta mensagem. 💛\n\nDonatelle Concept`;
}

export const ASSUNTO_REATIVACAO = "Saudades de você na Donatelle Concept";
