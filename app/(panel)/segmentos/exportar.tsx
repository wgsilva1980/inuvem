"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";

export function Exportar({ segmento, alcancaveis }: { segmento: string; alcancaveis: number }) {
  const [contatos, setContatos] = useState(false);
  const base = `/api/segmentos/exportar?segmento=${encodeURIComponent(segmento)}`;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={contatos} onChange={(e) => setContatos(e.target.checked)} className="mt-1 size-4" />
        <span>
          Incluir nome, e-mail, telefone e cidade ({alcancaveis} {alcancaveis === 1 ? "cliente aceita" : "clientes aceitam"} contato e {alcancaveis === 1 ? "tem" : "têm"} telefone ou e-mail). <span className="text-muted">São dados pessoais: use só para falar com quem aceitou receber mensagens, guarde o arquivo em local protegido e apague quando não precisar mais. O pedido fica no Histórico.</span>
        </span>
      </label>
      <div>
        <a href={contatos ? `${base}&contatos=1` : base} className={buttonClass("outline", "min-h-11")} download>
          {contatos ? "Baixar lista com contatos (CSV)" : "Baixar lista sem dados pessoais (CSV)"}
        </a>
      </div>
    </div>
  );
}
