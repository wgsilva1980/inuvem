import { z } from "zod";

export const KINDS = ["cliente", "fornecedor", "contador", "desenvolvedor", "outro"] as const;
export type ContactKind = (typeof KINDS)[number];
export const KIND_LABEL: Record<ContactKind, string> = { cliente: "Cliente", fornecedor: "Fornecedor", contador: "Contador", desenvolvedor: "Desenvolvedor", outro: "Outro" };

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;

const digits = (s: string) => s.replace(/\D/g, "");

/** Texto opcional: vazio vira null. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `No máximo ${max} caracteres.`)
    .transform((v) => (v === "" ? null : v));

/** Formulário de contato (campos como vêm do HTML, tudo texto). */
export const contactFormSchema = z
  .object({
    kind: z.enum(["", ...KINDS]).transform((v) => (v === "" ? null : v)),
    person_type: z.enum(["fisica", "juridica"]),
    name: z.string().trim().min(1, "Informe o nome.").max(255, "No máximo 255 caracteres."),
    trade_name: text(255),
    document: z
      .string()
      .transform((v) => digits(v))
      .refine((v) => v === "" || v.length === 11 || v.length === 14, "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)."),
    state_registration: text(40),
    ie_exempt: z.boolean(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "No máximo 254 caracteres.")
      .refine((v) => v === "" || z.string().email().safeParse(v).success, "Informe um e-mail válido."),
    phone: text(30),
    mobile: text(30),
    contact_person: text(120),
    zip: z
      .string()
      .transform((v) => digits(v))
      .refine((v) => v === "" || v.length === 8, "O CEP tem 8 dígitos."),
    street: text(255),
    number: text(20),
    complement: text(120),
    district: text(120),
    city: text(120),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === "" || (UFS as readonly string[]).includes(v), "Escolha um estado."),
    birth_date: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))), "Informe uma data válida."),
    gender: text(20),
    marital_status: text(40),
    profession: text(80),
    nationality: text(60),
    customer_since: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))), "Informe uma data válida."),
    active: z.boolean(),
    notes: text(2000),
  })
  .transform((v) => ({
    ...v,
    document: v.document === "" ? null : v.document,
    email: v.email === "" ? null : v.email,
    zip: v.zip === "" ? null : v.zip,
    state: v.state === "" ? null : v.state,
    birth_date: v.birth_date === "" ? null : v.birth_date,
    customer_since: v.customer_since === "" ? null : v.customer_since,
  }));

export type ContactInput = z.infer<typeof contactFormSchema>;
