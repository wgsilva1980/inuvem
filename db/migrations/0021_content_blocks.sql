-- Blocos de conteúdo reutilizáveis (tabela de medidas, política de troca, cuidados com a peça…) para aplicar em lote nas descrições dos produtos.
CREATE TABLE content_blocks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name       text NOT NULL,
  html       text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX content_blocks_name_uniq ON content_blocks (store_id, lower(name));
ALTER TABLE content_blocks ENABLE ROW LEVEL SECURITY;
