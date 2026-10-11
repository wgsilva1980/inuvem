import { cashbackEmitido } from "@/lib/cashback/repo";
import { hojeEmBrasilia } from "@/lib/coupons/lote";
import { brl } from "@/lib/costs/math";
import { coberturaDosPedidos, descontosDoPeriodo, maisVendidos, margemDoPeriodo, porCategoria, resumoDoPeriodo, somarDias, vendasPorDia, type Fatia, type MargemDoPeriodo, type Periodo, type ProdutoVendido, type ResumoPeriodo } from "@/lib/orders/stats";
import type { Db } from "@/lib/sync/repo";
import { configDoEmail, enviarEmail, type ConfigEmail } from "./enviar";
import { administradoresEntre, obterConfigResumo } from "./service";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export interface MesRelatorio {
  /** AAAA-MM */
  chave: string;
  rotulo: string;
  periodo: Periodo;
}

/** Um mês inteiro pelo ano e pelo mês (1 a 12). */
export function mesDe(ano: number, mes: number): MesRelatorio {
  const primeiro = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const proximo = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
  return { chave: primeiro.slice(0, 7), rotulo: `${MESES[mes - 1]} de ${ano}`, periodo: { de: primeiro, ate: somarDias(proximo, -1) } };
}

/** O mês anterior ao dia `hoje` (AAAA-MM-DD, Brasília): o mês do relatório que sai no dia 1º. */
export function mesAnterior(hoje: string): MesRelatorio {
  const [a, m] = hoje.split("-").map(Number) as [number, number];
  return m === 1 ? mesDe(a - 1, 12) : mesDe(a, m - 1);
}

/** Variação percentual de `atual` sobre `antes`; null quando não havia nada antes para comparar. */
export function variacao(atual: number, antes: number): number | null {
  return antes > 0 ? Math.round(((atual - antes) / antes) * 1000) / 10 : null;
}

export interface DadosDoMes {
  mes: MesRelatorio;
  anterior: MesRelatorio;
  vendas: ResumoPeriodo;
  vendasAnterior: ResumoPeriodo;
  margem: MargemDoPeriodo;
  margemAnterior: MargemDoPeriodo;
  descontos: { valor: number; pedidos: number };
  cashback: { cupons: number; valor: number };
  produtos: ProdutoVendido[];
  categorias: Fatia[];
  melhorDia: { dia: string; faturamento: number; pedidos: number } | null;
  /** Primeiro dia com pedido lido, se for depois do início do mês (os pedidos anteriores não foram lidos). */
  lidoApartirDe: string | null;
  semPedidos: boolean;
}

export async function dadosDoMes(db: Db, storeId: string, mes: MesRelatorio): Promise<DadosDoMes> {
  const anterior = mesAnterior(mes.periodo.de);
  const [vendas, vendasAnterior, margem, margemAnterior, descontos, cashback, produtos, categorias, dias, cobertura] = await Promise.all([
    resumoDoPeriodo(db, storeId, mes.periodo),
    resumoDoPeriodo(db, storeId, anterior.periodo),
    margemDoPeriodo(db, storeId, mes.periodo),
    margemDoPeriodo(db, storeId, anterior.periodo),
    descontosDoPeriodo(db, storeId, mes.periodo),
    cashbackEmitido(db, storeId, mes.periodo),
    maisVendidos(db, storeId, mes.periodo, "valor", 5),
    porCategoria(db, storeId, mes.periodo, 3),
    vendasPorDia(db, storeId, mes.periodo),
    coberturaDosPedidos(db, storeId),
  ]);
  const melhor = dias.reduce<(typeof dias)[number] | null>((m, d) => (d.faturamento > (m?.faturamento ?? 0) ? d : m), null);
  return {
    mes,
    anterior,
    vendas,
    vendasAnterior,
    margem,
    margemAnterior,
    descontos,
    cashback,
    produtos,
    categorias,
    melhorDia: melhor ? { dia: melhor.dia, faturamento: melhor.faturamento, pedidos: melhor.pedidos } : null,
    lidoApartirDe: cobertura.primeiro !== null && cobertura.primeiro > mes.periodo.de ? cobertura.primeiro : null,
    semPedidos: cobertura.total === 0,
  };
}

