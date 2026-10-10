-- Carrinhos abandonados: o painel lê os carrinhos da loja na hora (com nome e contato do cliente) e NÃO guarda esses dados.
-- Aqui fica só o controle de quem já foi contatado: o ID do carrinho, quando e por quem, e o cupom de recuperação gerado (se houve).
CREATE TABLE cart_contacts (
  store_id     uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  checkout_id  bigint NOT NULL,
  contacted_at timestamptz,                     -- null = só tem cupom gerado, ainda não marcado como contatado
  contacted_by text,
  coupon_code  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, checkout_id)
);
ALTER TABLE cart_contacts ENABLE ROW LEVEL SECURITY;
