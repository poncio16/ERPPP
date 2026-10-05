/**
 * Catálogos base del ERP. Son valores de referencia configurables: el administrador puede
 * desactivarlos, renombrarlos o agregar nuevos. Ninguna regla fiscal queda escrita en el código.
 */
import type { DocumentClass, TaxKind } from "@/server/db/schema";

export const VAT_CONDITIONS: { code: string; name: string; arcaCode: number }[] = [
  { code: "RI", name: "IVA Responsable Inscripto", arcaCode: 1 },
  { code: "NR", name: "IVA No Responsable", arcaCode: 3 },
  { code: "EX", name: "IVA Sujeto Exento", arcaCode: 4 },
  { code: "CF", name: "Consumidor Final", arcaCode: 5 },
  { code: "MT", name: "Responsable Monotributo", arcaCode: 6 },
  { code: "NC", name: "Sujeto No Categorizado", arcaCode: 7 },
  { code: "PE", name: "Proveedor del Exterior", arcaCode: 8 },
  { code: "CE", name: "Cliente del Exterior", arcaCode: 9 },
  { code: "LIB", name: "IVA Liberado – Ley 19.640", arcaCode: 10 },
  { code: "MS", name: "Monotributista Social", arcaCode: 13 },
  { code: "NA", name: "IVA No Alcanzado", arcaCode: 15 },
  { code: "MTP", name: "Monotributo Trabajador Independiente Promovido", arcaCode: 16 },
];

export const ID_TYPES: { code: string; name: string; arcaCode: number; requiresCuit: boolean }[] = [
  { code: "CUIT", name: "CUIT", arcaCode: 80, requiresCuit: true },
  { code: "CUIL", name: "CUIL", arcaCode: 86, requiresCuit: true },
  { code: "CDI", name: "CDI", arcaCode: 87, requiresCuit: true },
  { code: "DNI", name: "DNI", arcaCode: 96, requiresCuit: false },
  { code: "PAS", name: "Pasaporte", arcaCode: 94, requiresCuit: false },
  { code: "EXT", name: "Identificación fiscal extranjera", arcaCode: 91, requiresCuit: false },
  { code: "SIN", name: "Sin identificar", arcaCode: 99, requiresCuit: false },
];

export const PROVINCES: { code: string; name: string; arcaCode: number; jurisdiction: number }[] = [
  { code: "CABA", name: "Ciudad Autónoma de Buenos Aires", arcaCode: 0, jurisdiction: 901 },
  { code: "BA", name: "Buenos Aires", arcaCode: 1, jurisdiction: 902 },
  { code: "CAT", name: "Catamarca", arcaCode: 2, jurisdiction: 903 },
  { code: "COR", name: "Córdoba", arcaCode: 3, jurisdiction: 904 },
  { code: "CTE", name: "Corrientes", arcaCode: 4, jurisdiction: 905 },
  { code: "ER", name: "Entre Ríos", arcaCode: 5, jurisdiction: 908 },
  { code: "JUJ", name: "Jujuy", arcaCode: 6, jurisdiction: 910 },
  { code: "MZA", name: "Mendoza", arcaCode: 7, jurisdiction: 913 },
  { code: "LR", name: "La Rioja", arcaCode: 8, jurisdiction: 912 },
  { code: "SAL", name: "Salta", arcaCode: 9, jurisdiction: 917 },
  { code: "SJ", name: "San Juan", arcaCode: 10, jurisdiction: 918 },
  { code: "SL", name: "San Luis", arcaCode: 11, jurisdiction: 919 },
  { code: "SF", name: "Santa Fe", arcaCode: 12, jurisdiction: 921 },
  { code: "SE", name: "Santiago del Estero", arcaCode: 13, jurisdiction: 922 },
  { code: "TUC", name: "Tucumán", arcaCode: 14, jurisdiction: 924 },
  { code: "CHA", name: "Chaco", arcaCode: 16, jurisdiction: 906 },
  { code: "CHU", name: "Chubut", arcaCode: 17, jurisdiction: 907 },
  { code: "FOR", name: "Formosa", arcaCode: 18, jurisdiction: 909 },
  { code: "MIS", name: "Misiones", arcaCode: 19, jurisdiction: 914 },
  { code: "NQN", name: "Neuquén", arcaCode: 20, jurisdiction: 915 },
  { code: "LP", name: "La Pampa", arcaCode: 21, jurisdiction: 911 },
  { code: "RN", name: "Río Negro", arcaCode: 22, jurisdiction: 916 },
  { code: "SC", name: "Santa Cruz", arcaCode: 23, jurisdiction: 920 },
  { code: "TDF", name: "Tierra del Fuego", arcaCode: 24, jurisdiction: 923 },
];

