"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";
import type { SugestaoEmail } from "@/lib/emails/repo";
import { TIPOS_MANUAIS, type TipoManual } from "@/lib/emails/tipos";

interface Modelo {
  id: string;
  nome: string;
  assunto: string;
  corpo: string;
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

export function EmailsView({ modelos, campos, semTexto, erroModelos, sugestoes }: { modelos: Modelo[]; campos: string[]; semTexto: number; erroModelos: string | null; sugestoes: SugestaoEmail[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoManual>("pedido_enviado");
  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");

  async function gerar(chave: string, body: Record<string, unknown>) {
    setOcupado(chave);
    setErro(null);
    const r = await post("/api/emails/gerar", body);
    setOcupado(null);
    if (!r.ok) return setErro(String(r.data.error ?? "Não foi possível reescrever."));
    router.refresh();
  }

  const comSugestao = new Set(sugestoes.map((s) => s.key));

  return (
    <div className="flex flex-col gap-4">
      {erro && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-danger">
          {erro}
        </p>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium">Modelos da loja</h2>
        {erroModelos ? (
          <p className="text-sm text-muted">Não consegui ler os modelos de e-mail da loja ({erroModelos}). Cole o texto do e-mail no quadro abaixo.</p>
        ) : modelos.length === 0 ? (
          <p className="text-sm text-muted">
            A loja não devolveu modelos de e-mail com texto{semTexto > 0 ? ` (${semTexto} item(ns) sem assunto nem corpo reconhecíveis; campos recebidos: ${campos.join(", ") || "nenhum"})` : ""}. Cole o texto do e-mail no quadro abaixo.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {modelos.map((m) => (
              <li key={m.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{m.nome}</p>
                  <p className="truncate text-xs text-muted">{m.assunto || "(sem assunto)"}</p>
                </div>
                <Button type="button" variant="outline" disabled={ocupado !== null} onClick={() => gerar(m.id, { key: m.id })}>
                  {ocupado === m.id ? "Reescrevendo…" : comSugestao.has(m.id) ? "Reescrever de novo" : "Reescrever com a IA"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium">Colar um e-mail</h2>
        <p className="text-sm text-muted">Copie o assunto e o texto (de preferência o HTML) do editor de e-mails da loja e cole aqui. As variáveis, como {"{{ customer.name }}"}, são preservadas.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoManual)} className={fieldBase}>
              {(Object.keys(TIPOS_MANUAIS) as TipoManual[]).map((k) => (
                <option key={k} value={k}>
                  {TIPOS_MANUAIS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-muted">Assunto (opcional)</span>
            <input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={500} className={fieldBase} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Texto do e-mail</span>
          <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={8} className={`${fieldBase} font-mono text-xs`} />
        </label>
        <div>
          <Button type="button" disabled={ocupado !== null || corpo.trim() === ""} onClick={() => gerar("manual", { tipo, assunto, corpo })}>
            {ocupado === "manual" ? "Reescrevendo…" : "Reescrever com a IA"}
          </Button>
        </div>
      </Card>

      {sugestoes.length > 0 && <h2 className="text-lg font-semibold">Reescritas</h2>}
      {sugestoes.map((s) => (
        <Reescrita key={`${s.key}:${s.generated_at}:${s.edited}`} s={s} onChange={() => router.refresh()} setErro={setErro} />
      ))}
    </div>
  );
}

function Reescrita({ s, onChange, setErro }: { s: SugestaoEmail; onChange: () => void; setErro: (e: string | null) => void }) {
  const [assunto, setAssunto] = useState(s.subject ?? "");
  const [corpo, setCorpo] = useState(s.body ?? "");
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ver, setVer] = useState<"novo" | "original">("novo");
  const mudou = assunto !== (s.subject ?? "") || corpo !== (s.body ?? "");

  async function acao(corpoReq: Record<string, unknown>) {
    setOcupado(true);
    setErro(null);
    const r = await post("/api/emails/salvar", { key: s.key, ...corpoReq });
    setOcupado(false);
    if (!r.ok) return setErro(String(r.data.error ?? "Não foi possível salvar."));
    onChange();
  }

  async function copiarCampo(texto: string, nome: string) {
    setAviso((await copiar(texto)) ? `${nome} copiado.` : "Não consegui copiar; selecione o texto e copie à mão.");
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{s.label}</h3>
          <p className="text-xs text-muted">{s.applied_at ? "Já colado na loja" : s.edited ? "Editado por você" : "Gerado pela IA"}</p>
        </div>
        <div className="flex gap-2 text-sm">
          <button type="button" className="underline" onClick={() => setVer(ver === "novo" ? "original" : "novo")}>
            {ver === "novo" ? "Ver o original" : "Ver o novo"}
          </button>
          <button type="button" className="text-danger underline" disabled={ocupado} onClick={() => confirm("Descartar esta reescrita?") && acao({ acao: "descartar" })}>
            Descartar
          </button>
        </div>
      </div>

      {s.error ? (
        <p role="alert" className="text-sm text-danger">
          Não consegui reescrever: {s.error}
        </p>
      ) : ver === "original" ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">{s.original_subject || "(sem assunto)"}</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border p-3 text-xs">{s.original_body}</pre>
        </div>
      ) : (
        <>
          {s.warning && <p className="rounded-md border border-border p-3 text-sm text-danger">Confira antes de usar: {s.warning}.</p>}
          {s.original_subject !== "" && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Assunto</span>
              <input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={500} className={fieldBase} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Texto (HTML)</span>
            <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={10} className={`${fieldBase} font-mono text-xs`} />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Como fica (as variáveis aparecem como no modelo)</span>
            <iframe title={`Prévia: ${s.label}`} sandbox="" srcDoc={corpo} className="h-64 w-full rounded-md border border-border bg-white" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mudou && (
              <Button type="button" disabled={ocupado} onClick={() => acao({ assunto, corpo })}>
                Salvar edição
              </Button>
            )}
            {s.original_subject !== "" && (
              <Button type="button" variant="outline" onClick={() => copiarCampo(assunto, "Assunto")}>
                Copiar assunto
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => copiarCampo(corpo, "Texto")}>
              Copiar texto
            </Button>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(s.applied_at)} disabled={ocupado || mudou} onChange={(e) => acao({ acao: e.target.checked ? "colado" : "pendente" })} />
              Já colei na loja
            </label>
          </div>
          {aviso && (
            <p role="status" className="text-xs text-muted">
              {aviso}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
