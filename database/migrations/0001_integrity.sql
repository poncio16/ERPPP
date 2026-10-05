-- ════════════════════════════════════════════════════════════════════════════
-- Integridad financiera: FKs adicionales, inmutabilidad, borrado prohibido,
-- restricciones diferidas de consistencia, máquinas de estado de cheques,
-- cadena de hashes de auditoría, vistas y permisos de roles.
-- ════════════════════════════════════════════════════════════════════════════

-- FKs que no se declaran en Drizzle para evitar importaciones circulares entre módulos.
ALTER TABLE treasury_movements
  ADD CONSTRAINT fk_treasury_collection_line FOREIGN KEY (collection_line_id) REFERENCES collection_lines(id),
  ADD CONSTRAINT fk_treasury_payment_line FOREIGN KEY (payment_line_id) REFERENCES payment_lines(id),
  ADD CONSTRAINT fk_treasury_refund FOREIGN KEY (refund_id) REFERENCES refunds(id);
--> statement-breakpoint

-- ─────────────────────────── Borrado físico prohibido ───────────────────────────
CREATE FUNCTION erp_forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'No se permite eliminar registros de %: use anulación o reversión', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','roles','permissions','clients','suppliers',
    'documents','document_relations',
    'customer_account_entries','supplier_account_entries',
    'collections','collection_lines','supplier_payments','payment_lines',
    'allocations','receipts','payment_orders','refunds',
    'received_checks','issued_checks','check_events',
    'treasury_movements','account_transfers','cash_closures',
    'cash_boxes','bank_accounts','audit_log','backup_runs','numbering_sequences'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_no_delete BEFORE DELETE ON %1$I FOR EACH ROW EXECUTE FUNCTION erp_forbid_delete()', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_no_truncate BEFORE TRUNCATE ON %1$I FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_delete()', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Las líneas tributarias e ítems solo se pueden reemplazar mientras el comprobante
-- no tenga imputaciones y no esté anulado (edición de un comprobante sin movimientos).
CREATE FUNCTION erp_guard_document_detail_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d documents%ROWTYPE;
BEGIN
  SELECT * INTO d FROM documents WHERE id = OLD.document_id;
  IF d.status = 'ANNULLED' OR EXISTS (
       SELECT 1 FROM allocations a
        WHERE a.status = 'ACTIVE' AND (a.target_document_id = d.id OR a.source_document_id = d.id)) THEN
    RAISE EXCEPTION 'No se puede modificar el detalle de un comprobante anulado o con imputaciones (id %)', d.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_document_tax_lines_guard_delete BEFORE DELETE ON document_tax_lines
  FOR EACH ROW EXECUTE FUNCTION erp_guard_document_detail_delete();
--> statement-breakpoint
CREATE TRIGGER trg_document_items_guard_delete BEFORE DELETE ON document_items
  FOR EACH ROW EXECUTE FUNCTION erp_guard_document_detail_delete();
--> statement-breakpoint

-- ─────────────────────────── Libros inmutables ───────────────────────────
CREATE FUNCTION erp_forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los registros de % son inmutables: use una reversión', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'treasury_movements','customer_account_entries','supplier_account_entries',
    'check_events','collection_lines','payment_lines','document_relations',
    'cash_closures','audit_log'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_no_update BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION erp_forbid_update()', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Imputaciones: solo se permite pasar de ACTIVE a REVERSED completando los datos de la reversión.
