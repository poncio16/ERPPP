import { defineAction } from "@/server/action";
import { AnnulOperationSchema, RegisterCollectionSchema } from "./schemas";
import { annulCollection, registerCollection } from "./service";

export const registerCollectionDef = defineAction({
  name: "collections.create",
  permission: "collections.create",
  schema: RegisterCollectionSchema,
  handler: (db, ctx, input) => registerCollection(db, ctx, input),
});

export const annulCollectionDef = defineAction({
  name: "collections.annul",
  permission: "collections.annul",
  schema: AnnulOperationSchema,
  handler: (db, ctx, input) => annulCollection(db, ctx, input),
});
