-- Cierre de caja (G.8-5): una vez cerrada una fecha, la caja no acepta movimientos con fecha
-- igual o anterior. Los cierres van en orden y el saldo del sistema que guardan debe ser el real.

CREATE FUNCTION erp_guard_cash_closed_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE closed date;
DECLARE last_id bigint;
BEGIN
  IF NEW.account_kind = 'CASH' THEN
    SELECT closure_date, id INTO closed, last_id FROM cash_closures
     WHERE cash_box_id = NEW.cash_box_id ORDER BY closure_date DESC LIMIT 1;
    -- Única excepción: la diferencia de arqueo del último cierre, con la fecha de ese cierre.
    IF NEW.origin_type = 'CASH_COUNT_DIFF' AND NEW.cash_closure_id = last_id AND NEW.movement_date = closed THEN
      RETURN NEW;
    END IF;
    IF closed IS NOT NULL AND NEW.movement_date <= closed THEN
      RAISE EXCEPTION 'La caja está cerrada hasta el % inclusive: no admite movimientos con fecha %', closed, NEW.movement_date
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_treasury_movements_cash_closed BEFORE INSERT ON treasury_movements
  FOR EACH ROW EXECUTE FUNCTION erp_guard_cash_closed_period();
--> statement-breakpoint

CREATE FUNCTION erp_guard_cash_closure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last_closed date;
DECLARE balance numeric(18,2);
BEGIN
  SELECT max(closure_date) INTO last_closed FROM cash_closures WHERE cash_box_id = NEW.cash_box_id;
  IF last_closed IS NOT NULL AND NEW.closure_date <= last_closed THEN
    RAISE EXCEPTION 'La caja ya tiene un cierre al %; el nuevo cierre debe ser posterior', last_closed
      USING ERRCODE = 'check_violation';
  END IF;
  -- El saldo del sistema se calcula sin la diferencia de arqueo de este mismo cierre.
  SELECT coalesce(sum(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0) INTO balance
    FROM treasury_movements
   WHERE cash_box_id = NEW.cash_box_id AND movement_date <= NEW.closure_date
     AND cash_closure_id IS DISTINCT FROM NEW.id;
  IF balance <> NEW.system_balance THEN
    RAISE EXCEPTION 'El saldo del sistema del cierre (%) no coincide con los movimientos de la caja (%)', NEW.system_balance, balance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_cash_closures_guard BEFORE INSERT ON cash_closures
  FOR EACH ROW EXECUTE FUNCTION erp_guard_cash_closure();