CREATE FUNCTION erp_guard_allocation_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'ACTIVE' OR NEW.status <> 'REVERSED'
     OR (NEW.ledger, NEW.target_document_id, NEW.source_kind, NEW.source_collection_id, NEW.source_payment_id,
         NEW.source_document_id, NEW.amount, NEW.allocation_date, NEW.created_at, NEW.created_by)
        IS DISTINCT FROM
        (OLD.ledger, OLD.target_document_id, OLD.source_kind, OLD.source_collection_id, OLD.source_payment_id,
         OLD.source_document_id, OLD.amount, OLD.allocation_date, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'Una imputación solo puede revertirse; sus datos son inmutables (id %)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_allocations_guard_update BEFORE UPDATE ON allocations
  FOR EACH ROW EXECUTE FUNCTION erp_guard_allocation_update();
--> statement-breakpoint

-- Cobranzas y pagos: tercero, fecha, total y clave de idempotencia son inmutables;
-- una operación anulada ya no cambia.
CREATE FUNCTION erp_guard_operation_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'ANNULLED' THEN
    RAISE EXCEPTION 'La operación % está anulada y no puede modificarse', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_TABLE_NAME = 'collections' THEN
    IF (NEW.client_id, NEW.collection_date) IS DISTINCT FROM (OLD.client_id, OLD.collection_date) THEN
      RAISE EXCEPTION 'No se puede cambiar el cliente ni la fecha de una cobranza' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    IF (NEW.supplier_id, NEW.payment_date) IS DISTINCT FROM (OLD.supplier_id, OLD.payment_date) THEN
      RAISE EXCEPTION 'No se puede cambiar el proveedor ni la fecha de un pago' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF (NEW.total_amount, NEW.idempotency_key, NEW.created_at, NEW.created_by)
     IS DISTINCT FROM (OLD.total_amount, OLD.idempotency_key, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'El importe y la identificación de la operación son inmutables' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_collections_guard_update BEFORE UPDATE ON collections
  FOR EACH ROW EXECUTE FUNCTION erp_guard_operation_update();
--> statement-breakpoint
CREATE TRIGGER trg_supplier_payments_guard_update BEFORE UPDATE ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION erp_guard_operation_update();
--> statement-breakpoint

-- Recibos y órdenes de pago: solo pueden anularse.
CREATE FUNCTION erp_guard_internal_doc_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'ACTIVE' OR NEW.status <> 'ANNULLED' OR NEW.annulled_at IS NULL
     OR (NEW.number, NEW.issue_date, NEW.party_name, NEW.party_tax_id, NEW.amount, NEW.amount_in_words)
        IS DISTINCT FROM (OLD.number, OLD.issue_date, OLD.party_name, OLD.party_tax_id, OLD.amount, OLD.amount_in_words) THEN
    RAISE EXCEPTION 'Los documentos internos (%) solo pueden anularse', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_receipts_guard_update BEFORE UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION erp_guard_internal_doc_update();
--> statement-breakpoint
CREATE TRIGGER trg_payment_orders_guard_update BEFORE UPDATE ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION erp_guard_internal_doc_update();
--> statement-breakpoint

-- ─────────────────────────── Comprobantes ───────────────────────────
CREATE FUNCTION erp_document_class(p_document_id bigint) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT dt.class FROM documents d JOIN document_types dt ON dt.id = d.document_type_id WHERE d.id = p_document_id
$$;
--> statement-breakpoint

CREATE FUNCTION erp_guard_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dt document_types%ROWTYPE;
BEGIN
  SELECT * INTO dt FROM document_types WHERE id = NEW.document_type_id;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'ANNULLED' THEN
      RAISE EXCEPTION 'El comprobante % está anulado y no puede modificarse', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    IF (NEW.direction, NEW.idempotency_key, NEW.created_at, NEW.created_by, NEW.origin)
       IS DISTINCT FROM (OLD.direction, OLD.idempotency_key, OLD.created_at, OLD.created_by, OLD.origin) THEN
      RAISE EXCEPTION 'Datos de origen del comprobante inmutables' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.direction = 'ISSUED' AND NOT dt.allowed_issued THEN
    RAISE EXCEPTION 'El tipo de comprobante "%" no se admite en comprobantes emitidos', dt.name USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.direction = 'RECEIVED' AND NOT dt.allowed_received THEN
    RAISE EXCEPTION 'El tipo de comprobante "%" no se admite en comprobantes recibidos', dt.name USING ERRCODE = 'check_violation';
  END IF;
  IF dt.is_fiscal AND NEW.point_of_sale < 1 THEN
    RAISE EXCEPTION 'Un comprobante fiscal requiere punto de venta entre 1 y 99999' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT dt.is_fiscal AND NEW.point_of_sale <> 0 THEN
    RAISE EXCEPTION 'Los comprobantes internos usan punto de venta 0' USING ERRCODE = 'check_violation';
  END IF;
  IF dt.class IN ('CREDIT_NOTE','DEBIT_NOTE','INTERNAL_DEBIT') AND coalesce(btrim(NEW.reason), '') = '' THEN
    RAISE EXCEPTION 'Las notas de crédito, notas de débito y débitos internos requieren motivo' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.direction = 'RECEIVED' AND NOT dt.vat_creditable AND NEW.vat_total <> 0 THEN
    RAISE EXCEPTION 'El tipo "%" recibido no discrimina IVA', dt.name USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_documents_guard BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION erp_guard_document();
--> statement-breakpoint

-- Restricción diferida: la cabecera debe coincidir con sus líneas tributarias e ítems.
CREATE FUNCTION erp_check_document_totals(p_document_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  d documents%ROWTYPE;
  v_base numeric; v_vat numeric; v_perc numeric; v_other numeric; v_items numeric; v_item_count int;
BEGIN
  SELECT * INTO d FROM documents WHERE id = p_document_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(sum(base_amount) FILTER (WHERE kind = 'VAT'), 0),
         coalesce(sum(amount) FILTER (WHERE kind = 'VAT'), 0),
         coalesce(sum(amount) FILTER (WHERE kind = 'PERCEPTION'), 0),
         coalesce(sum(amount) FILTER (WHERE kind = 'OTHER_TAX'), 0)
    INTO v_base, v_vat, v_perc, v_other
    FROM document_tax_lines WHERE document_id = p_document_id;
  IF d.net_taxed <> v_base OR d.vat_total <> v_vat OR d.perceptions_total <> v_perc OR d.other_taxes_total <> v_other THEN
    RAISE EXCEPTION 'Comprobante %: la cabecera no coincide con el detalle tributario (neto gravado % vs %, IVA % vs %, percepciones % vs %, otros % vs %)',
      p_document_id, d.net_taxed, v_base, d.vat_total, v_vat, d.perceptions_total, v_perc, d.other_taxes_total, v_other
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*), coalesce(sum(amount), 0) INTO v_item_count, v_items FROM document_items WHERE document_id = p_document_id;
  IF v_item_count > 0 AND v_items <> d.net_taxed + d.net_untaxed + d.net_exempt THEN
    RAISE EXCEPTION 'Comprobante %: la suma de ítems (%) no coincide con los netos (%)',
      p_document_id, v_items, d.net_taxed + d.net_untaxed + d.net_exempt USING ERRCODE = 'check_violation';
  END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION erp_trg_document_totals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'documents' THEN
    PERFORM erp_check_document_totals(NEW.id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM erp_check_document_totals(OLD.document_id);
  ELSE
    PERFORM erp_check_document_totals(NEW.document_id);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_documents_totals AFTER INSERT OR UPDATE ON documents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_trg_document_totals();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_document_tax_lines_totals AFTER INSERT OR UPDATE OR DELETE ON document_tax_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_trg_document_totals();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_document_items_totals AFTER INSERT OR UPDATE OR DELETE ON document_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_trg_document_totals();
--> statement-breakpoint

-- Líneas tributarias: el tipo debe coincidir con el catálogo; IVA con la alícuota del catálogo.
CREATE FUNCTION erp_guard_tax_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tc tax_catalog%ROWTYPE;
BEGIN
  SELECT * INTO tc FROM tax_catalog WHERE id = NEW.tax_id;
  IF tc.kind <> NEW.kind THEN
    RAISE EXCEPTION 'La línea tributaria declara tipo % pero el impuesto % es %', NEW.kind, tc.code, tc.kind USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'VAT' AND NEW.rate <> tc.rate THEN
    RAISE EXCEPTION 'La alícuota de la línea (%) no coincide con la del catálogo (%)', NEW.rate, tc.rate USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_document_tax_lines_guard BEFORE INSERT OR UPDATE ON document_tax_lines
  FOR EACH ROW EXECUTE FUNCTION erp_guard_tax_line();
--> statement-breakpoint

-- NC/ND/débito interno vinculados a un original del mismo tercero y dirección.
CREATE FUNCTION erp_guard_document_relation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a documents%ROWTYPE; b documents%ROWTYPE;
BEGIN
  SELECT * INTO a FROM documents WHERE id = NEW.document_id;
  SELECT * INTO b FROM documents WHERE id = NEW.related_document_id;
  IF a.direction <> b.direction
     OR a.client_id IS DISTINCT FROM b.client_id
     OR a.supplier_id IS DISTINCT FROM b.supplier_id THEN
    RAISE EXCEPTION 'Solo se pueden vincular comprobantes del mismo tercero y del mismo circuito' USING ERRCODE = 'check_violation';
  END IF;
  IF erp_document_class(NEW.document_id) NOT IN ('CREDIT_NOTE','DEBIT_NOTE','INTERNAL_DEBIT') THEN
    RAISE EXCEPTION 'Solo NC, ND o débitos internos pueden vincularse a un comprobante original' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_document_relations_guard BEFORE INSERT ON document_relations
  FOR EACH ROW EXECUTE FUNCTION erp_guard_document_relation();
--> statement-breakpoint

-- ─────────────────────────── Imputaciones ───────────────────────────
CREATE FUNCTION erp_guard_allocation_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tgt documents%ROWTYPE; src documents%ROWTYPE;
  v_client bigint; v_supplier bigint; v_status text;
BEGIN
  SELECT * INTO tgt FROM documents WHERE id = NEW.target_document_id;
  IF tgt.status = 'ANNULLED' THEN
    RAISE EXCEPTION 'No se puede imputar a un comprobante anulado' USING ERRCODE = 'check_violation';
  END IF;
  IF erp_document_class(tgt.id) NOT IN ('INVOICE','DEBIT_NOTE','INTERNAL_DEBIT','OPENING_DEBIT') THEN
    RAISE EXCEPTION 'El comprobante destino de una imputación debe ser deudor (factura, ND o débito)' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.ledger = 'AR') <> (tgt.direction = 'ISSUED') THEN
    RAISE EXCEPTION 'El circuito de la imputación no coincide con el del comprobante' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.source_kind = 'COLLECTION' THEN
    SELECT client_id, status INTO v_client, v_status FROM collections WHERE id = NEW.source_collection_id;
    IF v_client IS DISTINCT FROM tgt.client_id THEN
      RAISE EXCEPTION 'La cobranza y el comprobante pertenecen a clientes distintos' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.source_kind = 'PAYMENT' THEN
    SELECT supplier_id, status INTO v_supplier, v_status FROM supplier_payments WHERE id = NEW.source_payment_id;
    IF v_supplier IS DISTINCT FROM tgt.supplier_id THEN
      RAISE EXCEPTION 'El pago y el comprobante pertenecen a proveedores distintos' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO src FROM documents WHERE id = NEW.source_document_id;
    v_status := CASE WHEN src.status = 'ANNULLED' THEN 'ANNULLED' ELSE 'ACTIVE' END;
    IF erp_document_class(src.id) NOT IN ('CREDIT_NOTE','OPENING_CREDIT') THEN
      RAISE EXCEPTION 'El crédito imputado debe ser una NC o un saldo inicial acreedor' USING ERRCODE = 'check_violation';
    END IF;
    IF src.direction <> tgt.direction OR src.client_id IS DISTINCT FROM tgt.client_id
       OR src.supplier_id IS DISTINCT FROM tgt.supplier_id THEN
      RAISE EXCEPTION 'La NC y el comprobante deben ser del mismo tercero y circuito' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF v_status = 'ANNULLED' THEN
    RAISE EXCEPTION 'No se puede imputar un crédito anulado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_allocations_guard_insert BEFORE INSERT ON allocations
  FOR EACH ROW EXECUTE FUNCTION erp_guard_allocation_insert();
--> statement-breakpoint

-- Restricción diferida: los saldos cacheados deben ser exactamente total − imputaciones activas.
CREATE FUNCTION erp_check_document_balance(p_document_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d documents%ROWTYPE; v_class text; v_applied numeric;
BEGIN
  SELECT * INTO d FROM documents WHERE id = p_document_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_class := erp_document_class(p_document_id);
  IF v_class IN ('CREDIT_NOTE','OPENING_CREDIT') THEN
    SELECT coalesce(sum(amount), 0) INTO v_applied FROM allocations
     WHERE source_document_id = p_document_id AND status = 'ACTIVE';
  ELSE
    SELECT coalesce(sum(amount), 0) INTO v_applied FROM allocations
     WHERE target_document_id = p_document_id AND status = 'ACTIVE';
  END IF;
  IF d.status = 'ANNULLED' THEN
    IF v_applied <> 0 THEN
      RAISE EXCEPTION 'Comprobante % anulado con imputaciones activas', p_document_id USING ERRCODE = 'check_violation';
    END IF;
  ELSIF d.balance <> d.total - v_applied THEN
    RAISE EXCEPTION 'Comprobante %: saldo % no coincide con total % menos imputaciones %',
      p_document_id, d.balance, d.total, v_applied USING ERRCODE = 'check_violation';
  END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION erp_check_operation_balance(p_table text, p_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_total numeric; v_unapplied numeric; v_status text; v_applied numeric; v_lines numeric;
BEGIN
  IF p_table = 'collections' THEN
    SELECT total_amount, unapplied_amount, status INTO v_total, v_unapplied, v_status FROM collections WHERE id = p_id;
    SELECT coalesce(sum(amount), 0) INTO v_applied FROM allocations WHERE source_collection_id = p_id AND status = 'ACTIVE';
    SELECT coalesce(sum(amount), 0) INTO v_lines FROM collection_lines WHERE collection_id = p_id;
  ELSE
    SELECT total_amount, unapplied_amount, status INTO v_total, v_unapplied, v_status FROM supplier_payments WHERE id = p_id;
    SELECT coalesce(sum(amount), 0) INTO v_applied FROM allocations WHERE source_payment_id = p_id AND status = 'ACTIVE';
    SELECT coalesce(sum(amount), 0) INTO v_lines FROM payment_lines WHERE payment_id = p_id;
  END IF;
  IF v_total IS NULL THEN RETURN; END IF;
  IF v_lines <> v_total THEN
    RAISE EXCEPTION 'Operación % %: la suma de medios (%) no coincide con el total (%)', p_table, p_id, v_lines, v_total
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_status = 'ANNULLED' THEN
    IF v_applied <> 0 THEN
      RAISE EXCEPTION 'Operación % % anulada con imputaciones activas', p_table, p_id USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_unapplied <> v_total - v_applied THEN
    RAISE EXCEPTION 'Operación % %: saldo sin imputar % no coincide con total % menos imputaciones %',
      p_table, p_id, v_unapplied, v_total, v_applied USING ERRCODE = 'check_violation';
  END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION erp_trg_balances() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  IF TG_TABLE_NAME = 'allocations' THEN
    PERFORM erp_check_document_balance(NEW.target_document_id);
    IF NEW.source_document_id IS NOT NULL THEN PERFORM erp_check_document_balance(NEW.source_document_id); END IF;
    IF NEW.source_collection_id IS NOT NULL THEN PERFORM erp_check_operation_balance('collections', NEW.source_collection_id); END IF;
    IF NEW.source_payment_id IS NOT NULL THEN PERFORM erp_check_operation_balance('supplier_payments', NEW.source_payment_id); END IF;
  ELSIF TG_TABLE_NAME = 'documents' THEN
    PERFORM erp_check_document_balance(NEW.id);
  ELSIF TG_TABLE_NAME = 'collection_lines' THEN
    PERFORM erp_check_operation_balance('collections', NEW.collection_id);
  ELSIF TG_TABLE_NAME = 'payment_lines' THEN
    PERFORM erp_check_operation_balance('supplier_payments', NEW.payment_id);
  ELSE
    PERFORM erp_check_operation_balance(TG_TABLE_NAME, NEW.id);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_allocations_balances AFTER INSERT OR UPDATE ON allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_trg_balances();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_documents_balances AFTER INSERT OR UPDATE ON documents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_trg_balances();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_collections_balances AFTER INSERT OR UPDATE ON collections
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_trg_balances();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_supplier_payments_balances AFTER INSERT OR UPDATE ON supplier_payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_trg_balances();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_collection_lines_balances AFTER INSERT ON collection_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_trg_balances();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_payment_lines_balances AFTER INSERT ON payment_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_trg_balances();
--> statement-breakpoint

-- ─────────────────────────── Cuentas corrientes ───────────────────────────
-- El asiento debe pertenecer al mismo tercero que su comprobante u operación de origen,
-- y una reversión debe ser exactamente el espejo del asiento original.
CREATE FUNCTION erp_guard_account_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_party bigint; o record;
BEGIN
  IF TG_TABLE_NAME = 'customer_account_entries' THEN
    IF NEW.document_id IS NOT NULL THEN
      SELECT client_id INTO v_party FROM documents WHERE id = NEW.document_id;
    ELSE
      SELECT client_id INTO v_party FROM collections WHERE id = NEW.collection_id;
    END IF;
    IF v_party IS DISTINCT FROM NEW.client_id THEN
      RAISE EXCEPTION 'El asiento no corresponde al cliente de su origen' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reversal_of_id IS NOT NULL THEN
      SELECT * INTO o FROM customer_account_entries WHERE id = NEW.reversal_of_id;
      IF o.client_id <> NEW.client_id OR o.debit <> NEW.credit OR o.credit <> NEW.debit
         OR o.document_id IS DISTINCT FROM NEW.document_id OR o.collection_id IS DISTINCT FROM NEW.collection_id THEN
        RAISE EXCEPTION 'La reversión debe ser el espejo exacto del asiento %', o.id USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSE
    IF NEW.document_id IS NOT NULL THEN
      SELECT supplier_id INTO v_party FROM documents WHERE id = NEW.document_id;
    ELSE
      SELECT supplier_id INTO v_party FROM supplier_payments WHERE id = NEW.payment_id;
    END IF;
    IF v_party IS DISTINCT FROM NEW.supplier_id THEN
      RAISE EXCEPTION 'El asiento no corresponde al proveedor de su origen' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reversal_of_id IS NOT NULL THEN
      SELECT * INTO o FROM supplier_account_entries WHERE id = NEW.reversal_of_id;
      IF o.supplier_id <> NEW.supplier_id OR o.debit <> NEW.credit OR o.credit <> NEW.debit
         OR o.document_id IS DISTINCT FROM NEW.document_id OR o.payment_id IS DISTINCT FROM NEW.payment_id THEN
        RAISE EXCEPTION 'La reversión debe ser el espejo exacto del asiento %', o.id USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_customer_entries_guard BEFORE INSERT ON customer_account_entries
  FOR EACH ROW EXECUTE FUNCTION erp_guard_account_entry();
--> statement-breakpoint
CREATE TRIGGER trg_supplier_entries_guard BEFORE INSERT ON supplier_account_entries
  FOR EACH ROW EXECUTE FUNCTION erp_guard_account_entry();
--> statement-breakpoint

-- ─────────────────────────── Tesorería ───────────────────────────
-- Una reversión es el espejo del movimiento original: misma cuenta e importe, dirección opuesta.
CREATE FUNCTION erp_guard_treasury_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o treasury_movements%ROWTYPE;
BEGIN
  IF NEW.reversal_of_id IS NOT NULL THEN
    SELECT * INTO o FROM treasury_movements WHERE id = NEW.reversal_of_id;
    IF o.origin_type = 'REVERSAL' THEN
      RAISE EXCEPTION 'No se puede revertir una reversión' USING ERRCODE = 'check_violation';
    END IF;
    IF o.account_kind <> NEW.account_kind OR o.cash_box_id IS DISTINCT FROM NEW.cash_box_id
       OR o.bank_account_id IS DISTINCT FROM NEW.bank_account_id OR o.amount <> NEW.amount OR o.direction = NEW.direction THEN
      RAISE EXCEPTION 'La reversión debe ser el espejo exacto del movimiento %', o.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_treasury_movements_guard BEFORE INSERT ON treasury_movements
  FOR EACH ROW EXECUTE FUNCTION erp_guard_treasury_movement();
--> statement-breakpoint

-- ─────────────────────────── Cheques: máquinas de estado ───────────────────────────
CREATE FUNCTION erp_guard_received_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.format, NEW.check_type, NEW.issuer_bank_id, NEW.number, NEW.drawer_tax_id, NEW.issue_date, NEW.payment_date,
      NEW.amount, NEW.client_id, NEW.created_at, NEW.created_by)
     IS DISTINCT FROM
     (OLD.format, OLD.check_type, OLD.issuer_bank_id, OLD.number, OLD.drawer_tax_id, OLD.issue_date, OLD.payment_date,
      OLD.amount, OLD.client_id, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'Los datos del cheque recibido % son inmutables', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'IN_PORTFOLIO' AND NEW.status IN ('DEPOSITED','CREDITED','ENDORSED','REJECTED','ANNULLED'))
    OR (OLD.status = 'DEPOSITED'    AND NEW.status IN ('CREDITED','REJECTED'))
    OR (OLD.status = 'CREDITED'     AND NEW.status IN ('REJECTED'))
    OR (OLD.status = 'ENDORSED'     AND NEW.status IN ('REJECTED','IN_PORTFOLIO'))
  ) THEN
    RAISE EXCEPTION 'Transición de estado inválida para cheque recibido: % → %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_received_checks_guard BEFORE UPDATE ON received_checks
  FOR EACH ROW EXECUTE FUNCTION erp_guard_received_check();
--> statement-breakpoint

CREATE FUNCTION erp_guard_issued_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.bank_account_id, NEW.format, NEW.check_type, NEW.number, NEW.amount, NEW.issue_date, NEW.payment_date,
      NEW.created_at, NEW.created_by)
     IS DISTINCT FROM
     (OLD.bank_account_id, OLD.format, OLD.check_type, OLD.number, OLD.amount, OLD.issue_date, OLD.payment_date,
      OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'Los datos del cheque emitido % son inmutables', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'ISSUED'    AND NEW.status IN ('DELIVERED','ANNULLED'))
    OR (OLD.status = 'DELIVERED' AND NEW.status IN ('PRESENTED','DEBITED','REJECTED','ANNULLED'))
    OR (OLD.status = 'PRESENTED' AND NEW.status IN ('DEBITED','REJECTED'))
  ) THEN
    RAISE EXCEPTION 'Transición de estado inválida para cheque emitido: % → %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.supplier_id IS NOT NULL AND NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
    RAISE EXCEPTION 'No se puede cambiar el proveedor de un cheque emitido' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_issued_checks_guard BEFORE UPDATE ON issued_checks
  FOR EACH ROW EXECUTE FUNCTION erp_guard_issued_check();
