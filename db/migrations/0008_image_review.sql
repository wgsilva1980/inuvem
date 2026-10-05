-- Revisão das fotos pelo Claude (visão): texto alternativo sugerido, nota de qualidade e problemas visuais.
-- A lista de fotos vem do espelho; aqui ficam só os resultados, por foto. Se o endereço da foto mudar, a revisão é refeita.
CREATE TABLE image_review (
  store_id        uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  image_id        bigint NOT NULL,
  product_id      bigint NOT NULL,
  src             text   NOT NULL,
  model           text,
  alt_pt          text,                         -- texto alternativo sugerido (ou editado por uma pessoa)
  alt_editado     boolean NOT NULL DEFAULT false,
  quality         smallint,                     -- 1 (inutilizável) a 5 (pronta para a loja)
  problems        text[] NOT NULL DEFAULT '{}', -- desfocada, escura, cortada, fundo_poluido...
  note            text,
  error           text,
  input_tokens    integer,
  output_tokens   integer,
  reviewed_at     timestamptz NOT NULL DEFAULT now(),
  alt_aplicado    text,                         -- o que foi enviado à loja
  alt_aplicado_at timestamptz,
  PRIMARY KEY (store_id, image_id)
);
CREATE INDEX image_review_product_idx ON image_review (store_id, product_id);
ALTER TABLE image_review ENABLE ROW LEVEL SECURITY;
