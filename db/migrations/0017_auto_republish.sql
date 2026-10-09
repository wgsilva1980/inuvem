-- Republicar sozinho quando o estoque volta, só os produtos que a regra "sem estoque" despublicou (nunca os que você mantém fora da loja).
ALTER TABLE store_settings ADD COLUMN auto_republish_in_stock boolean NOT NULL DEFAULT false;

CREATE TABLE auto_unpublished (
  store_id         uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id       bigint NOT NULL,
  unpublished_at   timestamptz NOT NULL DEFAULT now(),
  keep_unpublished boolean NOT NULL DEFAULT false,   -- a pessoa pediu para este produto não voltar sozinho
  PRIMARY KEY (store_id, product_id)
);
ALTER TABLE auto_unpublished ENABLE ROW LEVEL SECURITY;
