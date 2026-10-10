"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldBase } from "@/components/ui/field";

interface Resultado {
  nome: string;
  tituloAtual: string;
  descricaoAtual: string;
  titulo: string;
  descricao: string;
  avisos: string[];
}

function Copiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [feito, setFeito] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-11"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setFeito(true);
          setTimeout(() => setFeito(false), 2000);
        } catch {
          setFeito(false);
        }
      }}
    >
      {feito ? "Copiado" : rotulo}
    </Button>
  );
}

export function Assistente({ dominio }: { dominio: string | null }) {
  const [modo, setModo] = useState<"endereco" | "texto">("endereco");
  const [endereco, setEndereco] = useState("");
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Resultado[]>([]);

  async function gerar(e: React.FormEvent) {
    e.preventDefault();
    setGerando(true);
    setErro(null);
    try {
      const res = await fetch("/api/seo/pagina-assistida", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(modo === "endereco" ? { endereco } : { titulo, texto }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<Resultado> & { error?: string };
      if (!res.ok || !data.titulo || !data.descricao) throw new Error(data.error ?? "Não foi possível gerar o SEO.");
      setResultados((r) => [{ nome: data.nome ?? "Página", tituloAtual: data.tituloAtual ?? "", descricaoAtual: data.descricaoAtual ?? "", titulo: data.titulo!, descricao: data.descricao!, avisos: data.avisos ?? [] }, ...r]);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao gerar o SEO.");
    } finally {
      setGerando(false);
    }
  }

  const pode = modo === "endereco" ? endereco.trim().length > 3 : titulo.trim().length >= 2;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 text-sm">
        <p className="font-medium">A Nuvemshop não deixa o painel ler nem gravar as páginas da loja.</p>
        <p className="text-muted">
          Por isso o SEO das páginas é assistido: o painel lê a página pública, a IA escreve o título e a descrição, e você <strong>copia e cola</strong> no admin da Nuvemshop (Loja online → Páginas → abra a página → procure a parte de SEO, o título e a descrição para os buscadores). Nada é gravado na loja daqui.
        </p>
      </Card>

      <form onSubmit={gerar} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="Como informar a página">
          {([["endereco", "Pelo endereço da página"], ["texto", "Colando o texto"]] as const).map(([m, r]) => (
            <button key={m} type="button" aria-pressed={modo === m} onClick={() => setModo(m)} className={`min-h-11 rounded-full border px-3 ${modo === m ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`}>
              {r}
            </button>
          ))}
        </div>
        {modo === "endereco" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Endereço da página na loja</span>
            <input value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder={dominio ? `https://${dominio}/quem-somos/` : "https://sualoja.com.br/quem-somos/"} maxLength={300} inputMode="url" className={fieldBase} />
            <span className="text-xs text-muted">{dominio ? `Só aceito endereços de ${dominio}.` : "Só aceito endereços do domínio da loja."} A página precisa estar publicada.</span>
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Título da página</span>
              <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} placeholder="Quem Somos" className={fieldBase} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Texto da página</span>
              <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={8} maxLength={6000} className={fieldBase} />
            </label>
          </>
        )}
        <div>
          <Button type="submit" disabled={gerando || !pode} className="min-h-11">
            {gerando ? "Lendo e escrevendo…" : "Gerar título e descrição"}
          </Button>
        </div>
        {erro && (
          <p role="alert" className="text-sm text-danger">
            {erro}
          </p>
        )}
      </form>

      {resultados.map((r, i) => (
        <Card key={`${r.nome}-${i}`} className="flex flex-col gap-3 text-sm">
          <h2 className="font-medium">{r.nome}</h2>
          {r.avisos.length > 0 && <p className="text-warning">Confira o texto: {r.avisos.join("; ")}.</p>}
          <div className="flex flex-col gap-1">
            <span className="text-muted">Título de SEO ({r.titulo.length} caracteres)</span>
            <p className="rounded-md border border-border p-2">{r.titulo}</p>
            <div>
              <Copiar texto={r.titulo} rotulo="Copiar título" />
            </div>
            {r.tituloAtual && <span className="text-xs text-muted">Hoje na loja: {r.tituloAtual}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted">Descrição de SEO ({r.descricao.length} caracteres)</span>
            <p className="rounded-md border border-border p-2">{r.descricao}</p>
            <div>
              <Copiar texto={r.descricao} rotulo="Copiar descrição" />
            </div>
            {r.descricaoAtual && <span className="text-xs text-muted">Hoje na loja: {r.descricaoAtual}</span>}
          </div>
        </Card>
      ))}
    </div>
  );
}
