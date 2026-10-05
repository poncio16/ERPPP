"use client";

import { buttonClass } from "./index";

/** Imprime la página actual (la hoja oculta menú y botones con la clase `no-print`). */
export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return (
    <button type="button" className={buttonClass("secondary")} onClick={() => window.print()}>
      {label}
    </button>
  );
}
