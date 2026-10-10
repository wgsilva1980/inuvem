-- Custo de cada produto (para margem), guardado no painel: a Nuvemshop não é a fonte da verdade do custo.
-- `source` diz de onde veio o valor: digitado, planilha ou lido da própria loja (campo de custo das variações, se a loja tiver).
CREATE TABLE product_costs (
  store_id    uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id  bigint NOT NULL,
  cost        numeric(12,2) NOT NULL CHECK (cost >= 0),
  source      text   NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'planilha', 'loja')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (store_id, product_id)
);
ALTER TABLE product_costs ENABLE ROW LEVEL SECURITY;

-- Margem mínima desejada sobre o preço de venda (0 = só nunca vender abaixo do custo).
CREATE TABLE cost_settings (
  store_id    uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  min_margin  numeric(5,2) NOT NULL DEFAULT 0 CHECK (min_margin >= 0 AND min_margin < 100),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
ALTER TABLE cost_settings ENABLE ROW LEVEL SECURITY;
