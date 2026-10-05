-- Cópia de cada foto antes de ser substituída pela versão padronizada (arquivo no Vercel Blob, privado).
-- Permite desfazer: a cópia volta para a loja no lugar da foto padronizada.
CREATE TABLE image_backup (
  id             bigserial PRIMARY KEY,
  store_id       uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id     bigint NOT NULL,
  old_image_id   bigint NOT NULL,            -- foto que foi substituída (apagada na loja)
  new_image_id   bigint,                     -- foto padronizada que a substituiu (muda se for desfeito)
  blob_pathname  text   NOT NULL,            -- onde está a cópia no Blob
  content_type   text   NOT NULL DEFAULT 'image/jpeg',
  width          integer,
  height         integer,
  bytes          integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  restored_at    timestamptz                 -- preenchido quando foi desfeito
);
CREATE INDEX image_backup_product_idx ON image_backup (store_id, product_id);
ALTER TABLE image_backup ENABLE ROW LEVEL SECURITY;
