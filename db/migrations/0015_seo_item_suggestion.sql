-- Sugestões de SEO (título e descrição) para categorias e páginas da loja, como seo_suggestion faz para produtos.
CREATE TABLE seo_item_suggestion (
  store_id            uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind                text   NOT NULL CHECK (kind IN ('categoria', 'pagina')),
  item_id             bigint NOT NULL,
  title               text,                         -- título completo, já com o nome da loja (até 70 caracteres)
  description         text,                         -- até 320 caracteres
  edited              boolean NOT NULL DEFAULT false,
  model               text,
  warning             text,
  error               text,
  input_tokens        integer,
  output_tokens       integer,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  applied_title       text,
  applied_description text,
  applied_at          timestamptz,
  PRIMARY KEY (store_id, kind, item_id)
);
ALTER TABLE seo_item_suggestion ENABLE ROW LEVEL SECURITY;