export const PAYMENT_TERMS: { code: string; name: string; days: number }[] = [
  { code: "CONTADO", name: "Contado", days: 0 },
  { code: "15D", name: "15 días", days: 15 },
  { code: "30D", name: "30 días", days: 30 },
  { code: "45D", name: "45 días", days: 45 },
  { code: "60D", name: "60 días", days: 60 },
  { code: "90D", name: "90 días", days: 90 },
];

interface DocTypeSeed {
  code: string;
  name: string;
  arcaCode: number | null;
  letter: string | null;
  class: DocumentClass;
  isFce?: boolean;
  isFiscal?: boolean;
  allowedIssued: boolean;
  allowedReceived: boolean;
  vatCreditable: boolean;
}

const fiscal = (
  arcaCode: number,
  code: string,
  name: string,
  letter: string,
  cls: DocumentClass,
  issued: boolean,
  vatCreditable: boolean,
  isFce = false,
): DocTypeSeed => ({
  code,
  name,
  arcaCode,
  letter,
  class: cls,
  isFce,
  allowedIssued: issued,
  allowedReceived: true,
  vatCreditable,
});

export const DOCUMENT_TYPES: DocTypeSeed[] = [
  fiscal(1, "FA", "Factura A", "A", "INVOICE", true, true),
  fiscal(2, "NDA", "Nota de Débito A", "A", "DEBIT_NOTE", true, true),
  fiscal(3, "NCA", "Nota de Crédito A", "A", "CREDIT_NOTE", true, true),
  fiscal(6, "FB", "Factura B", "B", "INVOICE", true, false),
  fiscal(7, "NDB", "Nota de Débito B", "B", "DEBIT_NOTE", true, false),
  fiscal(8, "NCB", "Nota de Crédito B", "B", "CREDIT_NOTE", true, false),
  fiscal(11, "FC", "Factura C", "C", "INVOICE", false, false),
  fiscal(12, "NDC", "Nota de Débito C", "C", "DEBIT_NOTE", false, false),
  fiscal(13, "NCC", "Nota de Crédito C", "C", "CREDIT_NOTE", false, false),
  fiscal(19, "FE", "Factura E", "E", "INVOICE", true, false),
  fiscal(20, "NDE", "Nota de Débito E", "E", "DEBIT_NOTE", true, false),
  fiscal(21, "NCE", "Nota de Crédito E", "E", "CREDIT_NOTE", true, false),
  fiscal(201, "FCEA", "Factura de Crédito Electrónica MiPyME A", "A", "INVOICE", true, true, true),
  fiscal(202, "NDFCEA", "Nota de Débito Electrónica MiPyME A", "A", "DEBIT_NOTE", true, true, true),
  fiscal(203, "NCFCEA", "Nota de Crédito Electrónica MiPyME A", "A", "CREDIT_NOTE", true, true, true),
  fiscal(206, "FCEB", "Factura de Crédito Electrónica MiPyME B", "B", "INVOICE", true, false, true),
  fiscal(207, "NDFCEB", "Nota de Débito Electrónica MiPyME B", "B", "DEBIT_NOTE", true, false, true),
  fiscal(208, "NCFCEB", "Nota de Crédito Electrónica MiPyME B", "B", "CREDIT_NOTE", true, false, true),
  fiscal(211, "FCEC", "Factura de Crédito Electrónica MiPyME C", "C", "INVOICE", false, false, true),
  fiscal(212, "NDFCEC", "Nota de Débito Electrónica MiPyME C", "C", "DEBIT_NOTE", false, false, true),
  fiscal(213, "NCFCEC", "Nota de Crédito Electrónica MiPyME C", "C", "CREDIT_NOTE", false, false, true),
  // Internos (no fiscales): punto de venta 0, numeración propia.
  {
    code: "INT_SALDO_DEUDOR",
    name: "Saldo inicial deudor (interno)",
    arcaCode: null,
    letter: null,
    class: "OPENING_DEBIT",
    isFiscal: false,
    allowedIssued: true,
    allowedReceived: true,
    vatCreditable: false,
  },
  {
    code: "INT_SALDO_ACREEDOR",
    name: "Saldo inicial acreedor (interno)",
    arcaCode: null,
    letter: null,
    class: "OPENING_CREDIT",
    isFiscal: false,
    allowedIssued: true,
    allowedReceived: true,
    vatCreditable: false,
  },
  {
    code: "INT_CHEQUE_RECHAZADO",
    name: "Débito por cheque rechazado (interno)",
    arcaCode: null,
    letter: null,
    class: "INTERNAL_DEBIT",
    isFiscal: false,
    allowedIssued: true,
    allowedReceived: true,
    vatCreditable: false,
  },
  {
    code: "INT_DEVOLUCION",
    name: "Devolución de saldo a favor (interno)",
    arcaCode: null,
    letter: null,
    class: "INTERNAL_DEBIT",
    isFiscal: false,
    allowedIssued: true,
    allowedReceived: true,
    vatCreditable: false,
  },
];

