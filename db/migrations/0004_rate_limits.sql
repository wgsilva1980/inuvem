-- Limite de tentativas em endpoints públicos (hoje: pedido de link de acesso por e-mail), com janela fixa por chave.
CREATE TABLE rate_limits (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  hits         integer NOT NULL DEFAULT 0
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
