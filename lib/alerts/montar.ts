import type { Email } from "@/lib/digest/enviar";

export const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface AlertaMontado {
  assunto: string;
  linhas: string[];
  link?: { url: string; rotulo: string };
}

/** E-mail curto e simples de alerta: um título, algumas linhas e um link para o painel. Só dados do negócio, nenhum dado de cliente. */
export function montarEmailAlerta(a: AlertaMontado): Omit<Email, "para"> {
  const texto = [a.assunto, "", ...a.linhas, ...(a.link ? ["", `${a.link.rotulo}: ${a.link.url}`] : []), "", "Você recebe este aviso porque os alertas do INuvem estão ligados (Administração → Alertas)."].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#222">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:8px">
<tr><td style="padding:20px 24px"><h1 style="margin:0 0 12px;font-size:18px">${esc(a.assunto)}</h1>
${a.linhas.map((l) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.4">${esc(l)}</p>`).join("")}
${a.link ? `<p style="margin:16px 0 0"><a href="${esc(a.link.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">${esc(a.link.rotulo)}</a></p>` : ""}
<p style="margin:20px 0 0;color:#666;font-size:12px">Você recebe este aviso porque os alertas do INuvem estão ligados (Administração → Alertas).</p></td></tr></table></td></tr></table></body></html>`;
  return { assunto: a.assunto, html, texto };
}

export interface ItemPedido {
  nome: string;
  quantidade: number;
}

/** Pedido pago: número, total e itens. Sem nome, e-mail, telefone ou endereço da cliente. */
export function alertaPedidoPago(args: { numero: number | string; total: number | null; itens: ItemPedido[]; appUrl: string }): AlertaMontado {
  const qtd = args.itens.reduce((s, i) => s + i.quantidade, 0);
  const lista = args.itens.slice(0, 6).map((i) => `${i.quantidade}× ${i.nome}`);
  const resto = args.itens.length - lista.length;
  return {
    assunto: `Pedido #${args.numero} pago${args.total !== null ? ` — ${brl(args.total)}` : ""}`,
    linhas: [`${qtd} ${qtd === 1 ? "peça" : "peças"}:`, ...lista, ...(resto > 0 ? [`e mais ${resto} ${resto === 1 ? "item" : "itens"}`] : []), "Já pode separar e embalar."],
    link: { url: `${args.appUrl.replace(/\/+$/, "")}/expedicao`, rotulo: "Abrir a expedição" },
  };
}

export function alertaEsgotado(args: { id: number | string; nome: string; despublicado: boolean; appUrl: string }): AlertaMontado {
  return {
    assunto: `Esgotou: ${args.nome}`,
    linhas: [`Todas as variações de “${args.nome}” ficaram sem estoque.`, args.despublicado ? "A regra “sem estoque” vai tirar o produto da loja." : "O produto continua publicado na loja; considere repor ou despublicar."],
    link: { url: `${args.appUrl.replace(/\/+$/, "")}/produtos/${args.id}`, rotulo: "Abrir o produto" },
  };
}

export function alertaSyncFalhou(args: { mensagem: string; appUrl: string }): AlertaMontado {
  return {
    assunto: "A sincronização com a Nuvemshop falhou",
    linhas: ["A leitura diária do catálogo não terminou. O painel pode estar mostrando dados desatualizados.", `Motivo: ${args.mensagem}`.slice(0, 400)],
    link: { url: `${args.appUrl.replace(/\/+$/, "")}/diagnostico`, rotulo: "Abrir o diagnóstico" },
  };
}

export function alertaTeste(appUrl: string): AlertaMontado {
  return { assunto: "[teste] Alertas do INuvem funcionando", linhas: ["Se você recebeu este e-mail, os alertas chegam aos destinatários salvos."], link: { url: `${appUrl.replace(/\/+$/, "")}/alertas`, rotulo: "Abrir os alertas" } };
}
