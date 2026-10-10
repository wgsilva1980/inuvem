/** Pontos de partida para blocos: o lojista completa os "[preencher: …]" antes de aplicar (o painel não deixa aplicar com eles). */
export const MODELOS_BLOCO = {
  medidas: {
    rotulo: "Tabela de medidas",
    nome: "Tabela de medidas",
    html: '<h3>Tabela de medidas</h3><table><tbody><tr><th><p>Tamanho</p></th><th><p>Busto (cm)</p></th><th><p>Cintura (cm)</p></th><th><p>Quadril (cm)</p></th></tr><tr><td><p>PP</p></td><td><p>[preencher: medida]</p></td><td><p>[preencher: medida]</p></td><td><p>[preencher: medida]</p></td></tr><tr><td><p>P</p></td><td><p>[preencher: medida]</p></td><td><p>[preencher: medida]</p></td><td><p>[preencher: medida]</p></td></tr><tr><td><p>M</p></td><td><p>[preencher: medida]</p></td><td><p>[preencher: medida]</p></td><td><p>[preencher: medida]</p></td></tr><tr><td><p>G</p></td><td><p>[preencher: medida]</p></td><td><p>[preencher: medida]</p></td><td><p>[preencher: medida]</p></td></tr></tbody></table><p>Medidas do corpo, em centímetros. Em caso de dúvida, fale com a gente antes de comprar.</p>',
  },
  trocas: {
    rotulo: "Política de troca",
    nome: "Política de troca",
    html: "<h3>Trocas e devoluções</h3><p>[preencher: prazo para pedir a troca]</p><p>[preencher: condições da peça e quem paga o frete]</p><p>[preencher: como pedir a troca (canal de contato)]</p>",
  },
} as const;
export type ModeloBloco = keyof typeof MODELOS_BLOCO;
export const ehModeloBloco = (x: unknown): x is ModeloBloco => typeof x === "string" && x in MODELOS_BLOCO;
