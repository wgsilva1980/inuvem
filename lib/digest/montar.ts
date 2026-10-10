import type { PainelDoDia, Tarefa } from "@/lib/dashboard/hoje";

export interface ResumoMontado {
  assunto: string;
  texto: string;
  html: string;
  urgentes: number;
  atencao: number;
  total: number;
}

/** Moeda com espaço comum (o toLocaleString usa espaço sem quebra, que alguns leitores de e-mail mostram mal no assunto). */
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const GRUPOS: Array<{ tom: Tarefa["tom"]; titulo: string; cor: string }> = [
  { tom: "danger", titulo: "Urgente", cor: "#b3261e" },
  { tom: "warning", titulo: "Atenção", cor: "#9a6700" },
  { tom: "info", titulo: "Para saber", cor: "#444444" },
];

/**
 * Monta o e-mail do resumo diário a partir do painel do dia. Só números e títulos do negócio (nenhum dado de cliente). `appUrl` é o endereço
 * público do painel, usado nos links. De manhã o que importa são as vendas de ontem (as de hoje mal começaram).
 */
export function montarResumo(painel: PainelDoDia, args: { appUrl: string; dataTexto: string }): ResumoMontado {
  const base = args.appUrl.replace(/\/+$/, "");
  const urgentes = painel.tarefas.filter((t) => t.tom === "danger").length;
  const atencao = painel.tarefas.filter((t) => t.tom === "warning").length;
  const v = painel.vendas;
  const ontem = v ? `${v.ontem.pedidos} ${v.ontem.pedidos === 1 ? "pedido" : "pedidos"} · ${brl(v.ontem.faturamento)}` : null;

  const partes: string[] = [];
  if (urgentes > 0) partes.push(`${urgentes} ${urgentes === 1 ? "urgente" : "urgentes"}`);
  if (atencao > 0) partes.push(`${atencao} de atenção`);
  if (ontem) partes.push(`ontem ${brl(v!.ontem.faturamento)}`);
  const assunto = `INuvem · ${partes.length > 0 ? partes.join(" · ") : "tudo em dia"}`;

  const linhasTexto: string[] = [`Resumo do dia · ${args.dataTexto}`, ""];
  if (v) {
    linhasTexto.push(`Ontem: ${ontem}`, `Média dos últimos 7 dias: ${brl(v.mediaDiaria)} por dia`);
    if (painel.pedidosDesatualizados) linhasTexto.push("(Os pedidos estão desatualizados: os números podem estar incompletos.)");
    linhasTexto.push("");
  }
  if (painel.tarefas.length === 0) linhasTexto.push("Nada pendente: expedição, estoque, promoções, lotes e cashback em dia.");
  for (const g of GRUPOS) {
    const ts = painel.tarefas.filter((t) => t.tom === g.tom);
    if (ts.length === 0) continue;
    linhasTexto.push(`${g.titulo}:`);
    for (const t of ts) linhasTexto.push(`- ${t.titulo}${t.detalhe ? ` (${t.detalhe})` : ""}: ${base}${t.href}`);
    linhasTexto.push("");
  }
  linhasTexto.push(`Abrir o painel: ${base}/`, "Para parar de receber este resumo, desligue-o em Administração → Resumo diário.");

  const blocoVendas = v
    ? `<table role="presentation" style="border-collapse:collapse;margin:0 0 16px"><tr>
         <td style="padding:0 24px 0 0"><div style="color:#666;font-size:12px">Ontem</div><div style="font-size:20px;font-weight:600">${esc(brl(v.ontem.faturamento))}</div><div style="color:#666;font-size:12px">${v.ontem.pedidos} ${v.ontem.pedidos === 1 ? "pedido" : "pedidos"}</div></td>
         <td><div style="color:#666;font-size:12px">Média dos últimos 7 dias</div><div style="font-size:20px;font-weight:600">${esc(brl(v.mediaDiaria))}</div><div style="color:#666;font-size:12px">por dia</div></td></tr></table>${painel.pedidosDesatualizados ? `<p style="color:#9a6700;font-size:13px;margin:0 0 16px">Os pedidos estão desatualizados: os números podem estar incompletos.</p>` : ""}`
    : "";
  const blocoTarefas =
    painel.tarefas.length === 0
      ? `<p style="color:#1f7a3d;margin:0 0 16px">Nada pendente: expedição, estoque, promoções, lotes e cashback em dia.</p>`
      : GRUPOS.map((g) => {
          const ts = painel.tarefas.filter((t) => t.tom === g.tom);
          if (ts.length === 0) return "";
          return `<h3 style="margin:16px 0 6px;font-size:14px;color:${g.cor}">${g.titulo}</h3><ul style="margin:0;padding-left:18px">${ts
            .map((t) => `<li style="margin:3px 0"><a href="${esc(base + t.href)}" style="color:#1a56db">${esc(t.titulo)}</a>${t.detalhe ? ` <span style="color:#666;font-size:12px">${esc(t.detalhe)}</span>` : ""}</li>`)
            .join("")}</ul>`;
        }).join("");
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#222"><div style="max-width:560px;margin:0 auto;padding:20px"><div style="background:#fff;border-radius:8px;padding:20px"><h2 style="margin:0 0 4px;font-size:18px">Resumo do dia</h2><p style="margin:0 0 16px;color:#666;font-size:13px">${esc(args.dataTexto)}</p>${blocoVendas}${blocoTarefas}<p style="margin:20px 0 0"><a href="${esc(base)}/" style="color:#1a56db">Abrir o painel</a></p></div><p style="color:#888;font-size:12px;text-align:center">Para parar de receber este resumo, desligue-o em Administração → Resumo diário.</p></div></body></html>`;

  return { assunto, texto: linhasTexto.join("\n"), html, urgentes, atencao, total: painel.tarefas.length };
}
