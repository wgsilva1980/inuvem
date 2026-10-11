-- Vigia das integrações: guarda o resultado da última verificação de cada item (para a tela e para só avisar quando o problema começa) e um novo
-- tipo de alerta por e-mail, "integracao".
CREATE TABLE integration_checks (
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  check_id    text NOT NULL,
  status      text NOT NULL CHECK (status IN ('ok', 'aviso', 'erro', 'inativo')),
  detail      text NOT NULL DEFAULT '',
  checked_at  timestamptz NOT NULL DEFAULT now(),
  since       timestamptz NOT NULL DEFAULT now(),   -- desde quando está neste status
  PRIMARY KEY (store_id, check_id)
);
ALTER TABLE integration_checks ENABLE ROW LEVEL SECURITY;

ALTER TABLE alert_log DROP CONSTRAINT alert_log_kind_check;
ALTER TABLE alert_log ADD CONSTRAINT alert_log_kind_check CHECK (kind IN ('pedido_pago', 'esgotado', 'sync_falhou', 'teste', 'integracao'));
ALTER TABLE alert_settings ADD COLUMN on_integrations boolean NOT NULL DEFAULT true;
