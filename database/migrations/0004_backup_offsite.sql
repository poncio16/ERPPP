ALTER TABLE "backup_runs" ADD COLUMN "offsite_file" text;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD COLUMN "offsite_status" text;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD COLUMN "offsite_error" text;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD COLUMN "pruned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ix_backup_runs_file" ON "backup_runs" USING btree ("file_name");--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "ck_backup_offsite" CHECK ("backup_runs"."offsite_status" IS NULL OR "backup_runs"."offsite_status" IN ('OK','FAILED','SKIPPED'));--> statement-breakpoint

-- Un backup terminado conserva sus datos de identificación (archivo, SHA-256, versiones y totales de control):
-- después solo se registran la verificación, la copia fuera del servidor y el borrado por retención.
CREATE FUNCTION erp_guard_backup_run_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'RUNNING' AND (
       (NEW.kind, NEW.started_at, NEW.finished_at, NEW.file_name, NEW.size_bytes, NEW.sha256, NEW.app_version,
        NEW.schema_version, NEW.pg_version, NEW.control_totals, NEW.status, NEW.error_message, NEW.created_by)
       IS DISTINCT FROM
       (OLD.kind, OLD.started_at, OLD.finished_at, OLD.file_name, OLD.size_bytes, OLD.sha256, OLD.app_version,
        OLD.schema_version, OLD.pg_version, OLD.control_totals, OLD.status, OLD.error_message, OLD.created_by)) THEN
    RAISE EXCEPTION 'El backup % ya terminó: solo se registran su verificación, su copia externa y su retención', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_backup_runs_guard BEFORE UPDATE ON backup_runs
  FOR EACH ROW EXECUTE FUNCTION erp_guard_backup_run_update();
--> statement-breakpoint

-- pg_dump (rol erp_backup) necesita leer la tabla de migraciones, y la aplicación la consulta
-- para identificar la versión del esquema de cada backup.
GRANT USAGE ON SCHEMA drizzle TO erp_app, erp_backup;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO erp_app, erp_backup;
--> statement-breakpoint
GRANT SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO erp_backup;
