-- Reescritas de e-mails da loja feitas com a IA (a Nuvemshop só deixa LER os modelos pela API: o texto novo é copiado para a loja à mão).
CREATE TABLE email_suggestion (
  store_id         uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  key              text NOT NULL,
  label            text NOT NULL,
  original_subject text NOT NULL DEFAULT '',
  original_body    text NOT NULL DEFAULT '',
  subject          text,
  body             text,
  warning          text,
  error            text,
  edited           boolean NOT NULL DEFAULT false,
  model            text,
  input_tokens     integer,
  output_tokens    integer,
  generated_at     timestamptz NOT NULL DEFAULT now(),
  applied_at       timestamptz,
  PRIMARY KEY (store_id, key)
);
ALTER TABLE email_suggestion ENABLE ROW LEVEL SECURITY;
