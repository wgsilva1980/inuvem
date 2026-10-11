import { somarDias, type Periodo } from "@/lib/orders/stats";

/**
 * Calendário de campanhas do varejo de moda feminina. As datas são calculadas (Dia das Mães = 2º domingo de maio, Black Friday = sexta depois do
 * Dia de Ação de Graças…) e cada campanha traz antecedências típicas: quantos dias antes encomendar a mercadoria e quantos dias antes montar a promoção.
 * São pontos de partida de mercado, não regras: o prazo real é o do seu fornecedor.
 */
export type Relevancia = "alta" | "media" | "baixa";
export type Fase = "futura" | "comprar" | "preparar" | "vendendo";

interface Definicao {
  id: string;
  nome: string;
  data: (ano: number) => string;
  /** Dias de vendas da campanha, contados até a data (a janela de vendas é [data − janela, data]). */
  janela: number;
  /** Quantos dias antes da data encomendar a mercadoria. */
  compra: number;
  /** Quantos dias antes da data começar a montar a promoção, as fotos e os avisos. */
  promo: number;
  relevancia: Relevancia;
  /** Prazo do fornecedor (dias) sugerido para abrir a sugestão de compras. */
  prazoCompras: 15 | 30 | 45;
  dica: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (ano: number, mes: number, dia: number) => `${ano}-${pad(mes)}-${pad(dia)}`;
const diaDaSemana = (data: string) => new Date(`${data}T00:00:00Z`).getUTCDay();

/** A n-ésima ocorrência de um dia da semana (0 = domingo) no mês (1 a 12). */
export function enesimoDiaDaSemana(ano: number, mes: number, semana: number, n: number): string {
  const primeiro = iso(ano, mes, 1);
  const desvio = (semana - diaDaSemana(primeiro) + 7) % 7;
  return iso(ano, mes, 1 + desvio + (n - 1) * 7);
}

/** Black Friday: a sexta-feira depois do Dia de Ação de Graças (4ª quinta-feira de novembro). */
export const blackFriday = (ano: number): string => somarDias(enesimoDiaDaSemana(ano, 11, 4, 4), 1);

export const CAMPANHAS: readonly Definicao[] = [
  { id: "dia-da-mulher", nome: "Dia da Mulher", data: (a) => iso(a, 3, 8), janela: 7, compra: 40, promo: 14, relevancia: "media", prazoCompras: 30, dica: "Uma data para a própria cliente: destaque o que ela compra para si, com um mimo ou condição especial." },
  { id: "dia-do-consumidor", nome: "Dia do Consumidor", data: (a) => iso(a, 3, 15), janela: 3, compra: 30, promo: 10, relevancia: "baixa", prazoCompras: 30, dica: "Boa data para girar estoque parado com desconto por tempo curto." },
  { id: "dia-das-maes", nome: "Dia das Mães", data: (a) => enesimoDiaDaSemana(a, 5, 0, 2), janela: 14, compra: 60, promo: 21, relevancia: "alta", prazoCompras: 45, dica: "Presente e autocompra: monte vitrines de presentes, ofereça vale-presente e avise o prazo final de entrega com folga." },
  { id: "dia-dos-namorados", nome: "Dia dos Namorados", data: (a) => iso(a, 6, 12), janela: 10, compra: 50, promo: 18, relevancia: "alta", prazoCompras: 45, dica: "Looks para a ocasião e peças de presente; avise com antecedência o prazo de entrega." },
  { id: "dia-dos-pais", nome: "Dia dos Pais", data: (a) => enesimoDiaDaSemana(a, 8, 0, 2), janela: 7, compra: 40, promo: 14, relevancia: "baixa", prazoCompras: 30, dica: "Para moda feminina, vale o apelo de presente (acessórios, lenços) ou aproveitar o fluxo de visitas à loja virtual." },
  { id: "dia-do-cliente", nome: "Dia do Cliente", data: (a) => iso(a, 9, 15), janela: 3, compra: 30, promo: 10, relevancia: "media", prazoCompras: 30, dica: "Ótima data para recompensar quem já compra: cupom exclusivo ou cashback em dobro, avisando as clientes pelo WhatsApp." },
  { id: "black-friday", nome: "Black Friday", data: blackFriday, janela: 7, compra: 90, promo: 30, relevancia: "alta", prazoCompras: 45, dica: "A maior data de vendas do ano: confira a margem de cada desconto (Simulador) antes de anunciar e garanta estoque dos campeões de venda." },
  { id: "natal", nome: "Natal", data: (a) => iso(a, 12, 25), janela: 14, compra: 75, promo: 28, relevancia: "alta", prazoCompras: 45, dica: "Presentes e looks de festa: antecipe o prazo final de pedidos para entrega até o Natal e avise nas redes." },
  { id: "reveillon", nome: "Réveillon", data: (a) => iso(a, 12, 31), janela: 10, compra: 60, promo: 20, relevancia: "media", prazoCompras: 45, dica: "Looks de festa e virada (branco, brilho); combine com a promoção de Natal para não perder a semana entre as datas." },
];

export interface CampanhaPrevista {
  id: string;
  nome: string;
  /** AAAA-MM-DD */
  data: string;
  /** Dias de hoje até a data (0 = hoje). */
  dias: number;
  fase: Fase;
  relevancia: Relevancia;
  /** Último dia ideal para encomendar a mercadoria. */
  prazoCompra: string;
  /** Dia de começar a montar a promoção. */
  inicioPromo: string;
  /** Primeiro dia da janela de vendas. */
  inicioVendas: string;
  janela: number;
  prazoCompras: 15 | 30 | 45;
  dica: string;
}

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

export function faseDa(dias: number, d: Pick<Definicao, "janela" | "compra" | "promo">): Fase {
  if (dias > d.compra) return "futura";
  if (dias > d.promo) return "comprar";
  if (dias > d.janela) return "preparar";
  return "vendendo";
}

function prevista(d: Definicao, ano: number, hoje: string): CampanhaPrevista {
  const data = d.data(ano);
  const dias = diasEntre(hoje, data);
  return {
    id: d.id,
    nome: d.nome,
    data,
    dias,
    fase: faseDa(dias, d),
    relevancia: d.relevancia,
    prazoCompra: somarDias(data, -d.compra),
    inicioPromo: somarDias(data, -d.promo),
    inicioVendas: somarDias(data, -d.janela),
    janela: d.janela,
    prazoCompras: d.prazoCompras,
    dica: d.dica,
  };
}

/** As campanhas de hoje (inclusive) até `horizonteDias` à frente, da mais próxima para a mais distante. */
export function proximasCampanhas(hoje: string, horizonteDias = 366): CampanhaPrevista[] {
  const ano = Number(hoje.slice(0, 4));
  return [ano, ano + 1]
    .flatMap((a) => CAMPANHAS.map((d) => prevista(d, a, hoje)))
    .filter((c) => c.dias >= 0 && c.dias <= horizonteDias)
    .sort((a, b) => a.dias - b.dias || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** A mesma campanha no ano anterior: a janela de vendas e os 60 dias de vendas normais que a antecederam (para medir o quanto a data puxou). */
export function periodosDoAnoPassado(c: Pick<CampanhaPrevista, "id" | "janela" | "data">): { janela: Periodo; base: Periodo; ano: number } {
  const def = CAMPANHAS.find((d) => d.id === c.id)!;
  const ano = Number(c.data.slice(0, 4)) - 1;
  const data = def.data(ano);
  const de = somarDias(data, -c.janela);
  return { ano, janela: { de, ate: data }, base: { de: somarDias(de, -60), ate: somarDias(de, -1) } };
}

export const ROTULO_FASE: Record<Fase, string> = { futura: "Planejar", comprar: "Hora de comprar estoque", preparar: "Hora de montar a promoção", vendendo: "Vendas da campanha" };
