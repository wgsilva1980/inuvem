-- Arquivo de menu por FTP (snipplets/navigation/hidden-menu-urls.tpl): a opção de enviar sozinho a cada mudança e o estado do que foi enviado
-- (conteúdo atual e anterior, para voltar atrás; erro da última tentativa; trava para dois envios não se cruzarem).
ALTER TABLE store_settings ADD COLUMN auto_menu_file boolean NOT NULL DEFAULT false;

CREATE TABLE menu_file_state (
  store_id         uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  content          text,
  previous_content text,
  sent_at          timestamptz,
  last_error       text,
  last_attempt_at  timestamptz,
  lock_until       timestamptz
);
ALTER TABLE menu_file_state ENABLE ROW LEVEL SECURITY;
