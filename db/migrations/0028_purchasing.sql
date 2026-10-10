-- Compras e reposição: pedidos de compra feitos a fornecedores. Servem para o painel descontar do que se precisa comprar o que já está a caminho,
-- e para somar ao estoque da loja quando a mercadoria chega. Nenhum dado pessoal (só o nome do fornecedor, que o lojista digita).
CREATE TABLE purchase_orders (
  id            bigserial PRIMARY KEY,
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supplier      text NOT NULL,
  expected_on   date,
  note          text,
  status        text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'recebido', 'cancelado')),
  stock_updated boolean NOT NULL DEFAULT false,   -- a chegada foi somada ao estoque da loja pelo painel
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  closed_at     timestamptz,
  closed_by     text
);
CREATE INDEX purchase_orders_store_status_idx ON purchase_orders (store_id, status, created_at DESC);
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE purchase_order_items (
  order_id      bigint  NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  seq           integer NOT NULL,
  product_id    bigint  NOT NULL,
  variant_id    bigint  NOT NULL,
  product_name  text    NOT NULL,
  variation     text    NOT NULL DEFAULT '',
  sku           text,
  qty           integer NOT NULL CHECK (qty > 0),
  unit_cost     numeric(12,2),                    -- custo do produto no momento do pedido (pode faltar)
  received_at   timestamptz,                      -- quando esta linha foi somada ao estoque da loja
  PRIMARY KEY (order_id, seq)
);
CREATE INDEX purchase_order_items_variant_idx ON purchase_order_items (variant_id);
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
