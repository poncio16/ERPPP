import { defineAction } from "@/server/action";
import { AnnulDocumentSchema, CheckDuplicateSchema, LinkableSchema, RegisterDocumentSchema, UpdateDocumentInfoSchema } from "./schemas";
import { annulDocument, checkDuplicate, linkableDocuments, registerDocument, updateDocumentInfo } from "./service";

export const registerIssuedDocumentDef = defineAction({
  name: "documents.register_issued",
  permission: "documents.create",
  schema: RegisterDocumentSchema,
  handler: (db, ctx, input) => registerDocument(db, ctx, "ISSUED", input),
});

export const registerReceivedDocumentDef = defineAction({
  name: "documents.register_received",
  permission: "documents.create",
  schema: RegisterDocumentSchema,
  handler: (db, ctx, input) => registerDocument(db, ctx, "RECEIVED", input),
});

export const annulDocumentDef = defineAction({
  name: "documents.annul",
  permission: "documents.annul",
  schema: AnnulDocumentSchema,
  handler: (db, ctx, input) => annulDocument(db, ctx, input),
});

export const updateDocumentInfoDef = defineAction({
  name: "documents.update_info",
  permission: "documents.edit",
  schema: UpdateDocumentInfoSchema,
  handler: (db, ctx, input) => updateDocumentInfo(db, ctx, input),
});

export const checkDocumentDuplicateDef = defineAction({
  name: "documents.check_duplicate",
  permission: "documents.create",
  schema: CheckDuplicateSchema,
  handler: (db, ctx, input) => checkDuplicate(db, ctx, input),
});

export const linkableDocumentsDef = defineAction({
  name: "documents.linkable",
  permission: "documents.read",
  schema: LinkableSchema,
  handler: (db, ctx, input) => linkableDocuments(db, ctx, input.direction, input.partyId),
});