export const TAXES: { code: string; name: string; kind: TaxKind; rate: string | null; arcaCode: number | null }[] = [
  { code: "IVA_0", name: "IVA 0%", kind: "VAT", rate: "0", arcaCode: 3 },
  { code: "IVA_2_5", name: "IVA 2,5%", kind: "VAT", rate: "2.5", arcaCode: 9 },
  { code: "IVA_5", name: "IVA 5%", kind: "VAT", rate: "5", arcaCode: 8 },
  { code: "IVA_10_5", name: "IVA 10,5%", kind: "VAT", rate: "10.5", arcaCode: 4 },
  { code: "IVA_21", name: "IVA 21%", kind: "VAT", rate: "21", arcaCode: 5 },
  { code: "IVA_27", name: "IVA 27%", kind: "VAT", rate: "27", arcaCode: 6 },
  { code: "PERC_IVA", name: "Percepción de IVA", kind: "PERCEPTION", rate: null, arcaCode: null },
  { code: "PERC_IIBB", name: "Percepción de Ingresos Brutos", kind: "PERCEPTION", rate: null, arcaCode: null },
  { code: "PERC_GAN", name: "Percepción de Ganancias", kind: "PERCEPTION", rate: null, arcaCode: null },
  { code: "PERC_MUNI", name: "Percepción municipal", kind: "PERCEPTION", rate: null, arcaCode: null },
  { code: "IMP_INTERNOS", name: "Impuestos internos", kind: "OTHER_TAX", rate: null, arcaCode: null },
  { code: "OTROS_TRIB", name: "Otros tributos", kind: "OTHER_TAX", rate: null, arcaCode: null },
  { code: "RET_IVA", name: "Retención de IVA", kind: "RETENTION", rate: null, arcaCode: null },
  { code: "RET_GAN", name: "Retención de Ganancias", kind: "RETENTION", rate: null, arcaCode: null },
  { code: "RET_IIBB", name: "Retención de Ingresos Brutos", kind: "RETENTION", rate: null, arcaCode: null },
  { code: "RET_SUSS", name: "Retención SUSS", kind: "RETENTION", rate: null, arcaCode: null },
];

export const TREASURY_CONCEPTS: { code: string; name: string; direction: "IN" | "OUT" | "BOTH"; allowsManual: boolean }[] = [
  { code: "SALDO_INICIAL", name: "Saldo inicial", direction: "BOTH", allowsManual: false },
  { code: "COBRANZA", name: "Cobranza", direction: "IN", allowsManual: false },
  { code: "PAGO", name: "Pago a proveedor", direction: "OUT", allowsManual: false },
  { code: "CHEQUE_ACREDITADO", name: "Acreditación de cheque", direction: "IN", allowsManual: false },
  { code: "CHEQUE_DEBITADO", name: "Débito de cheque propio", direction: "OUT", allowsManual: false },
  { code: "CHEQUE_RECHAZADO", name: "Rechazo de cheque acreditado", direction: "OUT", allowsManual: false },
  { code: "TRANSFERENCIA_INTERNA", name: "Transferencia entre cuentas propias", direction: "BOTH", allowsManual: false },
  { code: "DEVOLUCION", name: "Devolución de saldo a favor", direction: "BOTH", allowsManual: false },
  { code: "DIFERENCIA_ARQUEO", name: "Diferencia de arqueo", direction: "BOTH", allowsManual: false },
  { code: "REVERSION", name: "Reversión", direction: "BOTH", allowsManual: false },
  { code: "GASTOS_BANCARIOS", name: "Gastos y comisiones bancarias", direction: "OUT", allowsManual: true },
  { code: "IMP_DEB_CRED", name: "Impuesto a los débitos y créditos bancarios", direction: "OUT", allowsManual: true },
  { code: "INTERESES_GANADOS", name: "Intereses ganados", direction: "IN", allowsManual: true },
  { code: "INTERESES_PAGADOS", name: "Intereses pagados", direction: "OUT", allowsManual: true },
  { code: "APORTE", name: "Aporte de socios", direction: "IN", allowsManual: true },
  { code: "RETIRO", name: "Retiro de socios", direction: "OUT", allowsManual: true },
  { code: "GASTOS_MENORES", name: "Gastos menores sin comprobante", direction: "OUT", allowsManual: true },
  { code: "OTROS_INGRESOS", name: "Otros ingresos", direction: "IN", allowsManual: true },
  { code: "OTROS_EGRESOS", name: "Otros egresos", direction: "OUT", allowsManual: true },
];

