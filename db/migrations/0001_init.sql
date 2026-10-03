-- INuvem: schema inicial.
-- Autorização é feita no servidor (admins + sessão Neon Auth). RLS fica ligado em todas as
-- tabelas, sem políticas: qualquer role que não seja a dona (ex.: Data API) não enxerga nada.

CREATE TABLE stores (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nuvemshop_store_id     bigint NOT NULL UNIQUE,
  name                   text,
  url                    text,
  access_token_encrypted text NOT NULL,
  scope                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admins (
  email      text PRIMARY KEY CHECK (email = lower(email)),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  store_id   uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  id         bigint NOT NULL,
  parent_id  bigint,
  name       text   NOT NULL,
  handle     text,
  raw_json   jsonb  NOT NULL,
  synced_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, id)
);
CREATE INDEX categories_parent_idx ON categories (store_id, parent_id);

CREATE TABLE products (
  store_id          uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  id                bigint NOT NULL,
  name              text   NOT NULL,
  description       text,
  handle            text,
  published         boolean NOT NULL DEFAULT false,
  categories        jsonb  NOT NULL DEFAULT '[]'::jsonb,   -- [{id, name}]
  tags              text,
  image_count       integer NOT NULL DEFAULT 0,
  raw_json          jsonb  NOT NULL,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  updated_at_remote timestamptz,
  PRIMARY KEY (store_id, id)
);
CREATE INDEX products_store_updated_idx ON products (store_id, updated_at_remote DESC);
CREATE INDEX products_store_published_idx ON products (store_id, published);
CREATE INDEX products_store_name_idx ON products (store_id, lower(name));
CREATE INDEX products_categories_gin ON products USING gin (categories jsonb_path_ops);

CREATE TABLE variants (
  store_id          uuid   NOT NULL,
  id                bigint NOT NULL,
  product_id        bigint NOT NULL,
  sku               text,
  price             numeric(12,2),
  promotional_price numeric(12,2),
  stock             integer,
  stock_management  boolean NOT NULL DEFAULT false,
  weight            numeric(12,3),
  width             numeric(12,2),
  height            numeric(12,2),
  depth             numeric(12,2),
  values            jsonb  NOT NULL DEFAULT '[]'::jsonb,   -- atributos (ex.: cor, tamanho)
  position          integer,
  raw_json          jsonb  NOT NULL,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, id),
  FOREIGN KEY (store_id, product_id) REFERENCES products (store_id, id) ON DELETE CASCADE
);
CREATE INDEX variants_store_sku_idx ON variants (store_id, sku);
CREATE INDEX variants_product_idx ON variants (store_id, product_id);

CREATE TABLE sync_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('full', 'incremental', 'webhook')),
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  cursor      jsonb NOT NULL DEFAULT '{}'::jsonb,          -- {page, per_page, updated_at_min}
  totais      jsonb NOT NULL DEFAULT '{}'::jsonb,          -- {products, variants, pages}
  erros       jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX sync_runs_store_started_idx ON sync_runs (store_id, started_at DESC);
-- no máximo uma sincronização full/incremental em andamento por loja
CREATE UNIQUE INDEX sync_runs_one_running_idx ON sync_runs (store_id) WHERE status = 'running' AND tipo <> 'webhook';

CREATE TABLE webhook_events (
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  event_key   text NOT NULL,                               -- hash de evento+id+corpo (idempotência)
  event       text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, event_key)
);

CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  actor_email   text NOT NULL,
  acao          text NOT NULL,
  entidade      text NOT NULL,
  entidade_id   text,
  antes         jsonb,
  depois        jsonb,
  resultado_api jsonb,
  sucesso       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_store_created_idx ON audit_log (store_id, created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (store_id, entidade, entidade_id);

-- audit_log é append-only
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log é somente de inserção';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

ALTER TABLE stores         ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins         ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE variants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log      ENABLE ROW LEVEL SECURITY;
