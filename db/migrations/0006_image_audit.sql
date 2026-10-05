-- Medidas das imagens dos produtos (largura, altura, peso, formato), tiradas baixando a imagem da loja.
-- Serve à auditoria de padronização (/imagens). A lista de imagens vem do espelho; aqui só ficam as medidas, por imagem.
CREATE TABLE image_audit (
  store_id   uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  image_id   bigint NOT NULL,
  src        text   NOT NULL,                 -- endereço medido: se a imagem mudar, a medida fica velha e é refeita
  width      integer,
  height     integer,
  bytes      integer,
  format     text,
  error      text,                            -- preenchido quando não foi possível medir
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, image_id)
);

ALTER TABLE image_audit ENABLE ROW LEVEL SECURITY;
