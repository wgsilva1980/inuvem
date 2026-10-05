import { contactFormSchema, type ContactInput } from "./schema";

export type ContactFormResult = { input: ContactInput; fieldErrors?: undefined } | { input?: undefined; fieldErrors: Record<string, string> };

/** Lê o formulário de contato (campos HTML) e valida. Erros por campo, na primeira mensagem de cada um. */
export function parseContactForm(formData: FormData): ContactFormResult {
  const get = (name: string) => String(formData.get(name) ?? "");
  const parsed = contactFormSchema.safeParse({
    kind: get("kind"),
    person_type: get("person_type") || "fisica",
    name: get("name"),
    trade_name: get("trade_name"),
    document: get("document"),
    state_registration: get("state_registration"),
    ie_exempt: formData.get("ie_exempt") === "on",
    email: get("email"),
    phone: get("phone"),
    mobile: get("mobile"),
    contact_person: get("contact_person"),
    zip: get("zip"),
    street: get("street"),
    number: get("number"),
    complement: get("complement"),
    district: get("district"),
    city: get("city"),
    state: get("state"),
    birth_date: get("birth_date"),
    gender: get("gender"),
    marital_status: get("marital_status"),
    profession: get("profession"),
    nationality: get("nationality"),
    customer_since: get("customer_since"),
    active: formData.get("active") === "on",
    notes: get("notes"),
  });
  if (parsed.success) return { input: parsed.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
  return { fieldErrors };
}
