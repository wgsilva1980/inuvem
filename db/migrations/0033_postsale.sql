-- Pós-venda: quem já foi avisada depois de receber o pedido (só o ID do pedido e da cliente e quando; nenhum dado pessoal), para não insistir
-- e para medir quantas voltaram a comprar.
CREATE TABLE postsale_contacts (
  store_id      uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id      bigint NOT NULL,
  customer_id   bigint NOT NULL,
  contacted_at  timestamptz NOT NULL DEFAULT now(),
  contacted_by  text,
  PRIMARY KEY (store_id, order_id)
);
CREATE INDEX postsale_contacts_customer_idx ON postsale_contacts (store_id, customer_id, contacted_at DESC);
ALTER TABLE postsale_contacts ENABLE ROW LEVEL SECURITY;
