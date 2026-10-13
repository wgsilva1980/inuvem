import { Client } from "basic-ftp";
import { Readable } from "node:stream";

/** Arquivo que existe na mesma pasta do tema; serve para conferir que a pasta configurada é a certa antes de gravar. */
export const ARQUIVO_DE_REFERENCIA = "navigation-top.tpl";

export interface ConfigFtp {
  host: string;
  port: number;
  user: string;
  password: string;
  /** "explicit" = FTP com TLS iniciado na porta 21 (AUTH TLS); "implicit" = TLS desde a conexão (porta 990). */
  secure: "explicit" | "implicit";
  /** Pasta do tema onde estão navigation-top.tpl e os outros arquivos de menu (snipplets/navigation). */
  dir: string;
  verificarCertificado: boolean;
}

/** Lê a configuração do FTP das variáveis de ambiente; devolve também o que falta (nomes das variáveis). */
export function lerConfigFtp(env: Record<string, string | undefined> = process.env): { config: ConfigFtp | null; faltando: string[] } {
  const obrigatorias = ["FTP_HOST", "FTP_USER", "FTP_PASSWORD", "FTP_MENU_DIR"] as const;
  const faltando = obrigatorias.filter((k) => !env[k]?.trim());
  if (faltando.length > 0) return { config: null, faltando: [...faltando] };
  const secure = env.FTP_SECURE?.trim().toLowerCase() === "implicit" ? "implicit" : "explicit";
  const port = Number(env.FTP_PORT) > 0 ? Number(env.FTP_PORT) : secure === "implicit" ? 990 : 21;
  return {
    faltando: [],
    config: {
      host: env.FTP_HOST!.trim(),
      port,
      user: env.FTP_USER!.trim(),
      password: env.FTP_PASSWORD!,
      secure,
      dir: env.FTP_MENU_DIR!.trim().replace(/\/+$/, "") || "/",
      verificarCertificado: env.FTP_VERIFICAR_CERTIFICADO?.trim().toLowerCase() !== "nao",
    },
  };
}

/** Parte do cliente FTP que usamos (permite testar sem rede). */
export interface ClienteFtp {
  access(opcoes: { host: string; port: number; user: string; password: string; secure: boolean | "implicit"; secureOptions?: { rejectUnauthorized: boolean } }): Promise<unknown>;
  cd(dir: string): Promise<unknown>;
  list(): Promise<Array<{ name: string }>>;
  uploadFrom(origem: Readable, destino: string): Promise<unknown>;
  size(nome: string): Promise<number>;
  rename(de: string, para: string): Promise<unknown>;
  remove(nome: string): Promise<unknown>;
  close(): void;
}

export class ErroFtp extends Error {}

/** Mensagem em português, sem nunca incluir a senha. */
export function mensagemFtp(err: unknown): string {
  if (err instanceof ErroFtp) return err.message;
  const e = err as { code?: string | number; message?: string };
  const code = String(e?.code ?? "");
  if (code === "530" || /\b530\b/.test(e?.message ?? "")) return "o servidor FTP recusou o usuário ou a senha";
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "não encontrei o servidor FTP (confira FTP_HOST)";
  if (["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH"].includes(code) || /timeout/i.test(e?.message ?? "")) return "não consegui conectar ao servidor FTP (confira FTP_HOST, a porta e se o servidor aceita conexões de fora)";
  if (/certificate|CERT_|self.signed|altname/i.test(`${code} ${e?.message ?? ""}`)) return "o certificado TLS do servidor FTP não confere (se você confia no servidor, defina FTP_VERIFICAR_CERTIFICADO=nao)";
  if (code === "550" || /\b550\b/.test(e?.message ?? "")) return "a pasta ou o arquivo não foi encontrado ou não pode ser gravado no FTP (confira FTP_MENU_DIR e as permissões)";
  return `falha no FTP: ${(e?.message ?? String(err)).replace(/\s+/g, " ").slice(0, 200)}`;
}

/**
 * Envia o arquivo para a pasta configurada sem que a loja possa ler um arquivo pela metade: confere que a pasta é a do tema (existe navigation-top.tpl),
 * grava com o nome final + ".tmp", confere o tamanho e só então renomeia. Se o servidor não aceitar renomear por cima de um arquivo existente,
 * apaga o antigo e renomeia logo em seguida.
 */
export async function enviarArquivoFtp(config: ConfigFtp, nome: string, conteudo: string, criarCliente: () => ClienteFtp = () => new Client(20_000) as unknown as ClienteFtp): Promise<void> {
  const cliente = criarCliente();
  const tmp = `${nome}.tmp`;
  try {
    try {
      await cliente.access({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        secure: config.secure === "implicit" ? "implicit" : true,
        secureOptions: { rejectUnauthorized: config.verificarCertificado },
      });
      await cliente.cd(config.dir);
      const nomes = (await cliente.list()).map((f) => f.name);
      if (!nomes.includes(ARQUIVO_DE_REFERENCIA)) {
        throw new ErroFtp(`não achei ${ARQUIVO_DE_REFERENCIA} em ${config.dir}: confira FTP_MENU_DIR (deve ser a pasta snipplets/navigation do tema)`);
      }
      const buffer = Buffer.from(conteudo, "utf8");
      await cliente.uploadFrom(Readable.from([buffer]), tmp);
      if ((await cliente.size(tmp)) !== buffer.length) throw new ErroFtp("o arquivo enviado chegou com tamanho diferente; nada foi publicado");
      try {
        await cliente.rename(tmp, nome);
      } catch {
        await cliente.remove(nome);
        await cliente.rename(tmp, nome);
      }
    } catch (err) {
      await cliente.remove(tmp).catch(() => undefined);
      throw err instanceof ErroFtp ? err : new ErroFtp(mensagemFtp(err));
    }
  } finally {
    cliente.close();
  }
}
