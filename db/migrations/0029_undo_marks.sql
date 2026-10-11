-- Central de desfazer: marca quais registros do Histórico já foram desfeitos (o audit_log é só de inserção e não pode ser alterado).
-- A chave primária garante que o mesmo registro nunca seja desfeito duas vezes, nem com dois cliques ao mesmo tempo.
CREATE TABLE undo_marks (
  audit_id    bigint PRIMARY KEY,
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  undone_at   timestamptz NOT NULL DEFAULT now(),
  undone_by   text NOT NULL
);
CREATE INDEX undo_marks_store_idx ON undo_marks (store_id, undone_at DESC);
ALTER TABLE undo_marks ENABLE ROW LEVEL SECURITY;
