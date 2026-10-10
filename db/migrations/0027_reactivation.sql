-- Reativação de clientes: quem já foi avisada (só o ID do cliente e quando; nenhum dado pessoal), para não insistir e para medir quantas voltaram a comprar.
CREATE TABLE reactivation_contacts (
  store_id      uuid   NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id   bigint NOT NULL,
  contacted_at  timestamptz NOT NULL DEFAULT now(),
  contacted_by  text,
  PRIMARY KEY (store_id, customer_id)
);
ALTER TABLE reactivation_contacts ENABLE ROW LEVEL SECURITY;
