import { coberturaDosPedidos, maisVendidos, resumoDoPeriodo, type ProdutoVendido, type ResumoPeriodo } from "@/lib/orders/stats";
import type { Db } from "@/lib/sync/repo";
import { periodosDoAnoPassado, type CampanhaPrevista } from "./calendario";

export interface HistoricoDaCampanha {
  ano: number;
  janela: { de: string; ate: string };
  /** Os pedidos lidos cobrem toda a janela do ano passado? Se não, os números são parciais ou inexistentes. */
  coberto: boolean;
  vendas: ResumoPeriodo;
  /** Quantas vezes o faturamento diário da janela superou o ritmo dos 60 dias anteriores; null sem base para comparar. */
  fator: number | null;
  maisVendidos: ProdutoVendido[];
}

const porDia = (faturamento: number, dias: number) => faturamento / dias;
const diasDe = (p: { de: string; ate: string }) => Math.round((Date.parse(`${p.ate}T00:00:00Z`) - Date.parse(`${p.de}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * O que a mesma campanha vendeu no ano passado, com os pedidos que o painel já leu. Serve para dimensionar a compra: se a janela vendeu 2,5× o
 * ritmo normal, a sugestão de compras (que parte do ritmo de hoje) tende a ficar curta. Sem pedidos daquela época, devolve `coberto: false`.
 */
export async function historicoDaCampanha(db: Db, storeId: string, c: CampanhaPrevista): Promise<HistoricoDaCampanha> {
  const { ano, janela, base } = periodosDoAnoPassado(c);
  const cobertura = await coberturaDosPedidos(db, storeId);
  const coberto = cobertura.primeiro !== null && cobertura.primeiro <= janela.de;
  const vazio: ResumoPeriodo = { pedidos: 0, faturamento: 0, unidades: 0, ticket: 0 };
  if (!coberto) return { ano, janela, coberto: false, vendas: vazio, fator: null, maisVendidos: [] };
  const baseCoberta = cobertura.primeiro !== null && cobertura.primeiro <= base.de;
  const [vendas, antes, top] = await Promise.all([resumoDoPeriodo(db, storeId, janela), baseCoberta ? resumoDoPeriodo(db, storeId, base) : Promise.resolve(null), maisVendidos(db, storeId, janela, "unidades", 3)]);
  const ritmoBase = antes ? porDia(antes.faturamento, diasDe(base)) : 0;
  const fator = ritmoBase > 0 ? Math.round((porDia(vendas.faturamento, diasDe(janela)) / ritmoBase) * 10) / 10 : null;
  return { ano, janela, coberto: true, vendas, fator, maisVendidos: top };
}
