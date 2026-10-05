"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import type { ActionDef, ActionResult } from "@/server/action";
import { runAction } from "@/server/auth/session";
import {
  createClientDef,
  createSupplierDef,
  deactivateClientDef,
  deactivateSupplierDef,
  reactivateClientDef,
  reactivateSupplierDef,
  updateClientDef,
  updateSupplierDef,
} from "./action-defs";

type State = ActionResult<unknown> | undefined;

async function run<S extends z.ZodType, R>(def: ActionDef<S, R>, formData: FormData, path: string) {
  const r = await runAction(def, formData);
  if (r.ok) revalidatePath(path);
  return r;
}

export async function createClientAction(_prev: State, fd: FormData) {
  return run(createClientDef, fd, "/clientes");
}
export async function updateClientAction(_prev: State, fd: FormData) {
  return run(updateClientDef, fd, "/clientes");
}
export async function deactivateClientAction(_prev: State, fd: FormData) {
  return run(deactivateClientDef, fd, "/clientes");
}
export async function reactivateClientAction(_prev: State, fd: FormData) {
  return run(reactivateClientDef, fd, "/clientes");
}
export async function createSupplierAction(_prev: State, fd: FormData) {
  return run(createSupplierDef, fd, "/proveedores");
}
export async function updateSupplierAction(_prev: State, fd: FormData) {
  return run(updateSupplierDef, fd, "/proveedores");
}
export async function deactivateSupplierAction(_prev: State, fd: FormData) {
  return run(deactivateSupplierDef, fd, "/proveedores");
}
export async function reactivateSupplierAction(_prev: State, fd: FormData) {
  return run(reactivateSupplierDef, fd, "/proveedores");
}
