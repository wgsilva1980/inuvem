-- Espelho dos pedidos da loja (só leitura) para os painéis de vendas. Sem dados pessoais do comprador: nem nome, e-mail, telefone ou endereço,
-- só o ID do cliente (que é zerado quando a Nuvemshop pede a remoção dos dados dele).
CREATE TABLE orders (
  store_id          uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  id                bigint NOT NULL,
  number            integer,
  created_at_remote timestamptz NOT NULL,
  total             numeric(14,2) NOT NULL DEFAULT 0,
  discount          numeric(14,2) NOT NULL DEFAULT 0,
  status            text,            -- open | closed | cancelled
  payment_status    text,            -- pending | authorized | paid | voided | refunded | abandoned
  shipping_status   text,
  customer_id       bigint,
  updated_at_remote timestamptz,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, id)
);
CREATE INDEX orders_store_created_idx ON orders (store_id, created_at_remote DESC);
CREATE INDEX orders_store_customer_idx ON orders (store_id, customer_id) WHERE customer_id IS NOT NULL;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE order_items (
  store_id       uuid    NOT NULL,
  order_id       bigint  NOT NULL,
  seq            integer NOT NULL,
  product_id     bigint,
  variant_id     bigint,
  name           text,
  quantity       integer NOT NULL DEFAULT 1,
  unit_price     numeric(14,2) NOT NULL DEFAULT 0,
  variant_values jsonb,            -- ex.: ["Azul", "P"], na ordem das propriedades do produto
  PRIMARY KEY (store_id, order_id, seq),
  FOREIGN KEY (store_id, order_id) REFERENCES orders (store_id, id) ON DELETE CASCADE
);
CREATE INDEX order_items_product_idx ON order_items (store_id, product_id);
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE store_settings ADD COLUMN orders_synced_at timestamptz;
