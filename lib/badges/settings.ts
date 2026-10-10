import type { Db } from "@/lib/sync/repo";

export interface BadgeSettings {
  enabled: boolean;
  lowStockEnabled: boolean;
  lowStockMax: number;
  countdownEnabled: boolean;
  whatsappEnabled: boolean;
  /** Só dígitos, com DDI (55…). */
  whatsappNumber: string;
  whatsappMessage: string;
}

export const PADRAO: BadgeSettings = {
  enabled: false,
  lowStockEnabled: true,
  lowStockMax: 3,
  countdownEnabled: true,
  whatsappEnabled: false,
  whatsappNumber: "",
  whatsappMessage: "Olá! Tenho interesse em {produto}.",
};

export const MENSAGEM_MAX = 200;

/** "(11) 91234-5678", "+55 11 91234-5678" e "11912345678" viram "5511912345678". Devolve null se não parecer um telefone. */
export function normalizarWhatsapp(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 0) return null;
  if (raw.trim().startsWith("+") && !d.startsWith("55")) return null; // com "+", só aceita Brasil (+55): um 11 dígitos de outro país não pode virar número brasileiro
  const comDdi = d.startsWith("55") && d.length >= 12 ? d : d.length === 10 || d.length === 11 ? `55${d}` : d;
  return /^\d{12,13}$/.test(comDdi) && comDdi.startsWith("55") ? comDdi : null;
}

export type Validado = { ok: true; value: BadgeSettings } | { ok: false; error: string };

export function validarConfig(input: Partial<Record<keyof BadgeSettings, unknown>>): Validado {
  const max = Number(input.lowStockMax);
  if (!Number.isInteger(max) || max < 1 || max > 20) return { ok: false, error: "O limite de “últimas unidades” deve ser de 1 a 20." };
  const whatsappEnabled = input.whatsappEnabled === true;
  const numero = typeof input.whatsappNumber === "string" ? input.whatsappNumber : "";
  const normalizado = numero.trim() === "" ? "" : normalizarWhatsapp(numero);
  if (normalizado === null) return { ok: false, error: "O número de WhatsApp parece inválido. Use DDD e número, por exemplo (11) 91234-5678." };
  if (whatsappEnabled && normalizado === "") return { ok: false, error: "Informe o número de WhatsApp para ligar o botão." };
  const msg = (typeof input.whatsappMessage === "string" ? input.whatsappMessage : "").replace(/\s+/g, " ").trim();
  if (msg.length > MENSAGEM_MAX) return { ok: false, error: `A mensagem pode ter no máximo ${MENSAGEM_MAX} caracteres.` };
  return {
    ok: true,
    value: {
      enabled: input.enabled === true,
      lowStockEnabled: input.lowStockEnabled === true,
      lowStockMax: max,
      countdownEnabled: input.countdownEnabled === true,
      whatsappEnabled,
      whatsappNumber: normalizado,
      whatsappMessage: msg || PADRAO.whatsappMessage,
    },
  };
}

export async function obterConfig(db: Db, storeId: string): Promise<BadgeSettings> {
  const r = await db.query<{ enabled: boolean; low_stock_enabled: boolean; low_stock_max: number; countdown_enabled: boolean; whatsapp_enabled: boolean; whatsapp_number: string | null; whatsapp_message: string }>(
    `SELECT enabled, low_stock_enabled, low_stock_max, countdown_enabled, whatsapp_enabled, whatsapp_number, whatsapp_message FROM badge_settings WHERE store_id = $1::uuid`,
    [storeId],
  );
  const x = r[0];
  if (!x) return { ...PADRAO };
  return {
    enabled: x.enabled,
    lowStockEnabled: x.low_stock_enabled,
    lowStockMax: x.low_stock_max,
    countdownEnabled: x.countdown_enabled,
    whatsappEnabled: x.whatsapp_enabled,
    whatsappNumber: x.whatsapp_number ?? "",
    whatsappMessage: x.whatsapp_message,
  };
}

export async function salvarConfig(db: Db, storeId: string, c: BadgeSettings, actor: string): Promise<void> {
  await db.query(
    `INSERT INTO badge_settings (store_id, enabled, low_stock_enabled, low_stock_max, countdown_enabled, whatsapp_enabled, whatsapp_number, whatsapp_message, updated_at, updated_by)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, now(), $9)
     ON CONFLICT (store_id) DO UPDATE SET enabled = $2, low_stock_enabled = $3, low_stock_max = $4, countdown_enabled = $5, whatsapp_enabled = $6,
       whatsapp_number = $7, whatsapp_message = $8, updated_at = now(), updated_by = $9`,
    [storeId, c.enabled, c.lowStockEnabled, c.lowStockMax, c.countdownEnabled, c.whatsappEnabled, c.whatsappNumber || null, c.whatsappMessage, actor],
  );
}
