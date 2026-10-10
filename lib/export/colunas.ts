import type { LinhaProduto } from "@/lib/catalog/export";
import { SITUACAO_LABEL, situacaoDoCupom } from "@/lib/coupons/lote";
import type { ContactExport } from "@/lib/contacts/repo";
import type { Coupon } from "@/lib/nuvemshop/coupons";
import type { ProdutoVendido } from "@/lib/orders/stats";
import type { LinhaReposicao } from "@/lib/stock/insights";
import { KIND_LABEL, type ContactKind } from "@/lib/contacts/schema";
import type { Coluna } from "./xlsx";

const num = (v: string | null) => (v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const sn = (b: boolean | null) => (b === null ? "" : b ? "Sim" : "Não");

export const COLUNAS_PRODUTOS: Coluna<LinhaProduto>[] = [
  { titulo: "ID do produto", valor: (l) => l.produto_id, largura: 14 },
  { titulo: "Produto", valor: (l) => l.produto, largura: 42 },
  { titulo: "Publicado na loja", valor: (l) => sn(l.publicado), largura: 16 },
  { titulo: "Categorias", valor: (l) => l.categorias, largura: 30 },
  { titulo: "ID da variação", valor: (l) => l.variacao_id, largura: 14 },
  { titulo: "Variação", valor: (l) => l.variacao, largura: 22 },
  { titulo: "SKU", valor: (l) => l.sku, largura: 18 },
  { titulo: "Preço (R$)", valor: (l) => num(l.preco), largura: 12, formato: "#,##0.00" },
  { titulo: "Preço promocional (R$)", valor: (l) => num(l.preco_promocional), largura: 20, formato: "#,##0.00" },
  { titulo: "Controla estoque", valor: (l) => sn(l.controla_estoque), largura: 16 },
  { titulo: "Estoque", valor: (l) => (l.controla_estoque ? l.estoque : null), largura: 10 },
  { titulo: "Peso (kg)", valor: (l) => num(l.peso), largura: 10 },
  { titulo: "Altura (cm)", valor: (l) => num(l.altura), largura: 11 },
  { titulo: "Largura (cm)", valor: (l) => num(l.largura), largura: 12 },
  { titulo: "Profundidade (cm)", valor: (l) => num(l.profundidade), largura: 16 },
  { titulo: "Imagens do produto", valor: (l) => l.imagens, largura: 16 },
  { titulo: "Atualizado na loja em", valor: (l) => l.atualizado_em, largura: 20 },
];

export const COLUNAS_CONTATOS: Coluna<ContactExport>[] = [
  { titulo: "Nome", valor: (c) => c.name, largura: 36 },
  { titulo: "Nome fantasia", valor: (c) => c.trade_name, largura: 28 },
  { titulo: "Tipo", valor: (c) => (c.kind ? (KIND_LABEL[c.kind as ContactKind] ?? c.kind) : ""), largura: 14 },
  { titulo: "Pessoa", valor: (c) => (c.person_type === "juridica" ? "Jurídica" : "Física"), largura: 10 },
  { titulo: "CPF/CNPJ", valor: (c) => c.document, largura: 18 },
  { titulo: "Inscrição estadual", valor: (c) => (c.ie_exempt ? "Isento" : c.state_registration), largura: 18 },
  { titulo: "E-mail", valor: (c) => c.email, largura: 30 },
  { titulo: "Telefone", valor: (c) => c.phone, largura: 16 },
  { titulo: "Celular", valor: (c) => c.mobile, largura: 16 },
  { titulo: "Pessoa de contato", valor: (c) => c.contact_person, largura: 22 },
  { titulo: "CEP", valor: (c) => c.zip, largura: 11 },
  { titulo: "Endereço", valor: (c) => c.street, largura: 32 },
  { titulo: "Número", valor: (c) => c.number, largura: 9 },
  { titulo: "Complemento", valor: (c) => c.complement, largura: 18 },
  { titulo: "Bairro", valor: (c) => c.district, largura: 20 },
  { titulo: "Cidade", valor: (c) => c.city, largura: 20 },
  { titulo: "UF", valor: (c) => c.state, largura: 5 },
  { titulo: "Nascimento", valor: (c) => c.birth_date, largura: 12 },
  { titulo: "Cliente desde", valor: (c) => c.customer_since, largura: 13 },
  { titulo: "Origem", valor: (c) => (c.from_store ? "Loja" : "Cadastrado aqui"), largura: 14 },
  { titulo: "Total gasto na loja (R$)", valor: (c) => num(c.total_spent), largura: 22, formato: "#,##0.00" },
  { titulo: "Aceita novidades", valor: (c) => sn(c.accepts_marketing), largura: 16 },
  { titulo: "Cliente da loja desde", valor: (c) => c.store_customer_since, largura: 20 },
  { titulo: "Situação", valor: (c) => (c.active ? "Ativo" : "Inativo"), largura: 10 },
  { titulo: "Observações", valor: (c) => c.notes, largura: 40 },
];

const dataBr = (d: string | null | undefined) => {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

export const COLUNAS_CUPONS = (hoje: string): Coluna<Coupon>[] => [
  { titulo: "Código", valor: (c) => c.code, largura: 22 },
  { titulo: "Tipo", valor: (c) => (c.type === "percentage" ? "Percentual" : c.type === "absolute" ? "Valor fixo (R$)" : (c.type ?? "")), largura: 16 },
  { titulo: "Valor", valor: (c) => num(c.value == null ? null : String(c.value)), largura: 10, formato: "#,##0.00" },
  { titulo: "Situação", valor: (c) => SITUACAO_LABEL[situacaoDoCupom(c, hoje)], largura: 12 },
  { titulo: "Usos", valor: (c) => num(c.used == null ? null : String(c.used)), largura: 8 },
  { titulo: "Limite de usos", valor: (c) => (c.max_uses == null || c.max_uses === "" ? "Sem limite" : Number(c.max_uses)), largura: 14 },
  { titulo: "Válido de", valor: (c) => dataBr(c.start_date), largura: 12 },
  { titulo: "Válido até", valor: (c) => dataBr(c.end_date), largura: 12 },
  { titulo: "Pedido mínimo (R$)", valor: (c) => num(c.min_price == null ? null : String(c.min_price)), largura: 18, formato: "#,##0.00" },
  { titulo: "Só primeira compra", valor: (c) => sn(c.first_consumer_purchase ?? null), largura: 18 },
  { titulo: "Acumula com outros descontos", valor: (c) => sn(c.combines_with_other_discounts ?? null), largura: 26 },
];

export const COLUNAS_VENDAS: Coluna<ProdutoVendido>[] = [
  { titulo: "ID do produto", valor: (p) => p.product_id, largura: 14 },
  { titulo: "Produto", valor: (p) => p.nome, largura: 44 },
  { titulo: "Peças vendidas", valor: (p) => p.unidades, largura: 15 },
  { titulo: "Valor vendido (R$)", valor: (p) => p.valor, largura: 18, formato: "#,##0.00" },
  { titulo: "Pedidos", valor: (p) => p.pedidos, largura: 10 },
  { titulo: "Estoque atual", valor: (p) => p.estoque, largura: 14 },
  { titulo: "Custo unitário (R$)", valor: (p) => p.custo, largura: 18, formato: "#,##0.00" },
  { titulo: "Margem média (%)", valor: (p) => (p.custo !== null && p.unidades > 0 && p.valor > 0 ? Math.round(((p.valor / p.unidades - p.custo) / (p.valor / p.unidades)) * 1000) / 10 : null), largura: 16, formato: "0.0" },
];

export const COLUNAS_REPOSICAO: Coluna<LinhaReposicao>[] = [
  { titulo: "Situação", valor: (l) => (l.situacao === "esgotado" ? "Esgotado" : "Acabando"), largura: 12 },
  { titulo: "ID do produto", valor: (l) => l.product_id, largura: 14 },
  { titulo: "Produto", valor: (l) => l.produto, largura: 44 },
  { titulo: "Variação", valor: (l) => l.variacao, largura: 22 },
  { titulo: "SKU", valor: (l) => l.sku, largura: 18 },
  { titulo: "Estoque", valor: (l) => l.estoque, largura: 10 },
  { titulo: "Vendidas na janela", valor: (l) => l.vendidas, largura: 18 },
  { titulo: "Ritmo (un/dia)", valor: (l) => Math.round(l.ritmo * 100) / 100, largura: 14, formato: "0.00" },
  { titulo: "Dias restantes", valor: (l) => (l.diasRestantes === null ? "Esgotado" : Math.round(l.diasRestantes * 10) / 10), largura: 14 },
  { titulo: "Sugestão de reposição", valor: (l) => l.sugerido, largura: 20 },
  { titulo: "Publicado na loja", valor: (l) => sn(l.publicado), largura: 16 },
];
