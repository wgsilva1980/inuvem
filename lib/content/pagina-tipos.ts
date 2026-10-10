/** Páginas que o painel ajuda a escrever. `dica` orienta o que informar; o Claude só usa o que vier em "fatos". */
export const TIPOS_PAGINA = {
  sobre: { rotulo: "Sobre nós", titulo: "Sobre nós", dica: "A história da loja, o que vende, para quem, o que a diferencia, onde fica ou como atende." },
  trocas: { rotulo: "Trocas e devoluções", titulo: "Trocas e devoluções", dica: "Prazo para pedir a troca, condições da peça, quem paga o frete, como pedir (canal de contato), prazo do reembolso." },
  entrega: { rotulo: "Entrega e prazos", titulo: "Entrega e prazos", dica: "Transportadoras, prazo de postagem, prazo médio por região, frete grátis (condição), rastreio, retirada." },
  como_comprar: { rotulo: "Como comprar", titulo: "Como comprar", dica: "Passo a passo da compra, formas de pagamento, parcelamento, segurança, cupom." },
  cuidados: { rotulo: "Cuidados com as peças", titulo: "Cuidados com as peças", dica: "Como lavar, secar e passar, o que evitar, como guardar." },
  contato: { rotulo: "Fale conosco", titulo: "Fale conosco", dica: "WhatsApp, e-mail, redes sociais, horário de atendimento, endereço." },
} as const;
export type TipoPagina = keyof typeof TIPOS_PAGINA;
export const ehTipoPagina = (x: unknown): x is TipoPagina => typeof x === "string" && x in TIPOS_PAGINA;

export const FATOS_MAX = 3000;
