import { defineAction } from "@/server/action";
import {
  CreateClientSchema,
  CreateSupplierSchema,
  DeactivatePartySchema,
  ReactivatePartySchema,
  UpdateClientSchema,
  UpdateSupplierSchema,
} from "./schemas";
import { createParty, deactivateParty, reactivateParty, updateParty } from "./service";

export const createClientDef = defineAction({
  name: "clients.create",
  permission: "clients.write",
  schema: CreateClientSchema,
  handler: (db, ctx, input) => createParty(db, ctx, "client", input),
});

export const updateClientDef = defineAction({
  name: "clients.update",
  permission: "clients.write",
  schema: UpdateClientSchema,
  handler: (db, ctx, input) => updateParty(db, ctx, "client", input),
});

export const deactivateClientDef = defineAction({
  name: "clients.deactivate",
  permission: "clients.deactivate",
  schema: DeactivatePartySchema,
  handler: (db, ctx, input) => deactivateParty(db, ctx, "client", input),
});

export const reactivateClientDef = defineAction({
  name: "clients.reactivate",
  permission: "clients.deactivate",
  schema: ReactivatePartySchema,
  handler: (db, ctx, input) => reactivateParty(db, ctx, "client", input),
});

export const createSupplierDef = defineAction({
  name: "suppliers.create",
  permission: "suppliers.write",
  schema: CreateSupplierSchema,
  handler: (db, ctx, input) => createParty(db, ctx, "supplier", input),
});

export const updateSupplierDef = defineAction({
  name: "suppliers.update",
  permission: "suppliers.write",
  schema: UpdateSupplierSchema,
  handler: (db, ctx, input) => updateParty(db, ctx, "supplier", input),
});

export const deactivateSupplierDef = defineAction({
  name: "suppliers.deactivate",
  permission: "suppliers.deactivate",
  schema: DeactivatePartySchema,
  handler: (db, ctx, input) => deactivateParty(db, ctx, "supplier", input),
});

export const reactivateSupplierDef = defineAction({
  name: "suppliers.reactivate",
  permission: "suppliers.deactivate",
  schema: ReactivatePartySchema,
  handler: (db, ctx, input) => reactivateParty(db, ctx, "supplier", input),
});
