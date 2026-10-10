/** Tipos de e-mail que dá para colar à mão (quando a loja não entrega os modelos pela API). */
export const TIPOS_MANUAIS = {
  pedido_recebido: "Pedido recebido",
  pagamento_confirmado: "Pagamento confirmado",
  pedido_enviado: "Pedido enviado",
  carrinho_abandonado: "Carrinho abandonado",
  outro: "Outro e-mail",
} as const;
export type TipoManual = keyof typeof TIPOS_MANUAIS;
export const ehTipoManual = (x: unknown): x is TipoManual => typeof x === "string" && x in TIPOS_MANUAIS;
export const EMAIL_CORPO_MAX = 30000;