export interface RelatorioMontado {
  assunto: string;
  texto: string;
  html: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => brl(n).replace(/ /g, " ");
const pct = (n: number | null, casas = 1) => (n === null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: casas })}%`);
const dia = (iso: string) => iso.split("-").reverse().join("/");
const pecas = (n: number) => `${n} ${n === 1 ? "peça" : "peças"}`;

/** Monta o e-mail do mês. Só números do negócio (nenhum dado de cliente). */
export function montarRelatorioMensal(d: DadosDoMes, args: { appUrl: string }): RelatorioMontado {
  const base = args.appUrl.replace(/\/+$/, "");
  const ant = d.anterior.rotulo.split(" ")[0]!;
  const varFat = variacao(d.vendas.faturamento, d.vendasAnterior.faturamento);
  const comparar = (n: number | null) => (n === null ? `sem ${ant} para comparar` : `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% sobre ${ant}`);
  const assunto = `INuvem · ${d.mes.rotulo}: ${money(d.vendas.faturamento)} em ${d.vendas.pedidos} ${d.vendas.pedidos === 1 ? "pedido" : "pedidos"}`;

  const avisos: string[] = [];
  if (d.semPedidos) avisos.push("Os pedidos ainda não foram lidos pelo painel (Vendas → Ler pedidos): os números abaixo estão zerados.");
  else if (d.lidoApartirDe) avisos.push(`Os pedidos foram lidos só a partir de ${dia(d.lidoApartirDe)}: o mês pode estar incompleto.`);

  const linhas: Array<[string, string, string]> = [
    ["Faturamento", money(d.vendas.faturamento), comparar(varFat)],
    ["Pedidos pagos", String(d.vendas.pedidos), comparar(variacao(d.vendas.pedidos, d.vendasAnterior.pedidos))],
    ["Ticket médio", money(d.vendas.ticket), comparar(variacao(d.vendas.ticket, d.vendasAnterior.ticket))],
    ["Peças vendidas", String(d.vendas.unidades), comparar(variacao(d.vendas.unidades, d.vendasAnterior.unidades))],
  ];
  const lucro: Array<[string, string, string]> =
    d.margem.margem === null
      ? []
      : [
          ["Lucro bruto estimado", money(d.margem.lucroBruto), comparar(d.margemAnterior.margem === null ? null : variacao(d.margem.lucroBruto, d.margemAnterior.lucroBruto))],
          ["Margem estimada", pct(d.margem.margem), d.margemAnterior.margem === null ? `sem ${ant} para comparar` : `${ant}: ${pct(d.margemAnterior.margem)}`],
        ];
  const brutoDescontos = d.vendas.faturamento + d.descontos.valor;
  const extras: Array<[string, string, string]> = [
    ["Descontos dados nos pedidos", money(d.descontos.valor), d.descontos.pedidos > 0 ? `em ${d.descontos.pedidos} ${d.descontos.pedidos === 1 ? "pedido" : "pedidos"}${brutoDescontos > 0 ? `, ${pct((d.descontos.valor / brutoDescontos) * 100)} do valor antes dos descontos` : ""}` : "nenhum pedido com desconto"],
    ["Cashback emitido", money(d.cashback.valor), `${d.cashback.cupons} ${d.cashback.cupons === 1 ? "cupom" : "cupons"} (o uso dos cupons aparece nas vendas do mês seguinte)`],
  ];
  const todas = [...linhas, ...lucro, ...extras];

  const texto = [
    `Relatório de ${d.mes.rotulo}`,
    "",
    ...avisos.map((a) => `(${a})`),
    ...todas.map(([r, v, n]) => `${r}: ${v} (${n})`),
    ...(d.margem.margem !== null ? [`O lucro e a margem contam ${pct(d.margem.cobertura)} do valor vendido (produtos com custo informado), com o custo de hoje, sem frete, taxas nem impostos.`] : ["Sem custos informados nos produtos vendidos: preencha em Custos para ver o lucro."]),
    "",
    ...(d.produtos.length > 0 ? ["Mais vendidos (por valor):", ...d.produtos.map((p, i) => `${i + 1}. ${p.nome}: ${pecas(p.unidades)} · ${money(p.valor)}`), ""] : []),
    ...(d.categorias.length > 0 ? ["Categorias:", ...d.categorias.map((c) => `- ${c.nome}: ${pecas(c.unidades)} · ${money(c.valor)}`), ""] : []),
    ...(d.melhorDia ? [`Melhor dia: ${dia(d.melhorDia.dia)}, ${money(d.melhorDia.faturamento)} em ${d.melhorDia.pedidos} ${d.melhorDia.pedidos === 1 ? "pedido" : "pedidos"}.`, ""] : []),
    `Vendas em detalhe: ${base}/vendas`,
    "Para parar de receber este relatório, desligue-o em Administração → Resumo diário.",
  ].join("\n");

  const linhaHtml = ([r, v, n]: [string, string, string]) =>
    `<tr><td style="padding:8px 12px 8px 0;border-top:1px solid #eee"><div style="color:#666;font-size:12px">${esc(r)}</div><div style="font-size:18px;font-weight:600">${esc(v)}</div></td><td style="padding:8px 0;border-top:1px solid #eee;color:#666;font-size:12px;vertical-align:bottom">${esc(n)}</td></tr>`;
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#222"><div style="max-width:560px;margin:0 auto;padding:20px"><div style="background:#fff;border-radius:8px;padding:20px">
<h2 style="margin:0 0 4px;font-size:18px">Relatório de ${esc(d.mes.rotulo)}</h2>
<p style="margin:0 0 12px;color:#666;font-size:13px">Comparado com ${esc(d.anterior.rotulo)}</p>
${avisos.map((a) => `<p style="color:#9a6700;font-size:13px;margin:0 0 12px">${esc(a)}</p>`).join("")}
<table role="presentation" style="border-collapse:collapse;width:100%">${todas.map(linhaHtml).join("")}</table>
<p style="color:#666;font-size:12px;margin:8px 0 16px">${d.margem.margem !== null ? `O lucro e a margem contam ${esc(pct(d.margem.cobertura))} do valor vendido (produtos com custo informado), com o custo de hoje, sem frete, taxas nem impostos.` : "Sem custos informados nos produtos vendidos: preencha em Custos para ver o lucro."}</p>
${d.produtos.length > 0 ? `<h3 style="margin:16px 0 6px;font-size:14px">Mais vendidos (por valor)</h3><ol style="margin:0;padding-left:20px">${d.produtos.map((p) => `<li style="margin:3px 0">${esc(p.nome)} <span style="color:#666;font-size:12px">${esc(pecas(p.unidades))} · ${esc(money(p.valor))}</span></li>`).join("")}</ol>` : ""}
${d.categorias.length > 0 ? `<h3 style="margin:16px 0 6px;font-size:14px">Categorias</h3><ul style="margin:0;padding-left:18px">${d.categorias.map((c) => `<li style="margin:3px 0">${esc(c.nome)} <span style="color:#666;font-size:12px">${esc(pecas(c.unidades))} · ${esc(money(c.valor))}</span></li>`).join("")}</ul>` : ""}
${d.melhorDia ? `<p style="margin:16px 0 0;font-size:13px">Melhor dia: <strong>${esc(dia(d.melhorDia.dia))}</strong>, ${esc(money(d.melhorDia.faturamento))} em ${d.melhorDia.pedidos} ${d.melhorDia.pedidos === 1 ? "pedido" : "pedidos"}.</p>` : ""}
<p style="margin:20px 0 0"><a href="${esc(base)}/vendas" style="color:#1a56db">Ver as vendas em detalhe</a></p></div>
<p style="color:#888;font-size:12px;text-align:center">Para parar de receber este relatório, desligue-o em Administração → Resumo diário.</p></div></body></html>`;
  return { assunto, texto, html };
}

