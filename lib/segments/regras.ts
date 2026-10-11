/** Segmentos de clientes, calculados dos pedidos pagos e não cancelados já lidos pelo painel. Uma cliente pode estar em mais de um. */
export type SegmentoId = "frequentes" | "uma-compra" | "maior-ticket" | "novas";

export const SEGMENTOS: Record<SegmentoId, { rotulo: string; descricao: string; ideia: string }> = {
  frequentes: {
    rotulo: "Compram com frequência",
    descricao: "Compraram em pelo menos 3 meses diferentes nos últimos 6 meses.",
    ideia: "As melhores clientes: cuide delas com novidades em primeira mão, cashback ou um mimo. Não precisam de desconto para comprar.",
  },
  "uma-compra": {
    rotulo: "Uma compra só",
    descricao: "Fizeram um único pedido, há mais de 30 dias.",
    ideia: "O segundo pedido é o mais difícil: uma mensagem com sugestões que combinam com o que levaram ou um cupom de volta costuma ajudar.",
  },
  "maior-ticket": {
    rotulo: "Maior ticket",
    descricao: "O valor médio por pedido está entre os 10% mais altos da loja.",
    ideia: "Compram peças de maior valor: avise primeiro das coleções novas e das peças mais caras. Boas candidatas a atendimento próximo.",
  },
  novas: {
    rotulo: "Novas clientes",
    descricao: "A primeira compra foi nos últimos 60 dias.",
    ideia: "Hora de acolher: pós-venda, apresentar o restante do catálogo e pedir a avaliação da primeira compra.",
  },
};
export const SEGMENTO_IDS = Object.keys(SEGMENTOS) as SegmentoId[];
export const ehSegmento = (x: unknown): x is SegmentoId => typeof x === "string" && x in SEGMENTOS;

export const MESES_FREQUENTES = 3;
export const DIAS_UMA_COMPRA = 30;
export const DIAS_NOVAS = 60;
/** Percentil do ticket médio a partir do qual a cliente entra em “Maior ticket”. */
export const PERCENTIL_TICKET = 0.9;
/** Com poucas clientes o percentil não significa nada. */
export const MIN_CLIENTES_TICKET = 10;

export interface ClienteAgregada {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  /** accepts_marketing = false: recusou contato. */
  recusouContato: boolean;
  pedidos: number;
  gasto: number;
  primeiraCompra: string;
  ultimaCompra: string;
  /** Em quantos meses diferentes (calendário de Brasília) comprou nos últimos 6 meses. */
  mesesComCompra6: number;
}

const DIA_MS = 86_400_000;
export const ticketMedio = (c: Pick<ClienteAgregada, "gasto" | "pedidos">) => (c.pedidos > 0 ? c.gasto / c.pedidos : 0);

/** O ticket médio a partir do qual a cliente entra em “Maior ticket”; null se há clientes de menos para o percentil fazer sentido. */
export function limiteDoTicket(clientes: ClienteAgregada[]): number | null {
  if (clientes.length < MIN_CLIENTES_TICKET) return null;
  const tickets = clientes.map(ticketMedio).sort((a, b) => a - b);
  return tickets[Math.min(tickets.length - 1, Math.floor(PERCENTIL_TICKET * tickets.length))]!; // com 10 clientes, só a de maior ticket; com 100, as 10 maiores
}

export function classificar(clientes: ClienteAgregada[], agora: Date = new Date()): Record<SegmentoId, ClienteAgregada[]> {
  const t = agora.getTime();
  const limite = limiteDoTicket(clientes);
  const por: Record<SegmentoId, ClienteAgregada[]> = { frequentes: [], "uma-compra": [], "maior-ticket": [], novas: [] };
  for (const c of clientes) {
    if (c.mesesComCompra6 >= MESES_FREQUENTES) por.frequentes.push(c);
    if (c.pedidos === 1 && Date.parse(c.ultimaCompra) < t - DIAS_UMA_COMPRA * DIA_MS) por["uma-compra"].push(c);
    if (limite !== null && limite > 0 && ticketMedio(c) >= limite) por["maior-ticket"].push(c);
    if (Date.parse(c.primeiraCompra) >= t - DIAS_NOVAS * DIA_MS) por.novas.push(c);
  }
  for (const id of SEGMENTO_IDS) por[id].sort((a, b) => b.gasto - a.gasto || a.id.localeCompare(b.id));
  return por;
}

/** Dá para falar com ela? Não recusou contato e tem telefone ou e-mail. */
export const alcancavel = (c: ClienteAgregada) => !c.recusouContato && Boolean(c.telefone || c.email);

export interface ResumoSegmento {
  id: SegmentoId;
  clientes: number;
  gasto: number;
  ticket: number;
  alcancaveis: number;
}

export function resumir(por: Record<SegmentoId, ClienteAgregada[]>): ResumoSegmento[] {
  return SEGMENTO_IDS.map((id) => {
    const l = por[id];
    const gasto = Math.round(l.reduce((s, c) => s + c.gasto, 0) * 100) / 100;
    const pedidos = l.reduce((s, c) => s + c.pedidos, 0);
    return { id, clientes: l.length, gasto, ticket: pedidos > 0 ? Math.round((gasto / pedidos) * 100) / 100 : 0, alcancaveis: l.filter(alcancavel).length };
  });
}
