/** Preço por milhão de tokens, só para estimar o custo na tela (sem dependências: roda também no navegador). */
const PRECO_ENTRADA = 4;
const PRECO_SAIDA = 20;
export const estimarCustoUsd = (entrada: number, saida: number) => (entrada * PRECO_ENTRADA + saida * PRECO_SAIDA) / 1_000_000;
