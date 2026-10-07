import type { LinhaProduto } from "@/lib/catalog/export";
import type { Contact } from "@/lib/contacts/repo";
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

export const COLUNAS_CONTATOS: Coluna<Contact>[] = [
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
  { titulo: "Situação", valor: (c) => (c.active ? "Ativo" : "Inativo"), largura: 10 },
  { titulo: "Observações", valor: (c) => c.notes, largura: 40 },
];
