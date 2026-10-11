-- Relatório mensal por e-mail: enviado no dia 1º (ou até o dia 3, se o dia 1 falhar) com os números do mês anterior, para os mesmos
-- destinatários do resumo diário. `monthly_last_month` (AAAA-MM) guarda o último mês enviado, para não repetir.
ALTER TABLE digest_settings
  ADD COLUMN monthly_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN monthly_last_month    text,
  ADD COLUMN monthly_last_error    text,
  ADD COLUMN monthly_last_error_at timestamptz;