--> statement-breakpoint

-- ─────────────────────────── Auditoría: cadena de hashes ───────────────────────────
CREATE FUNCTION erp_audit_canonical(r audit_log) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'occurred_at', to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'user_id', r.user_id, 'username', r.username, 'session_id', r.session_id,
    'ip', r.ip, 'user_agent', r.user_agent, 'request_id', r.request_id,
    'module', r.module, 'action', r.action, 'entity_type', r.entity_type, 'entity_id', r.entity_id,
    'before', r.before, 'after', r.after, 'result', r.result, 'message', r.message,
    'prev_hash', r.prev_hash
  )::text
$$;
--> statement-breakpoint

CREATE FUNCTION erp_audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serializa las inserciones para encadenar en orden de id.
  PERFORM pg_advisory_xact_lock(hashtext('erp_audit_log_chain'));
  SELECT hash INTO NEW.prev_hash FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := coalesce(NEW.prev_hash, 'GENESIS');
  NEW.hash := encode(sha256(convert_to(erp_audit_canonical(NEW), 'UTF8')), 'hex');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_audit_log_chain BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION erp_audit_chain();
--> statement-breakpoint

-- Devuelve el id del primer registro cuya cadena está rota, o NULL si la cadena es íntegra.
CREATE FUNCTION erp_verify_audit_chain() RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE r audit_log; v_prev text := 'GENESIS';
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY id LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev
       OR r.hash IS DISTINCT FROM encode(sha256(convert_to(erp_audit_canonical(r), 'UTF8')), 'hex') THEN
      RETURN r.id;
    END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint

