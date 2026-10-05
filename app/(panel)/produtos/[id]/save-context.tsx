"use client";

import { createContext, useContext } from "react";

/** Erros por campo do último salvamento, para as variantes (que moram dentro do formulário do produto). */
export const FieldErrorsContext = createContext<Record<string, string> | undefined>(undefined);
export const useFieldErrors = () => useContext(FieldErrorsContext);
