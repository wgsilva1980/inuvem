import { csv, type Celula } from "@/lib/backup/csv";
import { SEGMENTOS, alcancavel, ticketMedio, type ClienteAgregada, type SegmentoId } from "./regras";

/** Teto de linhas do arquivo (a Vercel recusa respostas acima de 4,5 MB). */
export const MAX_LINHAS_EXPORTACAO = 10_000;

const dia = (iso: string) => iso.slice(0, 10);

/**
 * CSV do segmento para campanhas. Sem `contatos`, só ID, números e datas (nenhum dado pessoal). Com `contatos`, entram nome, e-mail, telefone,
 * cidade e UF, e SÓ de quem aceita receber contato e tem telefone ou e-mail. Nunca CPF.
 */
export function csvDoSegmento(id: SegmentoId, clientes: ClienteAgregada[], opts: { contatos: boolean }): { conteudo: string; linhas: number; truncado: boolean } {
  const base = opts.contatos ? clientes.filter(alcancavel) : clientes;
  const usadas = base.slice(0, MAX_LINHAS_EXPORTACAO);
  const cab = ["Segmento", "ID da cliente", ...(opts.contatos ? ["Nome", "E-mail", "Telefone", "Cidade", "UF"] : []), "Pedidos", "Total gasto", "Ticket médio", "Primeira compra", "Última compra"];
  const linhas: Celula[][] = usadas.map((c) => [
    SEGMENTOS[id].rotulo,
    c.id,
    ...(opts.contatos ? [c.nome, c.email, c.telefone, c.cidade, c.uf] : []),
    c.pedidos,
    c.gasto.toFixed(2).replace(".", ","),
    ticketMedio(c).toFixed(2).replace(".", ","),
    dia(c.primeiraCompra),
    dia(c.ultimaCompra),
  ]);
  return { conteudo: csv(cab, linhas), linhas: usadas.length, truncado: base.length > usadas.length };
}
