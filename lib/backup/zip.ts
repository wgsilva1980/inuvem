import { crc32, deflateRawSync } from "node:zlib";

export interface ArquivoZip {
  nome: string;
  conteudo: Buffer | string;
}

/** Data e hora no formato do ZIP (MS-DOS). */
function dataDos(d: Date): { hora: number; data: number } {
  const ano = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return { hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), data: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/**
 * Monta um arquivo .zip simples (deflate, nomes em UTF-8), sem depender de biblioteca. Serve para os poucos arquivos do backup;
 * não faz ZIP64 (limite de 65 mil arquivos e 4 GB), o que está muito acima do uso.
 */
export function montarZip(arquivos: ArquivoZip[], agora: Date = new Date()): Buffer {
  if (arquivos.length > 60_000) throw new Error("arquivos demais para o ZIP");
  const { hora, data } = dataDos(agora);
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, "utf8");
    const bruto = Buffer.isBuffer(a.conteudo) ? a.conteudo : Buffer.from(a.conteudo, "utf8");
    const comprimido = deflateRawSync(bruto, { level: 6 });
    const crc = crc32(bruto);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(bruto.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nome, comprimido);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // feito por
    central.writeUInt16LE(20, 6); // versão necessária
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(data, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(bruto.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nome);
    deslocamento += local.length + nome.length + comprimido.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}
