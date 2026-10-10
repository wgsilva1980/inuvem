-- Resumo diário por e-mail: o que precisa de ação hoje e as vendas de ontem, enviado de manhã para os administradores escolhidos.
-- Os destinatários precisam ser administradores do painel (conferido ao salvar e de novo a cada envio).
CREATE TABLE digest_settings (
  store_id          uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  enabled           boolean NOT NULL DEFAULT false,
  recipients        text[]  NOT NULL DEFAULT '{}',
  only_if_action    boolean NOT NULL DEFAULT false,   -- só envia quando há algo urgente ou de atenção
  last_sent_on      date,                              -- dia (Brasília) do último envio automático: evita mandar duas vezes no mesmo dia
  last_error        text,
  last_error_at     timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text
);
ALTER TABLE digest_settings ENABLE ROW LEVEL SECURITY;
