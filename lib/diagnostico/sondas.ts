import type { Esperado } from "./campos";

/** Uma leitura de teste: um pedido GET, de poucos itens, e os campos que o painel espera encontrar. */
export interface Sonda {
  id: string;
  titulo: string;
  caminho: string;
  /** "objeto": a resposta é um objeto só (ex.: /store). "lista": uma lista de itens. */
  forma: "objeto" | "lista";
  /** Funcionalidades do painel que dependem desta leitura. */
  usadoPor: string;
  esperados: Esperado[];
}

const o = (caminho: string, uso: string): Esperado => ({ caminho, obrigatorio: true, uso });
const q = (caminho: string, uso: string): Esperado => ({ caminho, obrigatorio: false, uso });

export const SONDAS: Sonda[] = [
  {
    id: "loja",
    titulo: "Loja",
    caminho: "/store",
    forma: "objeto",
    usadoPor: "Conexão e nome da loja",
    esperados: [o("id", "identificar a loja"), o("name", "nome da loja"), q("url_with_protocol|original_domain|business_name", "endereço da loja")],
  },
  {
    id: "produtos",
    titulo: "Produtos",
    caminho: "/products",
    forma: "lista",
    usadoPor: "Catálogo, lotes, SEO, selos, estoque",
    esperados: [
      o("id", "identificar o produto"),
      o("name", "nome"),
      o("published", "publicado ou não"),
      q("handle", "endereço do produto (selos na vitrine)"),
      q("description", "descrição (blocos de conteúdo)"),
      o("categories[].id", "categorias"),
      q("images[].src", "fotos"),
      o("variants[].id", "variações"),
      o("variants[].price", "preço"),
      q("variants[].promotional_price", "preço promocional"),
      q("variants[].stock", "estoque"),
      q("variants[].stock_management", "controle de estoque"),
      q("variants[].sku", "SKU"),
      q("variants[].cost", "custo que a loja já guarda (tela Custos, “Trazer custos que a loja já tem”)"),
      o("variants[].values", "valores da variação (cor, tamanho)"),
      q("attributes", "nomes das propriedades"),
    ],
  },
  {
    id: "categorias",
    titulo: "Categorias",
    caminho: "/categories",
    forma: "lista",
    usadoPor: "Categorias, SEO de categorias",
    esperados: [o("id", "identificar a categoria"), o("name", "nome"), o("handle", "endereço"), q("parent", "categoria pai"), q("description", "descrição")],
  },
  {
    id: "pedidos",
    titulo: "Pedidos",
    caminho: "/orders",
    forma: "lista",
    usadoPor: "Vendas, estoque inteligente, expedição, cashback, risco, painel do dia",
    esperados: [
      o("id", "identificar o pedido"),
      q("number", "número do pedido"),
      o("created_at", "data"),
      o("total", "valor"),
      q("discount", "desconto"),
      o("status", "aberto, fechado ou cancelado"),
      o("payment_status", "pago ou não"),
      o("shipping_status", "fila de expedição"),
      o("customer.id", "ligar pedidos da mesma cliente (segmentos, risco, cashback)"),
      q("customer.name", "nome na mensagem do cashback"),
      q("customer.phone", "WhatsApp no cashback"),
      q("customer.email", "e-mail no cashback"),
      o("products[].product_id", "produto vendido"),
      o("products[].variant_id", "variação vendida"),
      o("products[].quantity", "quantidade"),
      o("products[].price", "preço"),
      q("products[].variant_values", "cor e tamanho vendidos"),
      q("shipping_tracking_number", "código de rastreio"),
    ],
  },
  {
    id: "clientes",
    titulo: "Clientes",
    caminho: "/customers",
    forma: "lista",
    usadoPor: "Contatos e segmentos",
    esperados: [
      o("id", "identificar a cliente"),
      o("name", "nome"),
      q("email", "e-mail"),
      q("phone", "telefone"),
      q("identification", "CPF/CNPJ"),
      q("default_address", "endereço"),
      q("total_spent", "total gasto"),
      q("accepts_marketing", "aceita novidades"),
      q("created_at", "cliente desde"),
    ],
  },
  {
    id: "cupons",
    titulo: "Cupons",
    caminho: "/coupons",
    forma: "lista",
    usadoPor: "Cupons em lote, carrinhos, cashback",
    esperados: [
      o("id", "identificar o cupom"),
      o("code", "código"),
      o("type", "percentual ou valor"),
      o("value", "valor"),
      q("valid", "ativo"),
      q("used", "usos (custo real do cashback)"),
      q("max_uses", "limite de usos"),
      q("start_date", "início"),
      q("end_date", "fim"),
      q("min_price", "compra mínima"),
      q("first_consumer_purchase", "primeira compra"),
      q("combines_with_other_discounts", "soma com outros descontos"),
    ],
  },
  {
    id: "paginas",
    titulo: "Páginas da loja",
    caminho: "/pages",
    forma: "lista",
    usadoPor: "SEO de páginas, páginas escritas pela IA",
    esperados: [o("id", "identificar a página"), o("title", "título"), q("content", "conteúdo"), q("handle", "endereço"), q("publish", "publicada ou não")],
  },
  {
    id: "carrinhos",
    titulo: "Carrinhos abandonados",
    caminho: "/checkouts",
    forma: "lista",
    usadoPor: "Carrinhos abandonados",
    esperados: [
      o("id", "identificar o carrinho"),
      o("created_at", "há quanto tempo está parado"),
      q("contact_name", "nome na mensagem"),
      q("contact_email", "e-mail"),
      q("contact_phone", "WhatsApp"),
      q("products[].name", "peças do carrinho"),
      q("products[].quantity", "quantidade"),
      q("products[].price", "preço"),
      q("total", "valor"),
      q("abandoned_checkout_url", "link para voltar ao carrinho"),
      q("completed_at", "carrinho concluído"),
    ],
  },
  {
    id: "emails",
    titulo: "Modelos de e-mail",
    caminho: "/email_templates",
    forma: "lista",
    usadoPor: "E-mails da loja reescritos com a IA",
    esperados: [o("id|type|key|slug", "identificar o modelo"), q("name|title|type|event|key|slug", "nome do modelo"), q("subject|asunto|email_subject", "assunto"), o("body|content|html|html_content|message|text|template_html", "corpo do e-mail")],
  },
];

