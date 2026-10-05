"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/server/action";
import { runAction } from "@/server/auth/session";
import {
  annulDocumentDef,
  checkDocumentDuplicateDef,
  linkableDocumentsDef,
  registerIssuedDocumentDef,
  registerReceivedDocumentDef,
  updateDocumentInfoDef,
} from "./action-defs";

type State = ActionResult<unknown> | undefined;

export async function registerIssuedDocumentAction(_prev: State, fd: FormData) {
  const r = await runAction(registerIssuedDocumentDef, fd);
  if (r.ok) revalidatePath("/comprobantes-emitidos");
  return r;
}

export async function registerReceivedDocumentAction(_prev: State, fd: FormData) {
  const r = await runAction(registerReceivedDocumentDef, fd);
  if (r.ok) revalidatePath("/comprobantes-recibidos");
  return r;
}

export async function annulDocumentAction(_prev: State, fd: FormData) {
  const r = await runAction(annulDocumentDef, fd);
  if (r.ok) {
    revalidatePath("/comprobantes-emitidos");
    revalidatePath("/comprobantes-recibidos");
  }
  return r;
}

export async function updateDocumentInfoAction(_prev: State, fd: FormData) {
  const r = await runAction(updateDocumentInfoDef, fd);
  if (r.ok) {
    revalidatePath("/comprobantes-emitidos");
    revalidatePath("/comprobantes-recibidos");
  }
  return r;
}

/** Aviso inmediato de duplicado al completar tipo, punto de venta y número. */
export async function checkDocumentDuplicateAction(input: Record<string, unknown>) {
  return runAction(checkDocumentDuplicateDef, input);
}

/** Facturas y ND del tercero que una NC o ND puede vincular. */
export async function linkableDocumentsAction(input: { direction: "ISSUED" | "RECEIVED"; partyId: number }) {
  return runAction(linkableDocumentsDef, input);
}