-- ─────────────────────────── Vistas ───────────────────────────
CREATE VIEW cash_movements AS
  SELECT * FROM treasury_movements WHERE account_kind = 'CASH';
--> statement-breakpoint
CREATE VIEW bank_movements AS
  SELECT * FROM treasury_movements WHERE account_kind = 'BANK';
--> statement-breakpoint
CREATE VIEW collection_allocations AS
  SELECT * FROM allocations WHERE ledger = 'AR';
--> statement-breakpoint
CREATE VIEW payment_allocations AS
  SELECT * FROM allocations WHERE ledger = 'AP';
--> statement-breakpoint
CREATE VIEW customer_accounts AS
  SELECT c.id AS client_id,
         coalesce(sum(e.debit), 0)::numeric(18,2) AS debit_total,
         coalesce(sum(e.credit), 0)::numeric(18,2) AS credit_total,
         (coalesce(sum(e.debit), 0) - coalesce(sum(e.credit), 0))::numeric(18,2) AS balance,
         max(e.entry_date) AS last_entry_date
    FROM clients c LEFT JOIN customer_account_entries e ON e.client_id = c.id
   GROUP BY c.id;
--> statement-breakpoint
CREATE VIEW supplier_accounts AS
  SELECT s.id AS supplier_id,
         coalesce(sum(e.debit), 0)::numeric(18,2) AS debit_total,
         coalesce(sum(e.credit), 0)::numeric(18,2) AS credit_total,
         (coalesce(sum(e.debit), 0) - coalesce(sum(e.credit), 0))::numeric(18,2) AS balance,
         max(e.entry_date) AS last_entry_date
    FROM suppliers s LEFT JOIN supplier_account_entries e ON e.supplier_id = s.id
   GROUP BY s.id;
