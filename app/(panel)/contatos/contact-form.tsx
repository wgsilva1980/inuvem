"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldClass } from "@/components/ui/field";
import { formatDocument, formatZip } from "@/lib/contacts/format";
import type { Contact } from "@/lib/contacts/repo";
import { KINDS, KIND_LABEL, UFS } from "@/lib/contacts/schema";
import { removeContact, saveContact, type ContactState } from "./actions";

const label = "flex flex-col gap-1 text-sm";

export function ContactForm({ contact }: { contact?: Contact }) {
  const id = contact ? Number(contact.id) : null;
  const [state, action, pending] = useActionState<ContactState | null, FormData>(saveContact.bind(null, id), null);
  const [personType, setPersonType] = useState<string>(contact?.person_type ?? "fisica");
  const err = (name: string) => state?.fieldErrors?.[name];
  const [deleting, startDelete] = useTransition();
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  // avisa ao fechar a aba com alterações não salvas
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (state?.ok) setDirty(false);
  }, [state]);
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);

  const field = (name: string, text: string, opts: { defaultValue?: string | null; type?: string; maxLength?: number; inputMode?: "numeric" | "tel" | "email" | "text"; required?: boolean; placeholder?: string; className?: string } = {}) => (
    <label className={`${label} ${opts.className ?? ""}`}>
      <span className="text-muted">{text}</span>
      <input name={name} type={opts.type ?? "text"} defaultValue={opts.defaultValue ?? ""} maxLength={opts.maxLength} inputMode={opts.inputMode} required={opts.required} placeholder={opts.placeholder} className={fieldClass} aria-invalid={!!err(name)} />
      {err(name) && <span className="text-danger">{err(name)}</span>}
    </label>
  );

  return (
    <form action={action} onChange={() => setDirty(true)} className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Identificação</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className={label}>
            <span className="text-muted">Tipo de contato</span>
            <select name="kind" defaultValue={contact?.kind ?? "cliente"} className={fieldClass}>
              <option value="">Não informado</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            <span className="text-muted">Tipo de pessoa</span>
            <select name="person_type" value={personType} onChange={(e) => setPersonType(e.target.value)} className={fieldClass}>
              <option value="fisica">Pessoa física</option>
              <option value="juridica">Pessoa jurídica</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={contact?.active ?? true} />
            <span>Ativo</span>
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("name", personType === "juridica" ? "Razão social" : "Nome", { defaultValue: contact?.name, required: true, maxLength: 255 })}
          {field("trade_name", personType === "juridica" ? "Nome fantasia" : "Apelido / fantasia", { defaultValue: contact?.trade_name, maxLength: 255 })}
          {field("document", personType === "juridica" ? "CNPJ" : "CPF", { defaultValue: formatDocument(contact?.document ?? null), inputMode: "numeric", maxLength: 18 })}
          {field("state_registration", personType === "juridica" ? "Inscrição estadual" : "RG", { defaultValue: contact?.state_registration, maxLength: 40 })}
        </div>
        {personType === "juridica" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="ie_exempt" defaultChecked={contact?.ie_exempt ?? false} />
            <span>Isento de inscrição estadual</span>
          </label>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Contato</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("mobile", "Celular / WhatsApp", { defaultValue: contact?.mobile, type: "tel", inputMode: "tel", maxLength: 30 })}
          {field("phone", "Telefone", { defaultValue: contact?.phone, type: "tel", inputMode: "tel", maxLength: 30 })}
          {field("email", "E-mail", { defaultValue: contact?.email, type: "email", inputMode: "email", maxLength: 254 })}
          {field("contact_person", "Pessoa de contato", { defaultValue: contact?.contact_person, maxLength: 120 })}
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Endereço</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
          {field("zip", "CEP", { defaultValue: formatZip(contact?.zip ?? null), inputMode: "numeric", maxLength: 9, className: "sm:col-span-2" })}
          {field("street", "Endereço", { defaultValue: contact?.street, maxLength: 255, className: "sm:col-span-3" })}
          {field("number", "Número", { defaultValue: contact?.number, maxLength: 20 })}
          {field("complement", "Complemento", { defaultValue: contact?.complement, maxLength: 120, className: "sm:col-span-2" })}
          {field("district", "Bairro", { defaultValue: contact?.district, maxLength: 120, className: "sm:col-span-2" })}
          {field("city", "Cidade", { defaultValue: contact?.city, maxLength: 120, className: "sm:col-span-1" })}
          <label className={label}>
            <span className="text-muted">UF</span>
            <select name="state" defaultValue={contact?.state ?? ""} className={fieldClass}>
              <option value=""></option>
              {UFS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            {err("state") && <span className="text-danger">{err("state")}</span>}
          </label>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Dados pessoais e relacionamento</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {field("birth_date", "Data de nascimento", { defaultValue: contact?.birth_date, type: "date" })}
          {field("customer_since", "Cliente desde", { defaultValue: contact?.customer_since, type: "date" })}
          {field("gender", "Sexo", { defaultValue: contact?.gender, maxLength: 20 })}
          {field("marital_status", "Estado civil", { defaultValue: contact?.marital_status, maxLength: 40 })}
          {field("profession", "Profissão", { defaultValue: contact?.profession, maxLength: 80 })}
          {field("nationality", "Naturalidade", { defaultValue: contact?.nationality, maxLength: 60 })}
        </div>
        <label className={label}>
          <span className="text-muted">Observações</span>
          <textarea name="notes" defaultValue={contact?.notes ?? ""} rows={3} maxLength={2000} className={fieldClass} />
          {err("notes") && <span className="text-danger">{err("notes")}</span>}
        </label>
      </Card>

      {contact && (
        <Card className="border-danger">
          <h2 className="text-base font-semibold text-danger">Excluir contato</h2>
          <p className="mt-1 text-sm text-muted">Remove este contato do painel. Não dá para desfazer. Para só deixar de usar, desmarque “Ativo”.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="danger"
              disabled={deleting}
              onClick={() => {
                if (window.confirm(`Excluir o contato “${contact.name}”? Isso não pode ser desfeito.`)) {
                  setDirty(false);
                  startDelete(async () => {
                    const r = await removeContact(Number(contact.id));
                    if (r?.message) setDeleteMessage(r.message);
                  });
                }
              }}
            >
              {deleting ? "Excluindo…" : "Excluir contato"}
            </Button>
            {deleteMessage && (
              <span role="alert" className="text-sm text-danger">
                {deleteMessage}
              </span>
            )}
          </div>
        </Card>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card px-4 py-3 shadow-lg">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            {state?.message ? (
              <Alert tone={state.ok ? "success" : "danger"} className="border-0 p-0">
                {state.message}
              </Alert>
            ) : dirty ? (
              <span className="text-warning">Alterações não salvas</span>
            ) : (
              <span className="text-muted">{contact ? "Nenhuma alteração pendente" : "Preencha os dados do contato"}</span>
            )}
          </div>
          <Button type="submit" disabled={pending} className="min-h-11">
            {pending ? "Salvando…" : contact ? "Salvar contato" : "Cadastrar contato"}
          </Button>
        </div>
      </div>
    </form>
  );
}