/** Permissões (scopes) que cada funcionalidade exige. "write_x" também vale como "read_x". Os nomes são os usados pela Nuvemshop. */
export interface ExigenciaEscopo {
  funcionalidade: string;
  exige: string[];
}

export const EXIGENCIAS: ExigenciaEscopo[] = [
  { funcionalidade: "Ler produtos e categorias", exige: ["read_products"] },
  { funcionalidade: "Gravar produtos e categorias (lotes, SEO, imagens, cadastro)", exige: ["write_products"] },
  { funcionalidade: "Ler pedidos (vendas, estoque, expedição, cashback)", exige: ["read_orders"] },
  { funcionalidade: "Marcar pedidos como enviados (expedição)", exige: ["write_orders"] },
  { funcionalidade: "Ler clientes (contatos e segmentos)", exige: ["read_customers"] },
  { funcionalidade: "Ler cupons", exige: ["read_coupons"] },
  { funcionalidade: "Criar e desativar cupons (lote, carrinhos, cashback)", exige: ["write_coupons"] },
  { funcionalidade: "Ler páginas da loja (SEO de páginas)", exige: ["read_content"] },
  { funcionalidade: "Criar e editar páginas da loja", exige: ["write_content"] },
];

/** O escopo exigido está entre os concedidos? "write_x" cobre "read_x". */
export function escopoConcedido(concedidos: string[], exigido: string): boolean {
  if (concedidos.includes(exigido)) return true;
  return exigido.startsWith("read_") && concedidos.includes(`write_${exigido.slice(5)}`);
}
