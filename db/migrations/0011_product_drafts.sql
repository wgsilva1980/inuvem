-- Rascunhos de cadastro de produto: o que a pessoa já preencheu (campos, anotações, análise da IA) e as fotos (no Vercel Blob, privado),
-- para continuar depois. Ao criar o produto na loja o rascunho vira 'criado' e guarda o ID do produto.
CREATE TABLE product_drafts (
  id          bigserial PRIMARY KEY,
  store_id    uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_by  text   NOT NULL,
  title       text   NOT NULL DEFAULT '',
  notes       text   NOT NULL DEFAULT '',
  form        jsonb  NOT NULL DEFAULT '{}'::jsonb,   -- campos do formulário de novo produto
  ai          jsonb,                                  -- última análise da IA (avisos, texto alternativo, notas das fotos)
  photos      jsonb  NOT NULL DEFAULT '[]'::jsonb,   -- [{pathname, name, content_type, bytes}]
  status      text   NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'criado')),
  product_id  bigint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_drafts_store_idx ON product_drafts (store_id, status, updated_at DESC);
ALTER TABLE product_drafts ENABLE ROW LEVEL SECURITY;
