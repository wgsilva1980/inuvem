import * as React from "react";

type Variant = "primary" | "outline" | "danger";

const styles: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  outline: "border border-border bg-card hover:bg-border/40",
  danger: "bg-danger text-white hover:opacity-90",
};

export function buttonClass(variant: Variant = "primary", extra = ""): string {
  return `inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${extra}`.trim();
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}
