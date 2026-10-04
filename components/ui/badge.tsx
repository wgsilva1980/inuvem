import * as React from "react";

type Tone = "success" | "neutral" | "warning" | "danger";

const tones: Record<Tone, string> = {
  success: "border-success/40 text-success",
  neutral: "border-border-strong text-muted",
  warning: "border-warning/40 text-warning",
  danger: "border-danger/40 text-danger",
};

/** Etiqueta de situação. O texto sempre diz o estado; a cor é só reforço. */
export function Badge({ tone = "neutral", className = "", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`.trim()} {...props} />;
}
