/**
 * Estructura común de los reportes (G.15). Cada reporte devuelve tablas con columnas tipadas; la
 * misma estructura se muestra en pantalla y se exporta a Excel y a PDF, así los tres formatos
 * tienen siempre las mismas cifras.
 *
 * Los importes viajan como texto con 2 decimales (calculados con decimal.js o NUMERIC en la base);
 * recién la exportación a Excel los convierte a número.
 */

export type ColumnType = "text" | "date" | "money" | "int";
export type CellValue = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Encabezado agrupador (por ejemplo "Vencido" sobre los tramos de antigüedad). */
  group?: string;
  /** Columna proyectada: se muestra atenuada y rotulada (flujo de fondos). */
  projected?: boolean;
}

export interface ReportRow {
  cells: Record<string, CellValue>;
  /** Enlace al detalle de origen (solo en pantalla). */
  href?: string;
  style?: "section" | "subtotal" | "total";
  /** Fila proyectada (atenuada). */
  projected?: boolean;
}

export interface ReportTable {
  title?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Fila de totales; la primera columna de texto lleva el rótulo. */
  totals?: Record<string, CellValue>;
  emptyMessage?: string;
}

export interface ReportResult {
  title: string;
  /** Descripción legible de los filtros aplicados (va en pantalla, Excel y PDF). */
  filters: string[];
  tables: ReportTable[];
  /** Aclaraciones y controles (por ejemplo, la conciliación con la cuenta corriente). */
  notes: string[];
  /** Nombre base del archivo exportado, sin extensión. */
  filename: string;
}
