-- Configurações por loja do painel (regras automáticas). Uma linha por loja; sem linha = tudo desligado.
CREATE TABLE store_settings (
  store_id                    uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  -- Quando chega um evento de produto e TODAS as variações estão com estoque controlado e zerado, despublica o produto na loja.
  auto_unpublish_out_of_stock boolean NOT NULL DEFAULT false,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text
);
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;
