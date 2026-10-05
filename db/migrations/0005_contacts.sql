-- Cadastro de contatos (clientes, fornecedores e outros), por loja. Contém dados pessoais (CPF, nascimento, telefone):
-- fica com RLS ligado e sem políticas, como as demais tabelas; o acesso é só pelo servidor, para admins.
CREATE TABLE contacts (
  id                 bigserial PRIMARY KEY,
  store_id           uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  external_id        bigint,                       -- ID no sistema de origem (planilha importada); serve para não duplicar uma reimportação
  code               integer,
  kind               text CHECK (kind IN ('cliente', 'fornecedor', 'contador', 'desenvolvedor', 'outro')),
  person_type        text NOT NULL DEFAULT 'fisica' CHECK (person_type IN ('fisica', 'juridica')),
  name               text NOT NULL,
  trade_name         text,
  document           text,                         -- CPF ou CNPJ, só dígitos
  state_registration text,                         -- IE (pessoa jurídica) ou RG
  ie_exempt          boolean NOT NULL DEFAULT false,
  email              text,
  phone              text,
  mobile             text,
  contact_person     text,
  zip                text,                         -- CEP, só dígitos
  street             text,
  number             text,
  complement         text,
  district           text,
  city               text,
  state              text CHECK (state IS NULL OR char_length(state) = 2),
  birth_date         date,
  gender             text,
  marital_status     text,
  profession         text,
  nationality        text,
  customer_since     date,
  active             boolean NOT NULL DEFAULT true,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX contacts_store_external_idx ON contacts (store_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX contacts_store_name_idx ON contacts (store_id, lower(name));
CREATE INDEX contacts_store_kind_idx ON contacts (store_id, kind);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
