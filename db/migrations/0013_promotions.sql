-- Promoções agendadas: aplicam um desconto (preço promocional) numa lista de produtos no início e desfazem no fim.
-- Quem aplica e desfaz é o motor de lotes (bulk_jobs): a promoção guarda só a agenda e aponta para os dois lotes.
CREATE TABLE promotions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  operation     jsonb NOT NULL,                  -- {type:'promocao', mode:'desconto', percent, rounding}
  product_ids   bigint[] NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'agendada' CHECK (status IN ('agendada', 'aplicando', 'ativa', 'encerrando', 'encerrada', 'cancelada')),
  apply_job_id  uuid REFERENCES bulk_jobs(id) ON DELETE SET NULL,
  revert_job_id uuid REFERENCES bulk_jobs(id) ON DELETE SET NULL,
  nota          text,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  ended_at      timestamptz,
  CHECK (ends_at > starts_at)
);
CREATE INDEX promotions_store_status_idx ON promotions (store_id, status, starts_at);
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
