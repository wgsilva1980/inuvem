"use client";

import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Image } from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { useState, type ReactNode } from "react";

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    code: false,
    codeBlock: false,
    horizontalRule: false,
    link: { openOnClick: false, autolink: false, protocols: ["mailto", "tel"], HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } },
  }),
  TextStyle,
  Color,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Image.configure({ allowBase64: false }),
  TableKit.configure({ table: { resizable: false } }),
];

const btn =
  "inline-flex size-8 shrink-0 items-center justify-center rounded text-sm hover:bg-border/60 disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-primary/15 aria-pressed:text-primary";
const sel = "h-8 rounded border border-border bg-background px-1 text-sm";

function Btn({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={btn} title={label} aria-label={label} aria-pressed={active ?? false} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

const Sep = () => <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;

function normalizeUrl(raw: string, schemes: string[]): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return schemes.includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Editor visual da descrição (Tiptap). O valor que vai no formulário é o campo escondido `name`:
 * começa como o HTML original e só muda quando o usuário edita, então abrir e salvar não reescreve nada.
 */
export function RichTextEditor({ name, defaultValue, id }: { name: string; defaultValue: string; id?: string }) {
  const [html, setHtml] = useState(defaultValue);
  const [mode, setMode] = useState<"visual" | "html">("visual");

  const editor = useEditor({
    extensions,
    content: defaultValue,
    immediatelyRender: false,
    editorProps: { attributes: { class: "rte-content", role: "textbox", "aria-multiline": "true", "aria-label": "Descrição do produto", ...(id ? { id } : {}) } },
    onUpdate: ({ editor: e }) => setHtml(e.isEmpty ? "" : e.getHTML()),
  });

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      underline: e?.isActive("underline") ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      ordered: e?.isActive("orderedList") ?? false,
      link: e?.isActive("link") ?? false,
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
      inTable: e?.isActive("table") ?? false,
      style: e?.isActive("heading", { level: 1 })
        ? "h1"
        : e?.isActive("heading", { level: 2 })
          ? "h2"
          : e?.isActive("heading", { level: 3 })
            ? "h3"
            : e?.isActive("blockquote")
              ? "quote"
              : "p",
      align: e?.isActive({ textAlign: "center" }) ? "center" : e?.isActive({ textAlign: "right" }) ? "right" : e?.isActive({ textAlign: "justify" }) ? "justify" : "left",
      color: (e?.getAttributes("textStyle").color as string | undefined) ?? "",
    }),
  });

  function setStyle(value: string) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (editor.isActive("blockquote") && value !== "quote") chain.lift("blockquote");
    if (value === "p") chain.setParagraph().run();
    else if (value === "quote") chain.setParagraph().toggleBlockquote().run();
    else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
  }

  function setLink() {
    if (!editor) return;
    const current = (editor.getAttributes("link").href as string | undefined) ?? "";
    const raw = window.prompt("Endereço do link (deixe vazio para remover):", current);
    if (raw === null) return;
    if (raw.trim() === "") return void editor.chain().focus().extendMarkRange("link").unsetLink().run();
    const href = normalizeUrl(raw, ["http:", "https:", "mailto:", "tel:"]);
    if (!href) return void window.alert("Endereço inválido. Use http://, https://, mailto: ou tel:.");
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  function setImage() {
    if (!editor) return;
    const raw = window.prompt("Endereço (https://) da imagem. Dica: copie o endereço de uma foto do produto, na seção Imagens:");
    if (raw === null || raw.trim() === "") return;
    const src = normalizeUrl(raw, ["https:"]);
    if (!src) return void window.alert("Endereço inválido. A imagem precisa de um endereço https://.");
    editor.chain().focus().setImage({ src, alt: "" }).run();
  }

  function tableAction(action: string) {
    if (!editor) return;
    const c = editor.chain().focus();
    if (action === "insert") c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    if (action === "addRow") c.addRowAfter().run();
    if (action === "addCol") c.addColumnAfter().run();
    if (action === "delRow") c.deleteRow().run();
    if (action === "delCol") c.deleteColumn().run();
    if (action === "delTable") c.deleteTable().run();
  }

  function switchMode(next: "visual" | "html") {
    if (next === mode) return;
    // Ao voltar para o visual, o editor relê o HTML (sem disparar atualização: o valor só muda se o usuário editar).
    if (next === "visual" && editor) editor.commands.setContent(html, { emitUpdate: false });
    setMode(next);
  }

  return (
    <div className="rounded-md border border-border bg-background">
      <input type="hidden" name={name} value={html} />
      <div role="toolbar" aria-label="Formatação da descrição" className="flex flex-wrap items-center gap-0.5 border-b border-border p-1">
        {mode === "visual" && editor && s ? (
          <>
            <select aria-label="Estilo do parágrafo" className={sel} value={s.style} onChange={(e) => setStyle(e.target.value)}>
              <option value="p">Parágrafo</option>
              <option value="h1">Título 1</option>
              <option value="h2">Título 2</option>
              <option value="h3">Título 3</option>
              <option value="quote">Citação</option>
            </select>
            <Sep />
            <Btn label="Negrito" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
              <b>B</b>
            </Btn>
            <Btn label="Itálico" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <i>I</i>
            </Btn>
            <Btn label="Sublinhado" active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
              <u>U</u>
            </Btn>
            <label className="inline-flex h-8 items-center gap-1 rounded px-1 text-sm hover:bg-border/60" title="Cor do texto">
              <span aria-hidden className="font-semibold underline decoration-2" style={{ textDecorationColor: s.color || "currentColor" }}>
                A
              </span>
              <input
                type="color"
                aria-label="Cor do texto"
                className="size-5 cursor-pointer border-0 bg-transparent p-0"
                value={/^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : "#000000"}
                onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
              />
            </label>
            <Btn label="Remover cor do texto" onClick={() => editor.chain().focus().unsetColor().run()}>
              <span aria-hidden>⌀</span>
            </Btn>
            <Sep />
            <Btn label="Desfazer" disabled={!s.canUndo} onClick={() => editor.chain().focus().undo().run()}>
              ↶
            </Btn>
            <Btn label="Refazer" disabled={!s.canRedo} onClick={() => editor.chain().focus().redo().run()}>
              ↷
            </Btn>
            <Btn label="Limpar formatação" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
              <span aria-hidden>T<sub>x</sub></span>
            </Btn>
            <Sep />
            <Btn label="Lista com marcadores" active={s.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>
              •≡
            </Btn>
            <Btn label="Lista numerada" active={s.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
              1.
            </Btn>
            <select aria-label="Alinhamento" className={sel} value={s.align} onChange={(e) => editor.chain().focus().setTextAlign(e.target.value).run()}>
              <option value="left">Esquerda</option>
              <option value="center">Centro</option>
              <option value="right">Direita</option>
              <option value="justify">Justificado</option>
            </select>
            <Sep />
            <Btn label="Link" active={s.link} onClick={setLink}>
              🔗
            </Btn>
            <Btn label="Imagem" onClick={setImage}>
              🖼
            </Btn>
            <select aria-label="Tabela" className={sel} value="" onChange={(e) => (tableAction(e.target.value), (e.target.value = ""))}>
              <option value="">Tabela…</option>
              <option value="insert">Inserir tabela 3×3</option>
              <option value="addRow" disabled={!s.inTable}>Adicionar linha</option>
              <option value="addCol" disabled={!s.inTable}>Adicionar coluna</option>
              <option value="delRow" disabled={!s.inTable}>Excluir linha</option>
              <option value="delCol" disabled={!s.inTable}>Excluir coluna</option>
              <option value="delTable" disabled={!s.inTable}>Excluir tabela</option>
            </select>
          </>
        ) : null}
        <span className="ml-auto" />
        <button
          type="button"
          className="h-8 rounded px-2 text-sm text-muted underline hover:text-foreground"
          onClick={() => switchMode(mode === "visual" ? "html" : "visual")}
        >
          {mode === "visual" ? "Editar HTML" : "Voltar ao editor visual"}
        </button>
      </div>

      {mode === "visual" ? (
        <>
          <EditorContent editor={editor} />
          <p className="border-t border-border px-3 py-1.5 text-xs text-muted">
            Se você editar aqui, só a formatação de texto, links, imagens e tabelas é mantida. Vídeos incorporados, scripts e estilos avançados da descrição
            original são descartados. Sem editar, a descrição segue exatamente como está na loja.
          </p>
        </>
      ) : (
        <div className="flex flex-col gap-1 p-2">
          <textarea
            aria-label="HTML da descrição"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={12}
            spellCheck={false}
            className="w-full rounded border border-border bg-background p-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-muted">
            Ao salvar uma descrição alterada, o painel mantém só formatação de texto, links, imagens e tabelas. Scripts, vídeos incorporados e estilos
            avançados são removidos.
          </p>
        </div>
      )}
    </div>
  );
}
