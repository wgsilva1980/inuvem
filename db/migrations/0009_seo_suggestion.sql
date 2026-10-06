-- Sugestões de SEO (título e descrição) geradas pelo Claude, uma por produto. A lista de produtos vem do espelho;
-- aqui ficam a sugestão, o que foi gravado na loja e o uso de tokens.
CREATE TABLE seo_suggestion (
  store_id            uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id          bigint NOT NULL,
  title               text,                         -- título completo, já com o nome da loja (até 70 caracteres)
  description         text,                         -- até 320 caracteres
  edited              boolean NOT NULL DEFAULT false, -- editado por uma pessoa na tela
  model               text,
  warning             text,                         -- aviso para a pessoa conferir (ex.: o texto ainda cita a modelo)
  error               text,
  input_tokens        integer,
  output_tokens       integer,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  applied_title       text,                         -- o que foi enviado à loja
  applied_description text,
  applied_at          timestamptz,
  PRIMARY KEY (store_id, product_id)
);
ALTER TABLE seo_suggestion ENABLE ROW LEVEL SECURITY;
