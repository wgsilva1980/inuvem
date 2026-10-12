-- Automação "categoria sem produto publicado fica oculta": a opção por loja e a lista das categorias que ELA ocultou (só essas podem voltar sozinhas;
-- uma categoria que a pessoa ocultou à mão nunca é reexibida pela regra).
ALTER TABLE store_settings ADD COLUMN auto_hide_empty_categories boolean NOT NULL DEFAULT false;

CREATE TABLE auto_hidden_categories (
  store_id    uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id bigint NOT NULL,
  hidden_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, category_id)
);
ALTER TABLE auto_hidden_categories ENABLE ROW LEVEL SECURITY;
