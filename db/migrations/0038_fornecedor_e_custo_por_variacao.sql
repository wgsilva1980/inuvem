-- Preço de custo por variação (cópia do painel; também é enviado ao campo "cost" da variação na Nuvemshop) e fornecedor único do produto
-- (escolhido entre os contatos do tipo "fornecedor"; a Nuvemshop não tem esse campo, então fica só no painel).
CREATE TABLE variant_costs (
  store_id    uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id  bigint NOT NULL,
  product_id  bigint NOT NULL,
  cost        numeric(12,2) NOT NULL CHECK (cost >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (store_id, variant_id)
);
CREATE INDEX variant_costs_product_idx ON variant_costs (store_id, product_id);
ALTER TABLE variant_costs ENABLE ROW LEVEL SECURITY;

CREATE TABLE product_suppliers (
  store_id    uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id  bigint NOT NULL,
  contact_id  bigint NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (store_id, product_id)
);
CREATE INDEX product_suppliers_contact_idx ON product_suppliers (contact_id);
ALTER TABLE product_suppliers ENABLE ROW LEVEL SECURITY;

-- Os custos que a loja já guarda nas variações passam a valer também no painel.
INSERT INTO variant_costs (store_id, variant_id, product_id, cost, updated_by)
SELECT v.store_id, v.id, v.product_id, (v.raw_json->>'cost')::numeric, 'importado da loja'
FROM variants v
WHERE coalesce(v.raw_json->>'cost', '') ~ '^[0-9]+(\.[0-9]+)?$' AND (v.raw_json->>'cost')::numeric > 0
ON CONFLICT DO NOTHING;
