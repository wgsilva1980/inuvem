-- Selos na vitrine (últimas unidades, contagem regressiva da promoção, botão de WhatsApp). Uma linha por loja; sem linha = tudo desligado.
CREATE TABLE badge_settings (
  store_id           uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  enabled            boolean NOT NULL DEFAULT false,
  low_stock_enabled  boolean NOT NULL DEFAULT true,
  low_stock_max      integer NOT NULL DEFAULT 3 CHECK (low_stock_max BETWEEN 1 AND 20),
  countdown_enabled  boolean NOT NULL DEFAULT true,
  whatsapp_enabled   boolean NOT NULL DEFAULT false,
  whatsapp_number    text,
  whatsapp_message   text NOT NULL DEFAULT 'Olá! Tenho interesse em {produto}.',
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text
);
ALTER TABLE badge_settings ENABLE ROW LEVEL SECURITY;
