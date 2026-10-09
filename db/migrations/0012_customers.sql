-- Clientes da loja Nuvemshop (espelho só de leitura) e o vínculo com a tela de Contatos.
-- Só as colunas necessárias (sem o JSON bruto): contém dados pessoais, então fica com RLS ligado e sem políticas, como contacts.
CREATE TABLE customers (
  store_id          uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  id                bigint NOT NULL,
  name              text   NOT NULL,
  email             text,
  phone             text,
  document          text,                       -- CPF/CNPJ, só dígitos
  zip               text,
  city              text,
  state             text,
  total_spent       numeric(14,2) NOT NULL DEFAULT 0,
  last_order_id     bigint,
  accepts_marketing boolean,
  created_at_remote timestamptz,
  updated_at_remote timestamptz,
  ignored           boolean NOT NULL DEFAULT false,   -- o contato ligado foi apagado no painel: a sincronização não o recria
  synced_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, id)
);
CREATE INDEX customers_store_spent_idx ON customers (store_id, total_spent DESC);
CREATE INDEX customers_store_created_idx ON customers (store_id, created_at_remote DESC);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

ALTER TABLE contacts ADD COLUMN nuvemshop_customer_id bigint;
CREATE UNIQUE INDEX contacts_store_customer_idx ON contacts (store_id, nuvemshop_customer_id) WHERE nuvemshop_customer_id IS NOT NULL;

ALTER TABLE store_settings ADD COLUMN customers_synced_at timestamptz;
