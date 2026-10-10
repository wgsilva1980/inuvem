-- Cashback por cupom: depois de uma compra paga, a loja pode dar à cliente um cupom de valor fixo para a próxima compra.
-- Nada é automático: o painel propõe, uma pessoa confirma. As regras ficam aqui; os cupons emitidos ficam em cashback_grants.
-- Nenhuma das duas tabelas guarda dados pessoais (a cliente é identificada só pelo pedido, que o espelho de pedidos já liga ao ID dela).
CREATE TABLE cashback_settings (
  store_id        uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  percent         numeric(5,2)  NOT NULL DEFAULT 5  CHECK (percent > 0 AND percent <= 30),
  min_order       numeric(10,2) NOT NULL DEFAULT 150 CHECK (min_order >= 0),   -- valor mínimo do pedido para ganhar
  min_purchase    numeric(10,2) NOT NULL DEFAULT 150 CHECK (min_purchase >= 0), -- compra mínima para usar o cupom
  max_value       numeric(10,2) NOT NULL DEFAULT 100 CHECK (max_value > 0),    -- teto de cada cupom
  valid_days      integer       NOT NULL DEFAULT 30  CHECK (valid_days BETWEEN 1 AND 365),
  wait_days       integer       NOT NULL DEFAULT 7   CHECK (wait_days BETWEEN 0 AND 60),  -- espera depois do pedido (troca/devolução)
  month_budget    numeric(10,2) NOT NULL DEFAULT 500 CHECK (month_budget >= 0), -- máximo em cupons emitidos por mês
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);
ALTER TABLE cashback_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE cashback_grants (
  store_id      uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id      bigint NOT NULL,
  order_number  integer,
  coupon_id     bigint,
  coupon_code   text   NOT NULL,
  value         numeric(10,2) NOT NULL,
  expires_on    date   NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  issued_by     text   NOT NULL,
  contacted_at  timestamptz,
  cancelled_at  timestamptz,
  PRIMARY KEY (store_id, order_id)
);
CREATE INDEX cashback_grants_issued_idx ON cashback_grants (store_id, issued_at DESC);
ALTER TABLE cashback_grants ENABLE ROW LEVEL SECURITY;
