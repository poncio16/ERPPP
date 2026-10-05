import { z } from "zod";
import { normalizeCbu } from "@/lib/cbu";
import { parseAmount, toMoneyString } from "@/lib/money";

export const PARTY_KINDS = ["client", "supplier"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

/** Texto opcional: "" se guarda como NULL. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo ${max} caracteres.` })
    .optional()
    .transform((v) => (v ? v : null));

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v ? Number(v) : null))
  .pipe(z.number().int().positive().nullable());

const requiredId = (message: string) => z.coerce.number({ error: message }).int().positive({ error: message });

const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.email({ error: "Correo electrónico inválido." }).nullable());

/** Límite de crédito: vacío = sin límite. Acepta "1.500.000,50". */
const optionalAmount = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v || v.trim() === "") return null;
    const d = parseAmount(v);
    const s = d && !d.isNegative() ? toMoneyString(d) : null;
    if (s === null) {
      ctx.addIssue({ code: "custom", message: "Importe inválido (use hasta 2 decimales, sin signo)." });
      return z.NEVER;
    }
    return s;
  });

const creditDays = z
  .string()
  .optional()
  .transform((v) => (v ? Number(v) : 0))
  .pipe(z.number({ error: "Ingrese un número de días." }).int({ error: "Ingrese un número entero de días." }).min(0, { error: "No puede ser negativo." }).max(3650));

export const PartyBaseSchema = z.object({
  legalName: z.string().trim().min(2, { error: "Ingrese la razón social o nombre." }).max(200),
  idTypeId: requiredId("Elija el tipo de identificación."),
  taxId: optionalText(20),
  vatConditionId: requiredId("Elija la condición frente al IVA."),
  address: optionalText(200),
  city: optionalText(100),
  provinceId: optionalId,
  postalCode: optionalText(10),
  phone: optionalText(60),
  email: optionalEmail,
  contactName: optionalText(120),
  paymentTermId: optionalId,
  creditDays,
  creditLimit: optionalAmount,
  notes: optionalText(2000),
  /** Solo se usa si ya existe otro registro con el mismo CUIT. */
  duplicateTaxIdReason: optionalText(300),
});

export const SupplierExtraSchema = z.object({
  activity: optionalText(120),
  bankId: optionalId,
  cbu: z
    .string()
    .optional()
    .transform((v) => (v ? normalizeCbu(v) : null)),
  cbuAlias: optionalText(20),
});

export const CreateClientSchema = PartyBaseSchema;
export const CreateSupplierSchema = PartyBaseSchema.extend(SupplierExtraSchema.shape);

const updateFields = { id: z.coerce.number().int().positive(), version: z.coerce.number().int().positive() };
export const UpdateClientSchema = CreateClientSchema.extend(updateFields);
export const UpdateSupplierSchema = CreateSupplierSchema.extend(updateFields);

export type ClientInput = z.output<typeof CreateClientSchema>;
export type SupplierInput = z.output<typeof CreateSupplierSchema>;
export type PartyInput = ClientInput & Partial<z.output<typeof SupplierExtraSchema>>;

export const DeactivatePartySchema = z.object({
  id: z.coerce.number().int().positive(),
  version: z.coerce.number().int().positive(),
  reason: z.string().trim().min(5, { error: "Indique el motivo de la baja (mínimo 5 caracteres)." }).max(300),
});

export const ReactivatePartySchema = z.object({
  id: z.coerce.number().int().positive(),
  version: z.coerce.number().int().positive(),
});

export const PartyListSchema = z.object({
  q: z.string().trim().max(100).optional().default(""),
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).optional().default("ACTIVE"),
  vatConditionId: optionalId,
  provinceId: optionalId,
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
});
export type PartyListQuery = z.output<typeof PartyListSchema>;