/** O relatório do mês (sem enviar): serve para a prévia e para o envio. */
export async function relatorioDoMes(db: Db, storeId: string, appUrl: string, mes: MesRelatorio): Promise<RelatorioMontado & { dados: DadosDoMes }> {
  const dados = await dadosDoMes(db, storeId, mes);
  return { ...montarRelatorioMensal(dados, { appUrl }), dados };
}

/** Último dia do mês em que o envio automático ainda vale (o dia 1º, com folga de 2 dias caso o cron falhe). */
export const DIA_LIMITE_ENVIO = 3;

export type ResultadoMensal = { enviado: true; destinatarios: number; mes: string; aviso?: string } | { enviado: false; motivo: string };

/**
 * Envia o relatório do mês anterior. Automático (cron diário): só se estiver ligado, nos dias 1 a 3 do mês e ainda não enviado para aquele mês.
 * `manual` ignora essas condições (botão “Enviar agora”) e não conta como o envio do mês. Os destinatários são os do resumo diário, conferidos
 * contra os administradores na hora de enviar.
 */
export async function enviarRelatorioMensal(
  db: Db,
  args: { storeId: string; actor: string; appUrl: string; manual?: boolean; agora?: Date; config?: ConfigEmail; fetchImpl?: typeof fetch },
): Promise<ResultadoMensal> {
  const agora = args.agora ?? new Date();
  const hoje = hojeEmBrasilia(agora);
  const mes = mesAnterior(hoje);
  const [r] = await db.query<{ monthly_enabled: boolean; monthly_last_month: string | null }>("SELECT monthly_enabled, monthly_last_month FROM digest_settings WHERE store_id = $1::uuid", [args.storeId]);
  if (!args.manual) {
    if (!r?.monthly_enabled) return { enviado: false, motivo: "Relatório mensal desligado." };
    if (Number(hoje.slice(8, 10)) > DIA_LIMITE_ENVIO) return { enviado: false, motivo: "Fora dos dias de envio (1 a 3 do mês)." };
    if (r.monthly_last_month === mes.chave) return { enviado: false, motivo: "Já enviado para este mês." };
  }
  const cfg = await obterConfigResumo(db, args.storeId);
  const destinatarios = await administradoresEntre(db, cfg.recipients);
  if (destinatarios.length === 0) return { enviado: false, motivo: "Nenhum destinatário administrador." };
  const rel = await relatorioDoMes(db, args.storeId, args.appUrl, mes);
  let envio;
  try {
    envio = await enviarEmail({ para: destinatarios, assunto: args.manual ? `[teste] ${rel.assunto}` : rel.assunto, html: rel.html, texto: rel.texto }, args.config ?? configDoEmail(), args.fetchImpl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao enviar.";
    if (!args.manual) await db.query("UPDATE digest_settings SET monthly_last_error = $2, monthly_last_error_at = now() WHERE store_id = $1::uuid", [args.storeId, msg.slice(0, 500)]);
    await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois, sucesso) VALUES ($1::uuid, $2, 'relatorio_mensal.enviar', 'loja', $3::jsonb, false)`, [args.storeId, args.actor, JSON.stringify({ mes: mes.chave, erro: msg.slice(0, 300), manual: Boolean(args.manual) })]);
    throw err;
  }
  const falhas = envio.falhas.length;
  const aviso = falhas > 0 ? `Não foi possível enviar para ${falhas} de ${destinatarios.length} destinatário(s): ${envio.falhas[0]?.erro ?? ""}`.slice(0, 500) : null;
  if (!args.manual) await db.query("UPDATE digest_settings SET monthly_last_month = $2, monthly_last_error = $3, monthly_last_error_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END WHERE store_id = $1::uuid", [args.storeId, mes.chave, aviso]);
  await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois, sucesso) VALUES ($1::uuid, $2, 'relatorio_mensal.enviar', 'loja', $3::jsonb, true)`, [args.storeId, args.actor, JSON.stringify({ mes: mes.chave, destinatarios: envio.enviados.length, falhas, manual: Boolean(args.manual) })]);
  return { enviado: true, destinatarios: envio.enviados.length, mes: mes.chave, ...(aviso ? { aviso } : {}) };
}
