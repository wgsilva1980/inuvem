-- Categorias que a pessoa mostrou à mão: a automação "categoria sem produto publicado fica oculta" não as oculta (até a pessoa devolvê-las à automação).
CREATE TABLE category_rule_exceptions (
  store_id    uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, category_id)
);
ALTER TABLE category_rule_exceptions ENABLE ROW LEVEL SECURITY;