/** Entidades bancarias con su código BCRA (valor de referencia, editable). */
export const BANKS: { code: string; name: string }[] = [
  { code: "007", name: "Banco de Galicia y Buenos Aires" },
  { code: "011", name: "Banco de la Nación Argentina" },
  { code: "014", name: "Banco de la Provincia de Buenos Aires" },
  { code: "015", name: "Industrial and Commercial Bank of China (ICBC)" },
  { code: "017", name: "Banco BBVA Argentina" },
  { code: "020", name: "Banco de la Provincia de Córdoba" },
  { code: "027", name: "Banco Supervielle" },
  { code: "029", name: "Banco de la Ciudad de Buenos Aires" },
  { code: "034", name: "Banco Patagonia" },
  { code: "044", name: "Banco Hipotecario" },
  { code: "072", name: "Banco Santander Argentina" },
  { code: "150", name: "HSBC Bank Argentina" },
  { code: "191", name: "Banco Credicoop Cooperativo Limitado" },
  { code: "285", name: "Banco Macro" },
  { code: "299", name: "Banco Comafi" },
  { code: "322", name: "Banco Industrial" },
  { code: "330", name: "Nuevo Banco de Santa Fe" },
  { code: "386", name: "Nuevo Banco de Entre Ríos" },
];

export const NUMBERING_SEQUENCES: { key: string; prefix: string; padding: number }[] = [
  { key: "RECEIPT", prefix: "R-", padding: 8 },
  { key: "PAYMENT_ORDER", prefix: "OP-", padding: 8 },
  { key: "CLIENT_CODE", prefix: "C", padding: 5 },
  { key: "SUPPLIER_CODE", prefix: "P", padding: 5 },
  { key: "INTERNAL_DOC", prefix: "", padding: 8 },
];

/** Parámetros configurables con su valor por defecto (decisiones aprobadas D4, D11, etc.). */
export const CONFIGURATION: { key: string; value: unknown; description: string }[] = [
  { key: "vat_tolerance_per_rate", value: "0.10", description: "Tolerancia entre IVA ingresado y base × alícuota, por alícuota (D4)" },
  { key: "locked_until_date", value: null, description: "Fecha hasta la cual el período está bloqueado (no admite registros ni anulaciones)" },
  { key: "allow_duplicate_tax_id", value: true, description: "Permite un segundo tercero con el mismo CUIT si se indica el motivo" },
  { key: "cash_allow_negative", value: false, description: "Permite que un egreso deje la caja en negativo" },
  { key: "due_soon_days", value: 7, description: "Días de anticipación para alertar vencimientos" },
  { key: "session_idle_minutes", value: 30, description: "Minutos de inactividad hasta cerrar la sesión" },
  { key: "session_absolute_hours", value: 12, description: "Duración máxima de una sesión en horas" },
  { key: "login_max_attempts", value: 5, description: "Intentos fallidos antes de bloquear temporalmente al usuario" },
  { key: "login_lock_minutes", value: 15, description: "Minutos de bloqueo tras superar los intentos fallidos" },
  { key: "password_min_length", value: 12, description: "Longitud mínima de contraseña" },
  {
    key: "backup_retention",
    value: { daily: 7, weekly: 4, monthly: 12 },
    description: "Cantidad de backups a conservar por frecuencia",
  },
  {
    key: "letter_vat_matrix",
    value: {
      mode: "WARN",
      issued: { A: ["RI", "MT", "MS", "MTP"], B: ["CF", "EX", "NR", "NC", "NA", "LIB"], E: ["CE"] },
    },
    description: "Letra esperada según condición IVA del cliente; WARN advierte, BLOCK impide (D11)",
  },
];
