-- Alertas por e-mail: pedido pago, produto esgotado e sincronização falhando.
-- Os destinatários precisam ser administradores do painel (conferido ao salvar e de novo a cada envio).
CREATE TABLE alert_settings (
  store_id        uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  enabled         boolean NOT NULL DEFAULT false,
  recipients      text[]  NOT NULL DEFAULT '{}',
  on_paid_order   boolean NOT NULL DEFAULT true,
  on_out_of_stock boolean NOT NULL DEFAULT true,
  on_sync_failure boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);
ALTER TABLE alert_settings ENABLE ROW LEVEL SECURITY;

-- Cada alerta enviado (e o teste). `chave` identifica o fato: o id do pedido, o id do produto ou o dia da falha. O índice único
-- parcial impede avisar duas vezes o mesmo fato; quando o fato some (o estoque volta) `resolvido_em` é preenchido e um novo esgotamento avisa de novo.
CREATE TABLE alert_log (
  id           bigserial PRIMARY KEY,
  store_id     uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('pedido_pago', 'esgotado', 'sync_falhou', 'teste')),
  chave        text NOT NULL,
  titulo       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,
  enviados     integer NOT NULL DEFAULT 0,
  erro         text,
  suprimido    boolean NOT NULL DEFAULT false   -- passou do limite por hora e não foi enviado
);
CREATE UNIQUE INDEX alert_log_ativo_idx ON alert_log (store_id, kind, chave) WHERE resolvido_em IS NULL AND kind <> 'teste';
CREATE INDEX alert_log_store_idx ON alert_log (store_id, created_at DESC);
ALTER TABLE alert_log ENABLE ROW LEVEL SECURITY;
