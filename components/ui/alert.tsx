import * as React from "react";

type Tone = "success" | "danger" | "info";

const tones: Record<Tone, string> = {
  success: "border-success/40 text-success",
  danger: "border-danger/40 text-danger",
  info: "border-border text-foreground",
};

/** Mensagem de retorno. Erros usam role="alert"; o resto, role="status". */
export function Alert({ tone = "info", className = "", ...props }: React.HTMLAttributes<HTMLParagraphElement> & { tone?: Tone }) {
  return <p role={tone === "danger" ? "alert" : "status"} className={`rounded-md border bg-card p-3 text-sm ${tones[tone]} ${className}`.trim()} {...props} />;
}
