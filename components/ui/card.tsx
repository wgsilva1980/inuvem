import * as React from "react";

export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-lg border border-border bg-card p-4 sm:p-6 ${className}`} {...props} />;
}
