/** Envio de e-mail pela API do Resend (HTTP, sem biblioteca). A chave fica em RESEND_API_KEY; sem ela, o resumo diário fica indisponível. */
export class EmailConfigError extends Error {}
export class EmailEnvioError extends Error {}

export interface Email {
  para: string[];
  assunto: string;
  html: string;
  texto: string;
}

export interface ConfigEmail {
  apiKey: string;
  from: string;
}

/** Remetente padrão do Resend para testes: só entrega para o e-mail dono da conta Resend. Para outros destinatários, verifique um domínio no Resend e defina RESEND_FROM. */
export const REMETENTE_PADRAO = "INuvem <onboarding@resend.dev>";

export function configDoEmail(env: Record<string, string | undefined> = process.env): ConfigEmail {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new EmailConfigError("Falta configurar o envio de e-mail: cadastre a variável RESEND_API_KEY na Vercel (chave do Resend) e faça um novo deploy.");
  return { apiKey, from: env.RESEND_FROM?.trim() || REMETENTE_PADRAO };
}

export const emailConfigurado = (env: Record<string, string | undefined> = process.env): boolean => Boolean(env.RESEND_API_KEY?.trim());

export async function enviarEmail(email: Email, config: ConfigEmail, fetchImpl: typeof fetch = fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.from, to: email.para, subject: email.assunto, html: email.html, text: email.texto }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new EmailEnvioError("Não consegui falar com o serviço de e-mail. Tente de novo.");
  }
  if (res.ok) return;
  const corpo = (await res.json().catch(() => ({}))) as { message?: string };
  if (res.status === 401 || res.status === 403) throw new EmailEnvioError(`O serviço de e-mail recusou (${res.status}). Confira a chave RESEND_API_KEY e se o remetente/destinatário são permitidos.${corpo.message ? ` Detalhe: ${corpo.message.slice(0, 200)}` : ""}`);
  throw new EmailEnvioError(`O serviço de e-mail respondeu ${res.status}.${corpo.message ? ` ${corpo.message.slice(0, 200)}` : ""}`);
}
