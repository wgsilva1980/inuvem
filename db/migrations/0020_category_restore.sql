-- Dados originais de categorias a restaurar na loja (nome, endereço, descrição e categoria pai), preenchidos a partir de um backup.
-- Existe porque um erro anterior do painel apagou esses campos na loja; o botão "Restaurar categorias" em /categorias lê esta tabela.
CREATE TABLE category_restore (
  store_id     uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id  bigint NOT NULL,
  name         text   NOT NULL,
  handle       text,
  description  text,
  parent_id    bigint,
  restored_at  timestamptz,
  PRIMARY KEY (store_id, category_id)
);
ALTER TABLE category_restore ENABLE ROW LEVEL SECURITY;
