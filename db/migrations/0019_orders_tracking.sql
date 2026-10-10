-- Código de rastreio do pedido (lido da loja ou informado pelo painel ao marcar como enviado). Não é dado pessoal.
ALTER TABLE orders ADD COLUMN tracking_code text;
