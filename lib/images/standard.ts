/**
 * Padrão de imagem dos produtos (definido com os testes de `/imagens/teste`): a Nuvemshop guarda no máximo 1024 px no lado maior,
 * não serve WebP e recomprime o JPEG. Então: JPEG de qualidade alta, 1024×1024 (peça solta, 1:1) ou 820×1024 (modelo, 4:5).
 */
export type Tipo = "peca" | "modelo";
export type Enquadramento = "ajustar" | "cortar";

export const TAMANHO: Record<Tipo, { largura: number; altura: number }> = {
  peca: { largura: 1024, altura: 1024 },
  modelo: { largura: 820, altura: 1024 },
};
export const TIPO_LABEL: Record<Tipo, string> = { peca: "Peça solta (1:1)", modelo: "Modelo (4:5)" };
export const ENQUADRAMENTO_LABEL: Record<Enquadramento, string> = { ajustar: "Ajustar (margem e fundo)", cortar: "Cortar (preencher)" };
