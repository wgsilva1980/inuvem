-- Operações em massa (Fase 4): um lote (job) guarda a operação, a pré-visualização (um item por produto,
-- com antes/depois de cada alteração) e, depois de aplicado, o resultado por produto. É o que permite
-- confirmar antes de aplicar, retomar em lotes curtos e reverter.

CREATE TABLE bulk_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  actor_email      text NOT NULL,
  operation        jsonb NOT NULL,
  descricao        text NOT NULL,
  status           text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'running', 'completed', 'cancelled')),
  reverts_job_id   uuid REFERENCES bulk_jobs(id) ON DELETE SET NULL,
  ignorados        jsonb NOT NULL DEFAULT '[]'::jsonb,       -- o que ficou de fora da pré-visualização, com o motivo
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz
);
CREATE INDEX bulk_jobs_store_created_idx ON bulk_jobs (store_id, created_at DESC);
-- no máximo um lote em execução por loja (evita dois lotes escrevendo na mesma loja ao mesmo tempo)
CREATE UNIQUE INDEX bulk_jobs_one_running_idx ON bulk_jobs (store_id) WHERE status = 'running';
-- um lote só pode ser revertido uma vez
CREATE UNIQUE INDEX bulk_jobs_one_revert_idx ON bulk_jobs (reverts_job_id) WHERE reverts_job_id IS NOT NULL;

CREATE TABLE bulk_job_items (
  job_id        uuid NOT NULL REFERENCES bulk_jobs(id) ON DELETE CASCADE,
  seq           integer NOT NULL,
  product_id    bigint NOT NULL,
  product_name  text NOT NULL,
  changes       jsonb NOT NULL,                              -- {product?: {...}, variants: [{id, ..., campo: {antes, depois}}]}
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ok', 'error', 'conflict')),
  resultado     jsonb,                                       -- por parte aplicada: {partes: [{tipo, id, ok, erro?}], mensagem?}
  claimed_at    timestamptz,
  executed_at   timestamptz,
  PRIMARY KEY (job_id, seq)
);
CREATE INDEX bulk_job_items_pending_idx ON bulk_job_items (job_id, status);

ALTER TABLE bulk_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_job_items ENABLE ROW LEVEL SECURITY;