--> statement-breakpoint
CREATE VIEW treasury_balances AS
  SELECT 'CASH'::text AS account_kind, cb.id AS account_id, cb.name AS account_name, cb.currency,
         coalesce(sum(CASE WHEN m.direction = 'IN' THEN m.amount ELSE -m.amount END), 0)::numeric(18,2) AS balance
    FROM cash_boxes cb LEFT JOIN treasury_movements m ON m.cash_box_id = cb.id
   GROUP BY cb.id
  UNION ALL
  SELECT 'BANK', ba.id, ba.display_name, ba.currency,
         coalesce(sum(CASE WHEN m.direction = 'IN' THEN m.amount ELSE -m.amount END), 0)::numeric(18,2)
    FROM bank_accounts ba LEFT JOIN treasury_movements m ON m.bank_account_id = ba.id
   GROUP BY ba.id;
--> statement-breakpoint

-- ─────────────────────────── Permisos de roles de base de datos ───────────────────────────
-- Los roles erp_app y erp_backup los crea scripts/db/bootstrap.ts (requiere superusuario).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO erp_app, erp_backup;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
--> statement-breakpoint
-- Auditoría: solo agregar y leer.
REVOKE UPDATE ON audit_log FROM erp_app;
--> statement-breakpoint
-- DELETE solo donde no hay información financiera (o protegido por trigger).
GRANT DELETE ON sessions, document_tax_lines, document_items, role_permissions, user_roles TO erp_app;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO erp_backup;
--> statement-breakpoint
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_backup;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO erp_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO erp_backup;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO erp_backup;
