-- Vendas por produto (resumo lido dos pedidos pagos da loja) para achar os produtos parados, e desconto por produto nas promoções.
CREATE TABLE product_sales (
  store_id     uuid    NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id   bigint  NOT NULL,
  units        integer NOT NULL DEFAULT 0,        -- unidades vendidas na janela
  orders       integer NOT NULL DEFAULT 0,        -- pedidos com o produto na janela
  last_sold_at timestamptz,
  run_id       uuid    NOT NULL,                  -- leitura em que esta linha foi calculada (as de leituras antigas são removidas no fim)
  PRIMARY KEY (store_id, product_id)
);
ALTER TABLE product_sales ENABLE ROW LEVEL SECURITY;

ALTER TABLE store_settings ADD COLUMN sales_run_id uuid;
ALTER TABLE store_settings ADD COLUMN sales_run_page integer;      -- última página já gravada na leitura em andamento (evita contar duas vezes)
ALTER TABLE store_settings ADD COLUMN sales_synced_at timestamptz;
ALTER TABLE store_settings ADD COLUMN sales_window_days integer;

-- {"<id do produto>": percentual}: desconto próprio de cada produto (a liquidação). Sem isso vale o percentual da operação para todos.
ALTER TABLE promotions ADD COLUMN percents jsonb;
