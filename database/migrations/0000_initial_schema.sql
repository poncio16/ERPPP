CREATE TABLE "permissions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "permissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"module" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" bigint NOT NULL,
	"permission_id" bigint NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"token_hash" text NOT NULL,
	"user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "ux_sessions_token_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" bigint NOT NULL,
	"role_id" bigint NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"username" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"totp_secret" text,
	"password_changed_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ck_users_status" CHECK ("users"."status" IN ('ACTIVE','BLOCKED','INACTIVE')),
	CONSTRAINT "ck_users_failed" CHECK ("users"."failed_login_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "banks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "banks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "banks_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"tax_id" char(11) NOT NULL,
	"vat_condition_id" bigint NOT NULL,
	"address" text,
	"city" text,
	"province_id" bigint,
	"postal_code" text,
	"gross_income_number" text,
	"activity_start_date" date,
	"phone" text,
	"email" text,
	"logo_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ck_company_single_row" CHECK ("company"."id" = 1),
	CONSTRAINT "ck_company_tax_id" CHECK ("company"."tax_id" ~ '^[0-9]{11}$')
);
--> statement-breakpoint
CREATE TABLE "configuration" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"description" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "document_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"arca_code" integer,
	"letter" text,
	"class" text NOT NULL,
	"is_fce" boolean DEFAULT false NOT NULL,
	"is_fiscal" boolean DEFAULT true NOT NULL,
	"allowed_issued" boolean DEFAULT false NOT NULL,
	"allowed_received" boolean DEFAULT false NOT NULL,
	"vat_creditable" boolean DEFAULT true NOT NULL,
	CONSTRAINT "document_types_code_unique" UNIQUE("code"),
	CONSTRAINT "ck_document_types_class" CHECK ("document_types"."class" IN ('INVOICE','DEBIT_NOTE','CREDIT_NOTE','INTERNAL_DEBIT','OPENING_DEBIT','OPENING_CREDIT')),
	CONSTRAINT "ck_document_types_letter" CHECK ("document_types"."letter" IS NULL OR "document_types"."letter" IN ('A','B','C','E','M')),
	CONSTRAINT "ck_document_types_fiscal_code" CHECK (NOT "document_types"."is_fiscal" OR "document_types"."arca_code" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "expense_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "id_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "id_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"arca_code" integer,
	"requires_cuit" boolean DEFAULT false NOT NULL,
	CONSTRAINT "id_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "numbering_sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	"padding" integer DEFAULT 8 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ck_numbering_next" CHECK ("numbering_sequences"."next_value" > 0),
	CONSTRAINT "ck_numbering_padding" CHECK ("numbering_sequences"."padding" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "payment_terms" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_terms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "payment_terms_code_unique" UNIQUE("code"),
	CONSTRAINT "ck_payment_terms_days" CHECK ("payment_terms"."days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "provinces" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "provinces_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"arca_code" integer,
	"gross_income_jurisdiction" integer,
	CONSTRAINT "provinces_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tax_catalog" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tax_catalog_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"rate" numeric(6, 3),
	"arca_code" integer,
	"jurisdiction_id" bigint,
	"valid_from" date DEFAULT '2000-01-01' NOT NULL,
	"valid_to" date,
	CONSTRAINT "tax_catalog_code_unique" UNIQUE("code"),
	CONSTRAINT "ck_tax_catalog_kind" CHECK ("tax_catalog"."kind" IN ('VAT','PERCEPTION','RETENTION','OTHER_TAX')),
	CONSTRAINT "ck_tax_catalog_vat_rate" CHECK ("tax_catalog"."kind" <> 'VAT' OR "tax_catalog"."rate" IS NOT NULL),
	CONSTRAINT "ck_tax_catalog_rate_range" CHECK ("tax_catalog"."rate" IS NULL OR ("tax_catalog"."rate" >= 0 AND "tax_catalog"."rate" <= 100)),
	CONSTRAINT "ck_tax_catalog_validity" CHECK ("tax_catalog"."valid_to" IS NULL OR "tax_catalog"."valid_to" >= "tax_catalog"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "treasury_concepts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "treasury_concepts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"direction" text NOT NULL,
	"allows_manual" boolean DEFAULT false NOT NULL,
	CONSTRAINT "treasury_concepts_code_unique" UNIQUE("code"),
	CONSTRAINT "ck_treasury_concepts_direction" CHECK ("treasury_concepts"."direction" IN ('IN','OUT','BOTH'))
);
--> statement-breakpoint
CREATE TABLE "vat_conditions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vat_conditions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"arca_code" integer,
	CONSTRAINT "vat_conditions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clients_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"legal_name" text NOT NULL,
	"id_type_id" bigint NOT NULL,
	"tax_id" text,
	"vat_condition_id" bigint NOT NULL,
	"address" text,
	"city" text,
	"province_id" bigint,
	"postal_code" text,
	"phone" text,
	"email" text,
	"contact_name" text,
	"payment_term_id" bigint,
	"credit_days" integer DEFAULT 0 NOT NULL,
	"credit_limit" numeric(18, 2),
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"duplicate_tax_id_reason" text,
	"notes" text,
	"deactivated_at" timestamp with time zone,
	"deactivated_by" bigint,
	"deactivation_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "clients_code_unique" UNIQUE("code"),
	CONSTRAINT "ck_clients_status" CHECK ("clients"."status" IN ('ACTIVE','INACTIVE')),
	CONSTRAINT "ck_clients_credit_days" CHECK ("clients"."credit_days" >= 0),
	CONSTRAINT "ck_clients_credit_limit" CHECK ("clients"."credit_limit" IS NULL OR "clients"."credit_limit" >= 0),
	CONSTRAINT "ck_clients_tax_id_format" CHECK ("clients"."tax_id" IS NULL OR "clients"."tax_id" ~ '^[0-9A-Za-z-]{1,20}$'),
	CONSTRAINT "ck_clients_deactivation" CHECK ("clients"."status" = 'ACTIVE' OR ("clients"."deactivated_at" IS NOT NULL AND "clients"."deactivation_reason" IS NOT NULL)),
	CONSTRAINT "ck_clients_email" CHECK ("clients"."email" IS NULL OR "clients"."email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "suppliers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"legal_name" text NOT NULL,
	"id_type_id" bigint NOT NULL,
	"tax_id" text,
	"vat_condition_id" bigint NOT NULL,
	"address" text,
	"city" text,
	"province_id" bigint,
	"postal_code" text,
	"phone" text,
	"email" text,
	"contact_name" text,
	"payment_term_id" bigint,
	"credit_days" integer DEFAULT 0 NOT NULL,
	"credit_limit" numeric(18, 2),
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"duplicate_tax_id_reason" text,
	"notes" text,
	"deactivated_at" timestamp with time zone,
	"deactivated_by" bigint,
	"deactivation_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	"activity" text,
	"bank_id" bigint,
	"cbu" text,
	"cbu_alias" text,
	CONSTRAINT "suppliers_code_unique" UNIQUE("code"),
	CONSTRAINT "ck_suppliers_status" CHECK ("suppliers"."status" IN ('ACTIVE','INACTIVE')),
	CONSTRAINT "ck_suppliers_credit_days" CHECK ("suppliers"."credit_days" >= 0),
	CONSTRAINT "ck_suppliers_credit_limit" CHECK ("suppliers"."credit_limit" IS NULL OR "suppliers"."credit_limit" >= 0),
	CONSTRAINT "ck_suppliers_tax_id_format" CHECK ("suppliers"."tax_id" IS NULL OR "suppliers"."tax_id" ~ '^[0-9A-Za-z-]{1,20}$'),
	CONSTRAINT "ck_suppliers_deactivation" CHECK ("suppliers"."status" = 'ACTIVE' OR ("suppliers"."deactivated_at" IS NOT NULL AND "suppliers"."deactivation_reason" IS NOT NULL)),
	CONSTRAINT "ck_suppliers_email" CHECK ("suppliers"."email" IS NULL OR "suppliers"."email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
	CONSTRAINT "ck_suppliers_cbu" CHECK ("suppliers"."cbu" IS NULL OR "suppliers"."cbu" ~ '^[0-9]{22}$'),
	CONSTRAINT "ck_suppliers_alias" CHECK ("suppliers"."cbu_alias" IS NULL OR "suppliers"."cbu_alias" ~ '^[A-Za-z0-9.-]{6,20}$')
);
--> statement-breakpoint
CREATE TABLE "document_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "document_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"document_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"expense_category_id" bigint,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_document_items_amount" CHECK ("document_items"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "document_relations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "document_relations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"document_id" bigint NOT NULL,
	"related_document_id" bigint NOT NULL,
	"relation_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	CONSTRAINT "ck_document_relations_self" CHECK ("document_relations"."document_id" <> "document_relations"."related_document_id"),
	CONSTRAINT "ck_document_relations_type" CHECK ("document_relations"."relation_type" IN ('CREDIT_NOTE_OF','DEBIT_NOTE_OF','REJECTED_CHECK_DEBIT','REFUND_OF'))
);
--> statement-breakpoint
CREATE TABLE "document_tax_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "document_tax_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"document_id" bigint NOT NULL,
	"tax_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"base_amount" numeric(18, 2),
	"rate" numeric(6, 3),
	"amount" numeric(18, 2) NOT NULL,
	"jurisdiction_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_document_tax_lines_kind" CHECK ("document_tax_lines"."kind" IN ('VAT','PERCEPTION','OTHER_TAX')),
	CONSTRAINT "ck_document_tax_lines_vat" CHECK ("document_tax_lines"."kind" <> 'VAT' OR ("document_tax_lines"."base_amount" IS NOT NULL AND "document_tax_lines"."rate" IS NOT NULL)),
	CONSTRAINT "ck_document_tax_lines_amounts" CHECK ("document_tax_lines"."amount" >= 0 AND ("document_tax_lines"."base_amount" IS NULL OR "document_tax_lines"."base_amount" >= 0))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "documents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"direction" text NOT NULL,
	"document_type_id" bigint NOT NULL,
	"point_of_sale" integer NOT NULL,
	"number" bigint NOT NULL,
	"client_id" bigint,
	"supplier_id" bigint,
	"party_name" text NOT NULL,
	"party_tax_id" text,
	"party_vat_condition_id" bigint NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"vat_period" date NOT NULL,
	"concept" text,
	"description" text,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"net_taxed" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_untaxed" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_exempt" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"perceptions_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_taxes_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"balance" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"annulled_at" timestamp with time zone,
	"annulled_by" bigint,
	"annul_reason" text,
	"reason" text,
	"origin" text DEFAULT 'MANUAL' NOT NULL,
	"external_ref" text,
	"idempotency_key" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ux_documents_idempotency_key" UNIQUE("idempotency_key"),
	CONSTRAINT "ck_documents_direction" CHECK ("documents"."direction" IN ('ISSUED','RECEIVED')),
	CONSTRAINT "ck_documents_party" CHECK (("documents"."direction" = 'ISSUED' AND "documents"."client_id" IS NOT NULL AND "documents"."supplier_id" IS NULL)
       OR ("documents"."direction" = 'RECEIVED' AND "documents"."supplier_id" IS NOT NULL AND "documents"."client_id" IS NULL)),
	CONSTRAINT "ck_documents_pos" CHECK ("documents"."point_of_sale" BETWEEN 0 AND 99999),
	CONSTRAINT "ck_documents_number" CHECK ("documents"."number" BETWEEN 1 AND 99999999),
	CONSTRAINT "ck_documents_due" CHECK ("documents"."due_date" >= "documents"."issue_date"),
	CONSTRAINT "ck_documents_vat_period" CHECK ("documents"."vat_period" = date_trunc('month', "documents"."vat_period")::date),
	CONSTRAINT "ck_documents_concept" CHECK ("documents"."concept" IS NULL OR "documents"."concept" IN ('PRODUCTS','SERVICES','BOTH')),
	CONSTRAINT "ck_documents_fx" CHECK ("documents"."exchange_rate" > 0 AND ("documents"."currency" <> 'ARS' OR "documents"."exchange_rate" = 1)),
	CONSTRAINT "ck_documents_components" CHECK ("documents"."net_taxed" >= 0 AND "documents"."net_untaxed" >= 0 AND "documents"."net_exempt" >= 0 AND "documents"."vat_total" >= 0
      AND "documents"."perceptions_total" >= 0 AND "documents"."other_taxes_total" >= 0 AND "documents"."discount_total" >= 0),
	CONSTRAINT "ck_documents_total_formula" CHECK ("documents"."total" = "documents"."net_taxed" + "documents"."net_untaxed" + "documents"."net_exempt" + "documents"."vat_total"
        + "documents"."perceptions_total" + "documents"."other_taxes_total" - "documents"."discount_total"),
	CONSTRAINT "ck_documents_total_positive" CHECK ("documents"."total" > 0),
	CONSTRAINT "ck_documents_balance" CHECK ("documents"."balance" >= 0 AND "documents"."balance" <= "documents"."total"),
	CONSTRAINT "ck_documents_status" CHECK ("documents"."status" IN ('OPEN','PARTIAL','SETTLED','ANNULLED')),
	CONSTRAINT "ck_documents_status_balance" CHECK (("documents"."status" = 'OPEN' AND "documents"."balance" = "documents"."total")
       OR ("documents"."status" = 'PARTIAL' AND "documents"."balance" > 0 AND "documents"."balance" < "documents"."total")
       OR ("documents"."status" = 'SETTLED' AND "documents"."balance" = 0)
       OR ("documents"."status" = 'ANNULLED' AND "documents"."balance" = 0)),
	CONSTRAINT "ck_documents_annulment" CHECK ("documents"."status" <> 'ANNULLED' OR ("documents"."annulled_at" IS NOT NULL AND "documents"."annul_reason" IS NOT NULL)),
	CONSTRAINT "ck_documents_origin" CHECK ("documents"."origin" IN ('MANUAL','IMPORT'))
);
--> statement-breakpoint
CREATE TABLE "account_transfers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_transfers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transfer_date" date NOT NULL,
	"from_cash_box_id" bigint,
	"from_bank_account_id" bigint,
	"to_cash_box_id" bigint,
	"to_bank_account_id" bigint,
	"amount" numeric(18, 2) NOT NULL,
	"description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"annulled_at" timestamp with time zone,
	"annulled_by" bigint,
	"annul_reason" text,
	"idempotency_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ux_account_transfers_idempotency_key" UNIQUE("idempotency_key"),
	CONSTRAINT "ck_account_transfers_amount" CHECK ("account_transfers"."amount" > 0),
	CONSTRAINT "ck_account_transfers_from" CHECK (num_nonnulls("account_transfers"."from_cash_box_id", "account_transfers"."from_bank_account_id") = 1),
	CONSTRAINT "ck_account_transfers_to" CHECK (num_nonnulls("account_transfers"."to_cash_box_id", "account_transfers"."to_bank_account_id") = 1),
	CONSTRAINT "ck_account_transfers_distinct" CHECK ("account_transfers"."from_cash_box_id" IS DISTINCT FROM "account_transfers"."to_cash_box_id" OR "account_transfers"."from_bank_account_id" IS DISTINCT FROM "account_transfers"."to_bank_account_id"),
	CONSTRAINT "ck_account_transfers_status" CHECK ("account_transfers"."status" IN ('ACTIVE','ANNULLED'))
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bank_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bank_id" bigint NOT NULL,
	"account_type" text NOT NULL,
	"account_number" text NOT NULL,
	"cbu" text,
	"alias" text,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ux_bank_accounts_display_name" UNIQUE("display_name"),
	CONSTRAINT "ck_bank_accounts_type" CHECK ("bank_accounts"."account_type" IN ('CC','CA')),
	CONSTRAINT "ck_bank_accounts_cbu" CHECK ("bank_accounts"."cbu" IS NULL OR "bank_accounts"."cbu" ~ '^[0-9]{22}$')
);
--> statement-breakpoint
CREATE TABLE "cash_boxes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cash_boxes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ux_cash_boxes_name" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "cash_closures" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cash_closures_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"cash_box_id" bigint NOT NULL,
	"closure_date" date NOT NULL,
	"system_balance" numeric(18, 2) NOT NULL,
	"counted_amount" numeric(18, 2) NOT NULL,
	"count_detail" jsonb,
	"difference" numeric(18, 2) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	CONSTRAINT "ck_cash_closures_diff" CHECK ("cash_closures"."difference" = "cash_closures"."counted_amount" - "cash_closures"."system_balance"),
	CONSTRAINT "ck_cash_closures_counted" CHECK ("cash_closures"."counted_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "check_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "check_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"check_kind" text NOT NULL,
	"received_check_id" bigint,
	"issued_check_id" bigint,
	"from_status" text,
	"to_status" text NOT NULL,
	"event_date" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	CONSTRAINT "ck_check_events_kind" CHECK (("check_events"."check_kind" = 'RECEIVED' AND "check_events"."received_check_id" IS NOT NULL AND "check_events"."issued_check_id" IS NULL)
       OR ("check_events"."check_kind" = 'ISSUED' AND "check_events"."issued_check_id" IS NOT NULL AND "check_events"."received_check_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "issued_checks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "issued_checks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bank_account_id" bigint NOT NULL,
	"format" text NOT NULL,
	"check_type" text NOT NULL,
	"number" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"issue_date" date NOT NULL,
	"payment_date" date NOT NULL,
	"supplier_id" bigint,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"debited_at" date,
	"rejected_at" date,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ck_issued_checks_format" CHECK ("issued_checks"."format" IN ('PHYSICAL','ECHEQ')),
	CONSTRAINT "ck_issued_checks_type" CHECK ("issued_checks"."check_type" IN ('COMMON','DEFERRED')),
	CONSTRAINT "ck_issued_checks_amount" CHECK ("issued_checks"."amount" > 0),
	CONSTRAINT "ck_issued_checks_dates" CHECK ("issued_checks"."payment_date" >= "issued_checks"."issue_date"),
	CONSTRAINT "ck_issued_checks_status" CHECK ("issued_checks"."status" IN ('ISSUED','DELIVERED','PRESENTED','DEBITED','REJECTED','ANNULLED')),
	CONSTRAINT "ck_issued_checks_debited" CHECK ("issued_checks"."status" <> 'DEBITED' OR "issued_checks"."debited_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "planned_cash_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "planned_cash_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"direction" text NOT NULL,
	"concept_id" bigint,
	"expected_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"recurrence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ck_planned_direction" CHECK ("planned_cash_items"."direction" IN ('IN','OUT')),
	CONSTRAINT "ck_planned_amount" CHECK ("planned_cash_items"."amount" > 0),
	CONSTRAINT "ck_planned_status" CHECK ("planned_cash_items"."status" IN ('PLANNED','REALIZED','CANCELLED')),
	CONSTRAINT "ck_planned_recurrence" CHECK ("planned_cash_items"."recurrence" IS NULL OR "planned_cash_items"."recurrence" IN ('MONTHLY'))
);
--> statement-breakpoint
CREATE TABLE "received_checks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "received_checks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"format" text NOT NULL,
	"check_type" text NOT NULL,
	"issuer_bank_id" bigint NOT NULL,
	"number" text NOT NULL,
	"drawer_tax_id" text NOT NULL,
	"drawer_name" text NOT NULL,
	"client_id" bigint,
	"issue_date" date NOT NULL,
	"payment_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'IN_PORTFOLIO' NOT NULL,
	"deposit_bank_account_id" bigint,
	"deposited_at" date,
	"credited_at" date,
	"rejected_at" date,
	"rejection_reason" text,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ck_received_checks_format" CHECK ("received_checks"."format" IN ('PHYSICAL','ECHEQ')),
	CONSTRAINT "ck_received_checks_type" CHECK ("received_checks"."check_type" IN ('COMMON','DEFERRED')),
	CONSTRAINT "ck_received_checks_amount" CHECK ("received_checks"."amount" > 0),
	CONSTRAINT "ck_received_checks_dates" CHECK ("received_checks"."payment_date" >= "received_checks"."issue_date"),
	CONSTRAINT "ck_received_checks_status" CHECK ("received_checks"."status" IN ('IN_PORTFOLIO','DEPOSITED','CREDITED','REJECTED','ENDORSED','ANNULLED')),
	CONSTRAINT "ck_received_checks_deposit" CHECK ("received_checks"."status" <> 'DEPOSITED' OR ("received_checks"."deposit_bank_account_id" IS NOT NULL AND "received_checks"."deposited_at" IS NOT NULL)),
	CONSTRAINT "ck_received_checks_rejected" CHECK ("received_checks"."status" <> 'REJECTED' OR "received_checks"."rejected_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "treasury_movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "treasury_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_kind" text NOT NULL,
	"cash_box_id" bigint,
	"bank_account_id" bigint,
	"movement_date" date NOT NULL,
	"value_date" date,
	"direction" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"concept_id" bigint,
	"description" text NOT NULL,
	"reference" text,
	"origin_type" text NOT NULL,
	"collection_line_id" bigint,
	"payment_line_id" bigint,
	"check_event_id" bigint,
	"account_transfer_id" bigint,
	"refund_id" bigint,
	"cash_closure_id" bigint,
	"reversal_of_id" bigint,
	"idempotency_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	CONSTRAINT "ux_treasury_movements_idempotency_key" UNIQUE("idempotency_key"),
	CONSTRAINT "ck_treasury_kind" CHECK ("treasury_movements"."account_kind" IN ('CASH','BANK')),
	CONSTRAINT "ck_treasury_account" CHECK (("treasury_movements"."account_kind" = 'CASH' AND "treasury_movements"."cash_box_id" IS NOT NULL AND "treasury_movements"."bank_account_id" IS NULL)
       OR ("treasury_movements"."account_kind" = 'BANK' AND "treasury_movements"."bank_account_id" IS NOT NULL AND "treasury_movements"."cash_box_id" IS NULL)),
	CONSTRAINT "ck_treasury_direction" CHECK ("treasury_movements"."direction" IN ('IN','OUT')),
	CONSTRAINT "ck_treasury_amount" CHECK ("treasury_movements"."amount" > 0),
	CONSTRAINT "ck_treasury_origin_type" CHECK ("treasury_movements"."origin_type" IN ('OPENING','COLLECTION_LINE','PAYMENT_LINE','CHECK_EVENT','ACCOUNT_TRANSFER','REFUND','MANUAL','CASH_COUNT_DIFF','REVERSAL')),
	CONSTRAINT "ck_treasury_origin_ref" CHECK (num_nonnulls("treasury_movements"."collection_line_id", "treasury_movements"."payment_line_id", "treasury_movements"."check_event_id", "treasury_movements"."account_transfer_id",
          "treasury_movements"."refund_id", "treasury_movements"."cash_closure_id", "treasury_movements"."reversal_of_id") =
        CASE WHEN "treasury_movements"."origin_type" IN ('OPENING','MANUAL') THEN 0 ELSE 1 END
      AND ("treasury_movements"."origin_type" <> 'COLLECTION_LINE' OR "treasury_movements"."collection_line_id" IS NOT NULL)
      AND ("treasury_movements"."origin_type" <> 'PAYMENT_LINE' OR "treasury_movements"."payment_line_id" IS NOT NULL)
      AND ("treasury_movements"."origin_type" <> 'CHECK_EVENT' OR "treasury_movements"."check_event_id" IS NOT NULL)
      AND ("treasury_movements"."origin_type" <> 'ACCOUNT_TRANSFER' OR "treasury_movements"."account_transfer_id" IS NOT NULL)
      AND ("treasury_movements"."origin_type" <> 'REFUND' OR "treasury_movements"."refund_id" IS NOT NULL)
      AND ("treasury_movements"."origin_type" <> 'CASH_COUNT_DIFF' OR "treasury_movements"."cash_closure_id" IS NOT NULL)
      AND ("treasury_movements"."origin_type" <> 'REVERSAL' OR "treasury_movements"."reversal_of_id" IS NOT NULL)),
	CONSTRAINT "ck_treasury_manual_idempotency" CHECK ("treasury_movements"."origin_type" <> 'MANUAL' OR ("treasury_movements"."idempotency_key" IS NOT NULL AND "treasury_movements"."concept_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "allocations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ledger" text NOT NULL,
	"target_document_id" bigint NOT NULL,
	"source_kind" text NOT NULL,
	"source_collection_id" bigint,
	"source_payment_id" bigint,
	"source_document_id" bigint,
	"amount" numeric(18, 2) NOT NULL,
	"allocation_date" date NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" bigint,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	CONSTRAINT "ck_allocations_ledger" CHECK ("allocations"."ledger" IN ('AR','AP')),
	CONSTRAINT "ck_allocations_amount" CHECK ("allocations"."amount" > 0),
	CONSTRAINT "ck_allocations_status" CHECK ("allocations"."status" IN ('ACTIVE','REVERSED')),
	CONSTRAINT "ck_allocations_source" CHECK (num_nonnulls("allocations"."source_collection_id", "allocations"."source_payment_id", "allocations"."source_document_id") = 1
      AND (("allocations"."source_kind" = 'COLLECTION' AND "allocations"."source_collection_id" IS NOT NULL AND "allocations"."ledger" = 'AR')
        OR ("allocations"."source_kind" = 'PAYMENT' AND "allocations"."source_payment_id" IS NOT NULL AND "allocations"."ledger" = 'AP')
        OR ("allocations"."source_kind" = 'CREDIT_DOCUMENT' AND "allocations"."source_document_id" IS NOT NULL))),
	CONSTRAINT "ck_allocations_self" CHECK ("allocations"."source_document_id" IS DISTINCT FROM "allocations"."target_document_id"),
	CONSTRAINT "ck_allocations_reversal" CHECK ("allocations"."status" = 'ACTIVE' OR ("allocations"."reversed_at" IS NOT NULL AND "allocations"."reversal_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "collection_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collection_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collection_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"cash_box_id" bigint,
	"bank_account_id" bigint,
	"transfer_date" date,
	"transfer_reference" text,
	"received_check_id" bigint,
	"retention_tax_id" bigint,
	"retention_certificate" text,
	"retention_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_collection_lines_received_check" UNIQUE("received_check_id"),
	CONSTRAINT "ck_collection_lines_amount" CHECK ("collection_lines"."amount" > 0),
	CONSTRAINT "ck_collection_lines_method" CHECK (("collection_lines"."method" = 'CASH' AND "collection_lines"."cash_box_id" IS NOT NULL
            AND num_nonnulls("collection_lines"."bank_account_id", "collection_lines"."received_check_id", "collection_lines"."retention_tax_id") = 0)
       OR ("collection_lines"."method" = 'TRANSFER' AND "collection_lines"."bank_account_id" IS NOT NULL AND "collection_lines"."transfer_date" IS NOT NULL
            AND num_nonnulls("collection_lines"."cash_box_id", "collection_lines"."received_check_id", "collection_lines"."retention_tax_id") = 0)
       OR ("collection_lines"."method" = 'CHECK' AND "collection_lines"."received_check_id" IS NOT NULL
            AND num_nonnulls("collection_lines"."cash_box_id", "collection_lines"."bank_account_id", "collection_lines"."retention_tax_id") = 0)
       OR ("collection_lines"."method" = 'RETENTION' AND "collection_lines"."retention_tax_id" IS NOT NULL AND "collection_lines"."retention_certificate" IS NOT NULL
            AND "collection_lines"."retention_date" IS NOT NULL
            AND num_nonnulls("collection_lines"."cash_box_id", "collection_lines"."bank_account_id", "collection_lines"."received_check_id") = 0))
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_id" bigint NOT NULL,
	"collection_date" date NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"unapplied_amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"idempotency_key" uuid NOT NULL,
	"annulled_at" timestamp with time zone,
	"annulled_by" bigint,
	"annul_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ux_collections_idempotency_key" UNIQUE("idempotency_key"),
	CONSTRAINT "ck_collections_total" CHECK ("collections"."total_amount" > 0),
	CONSTRAINT "ck_collections_unapplied" CHECK ("collections"."unapplied_amount" >= 0 AND "collections"."unapplied_amount" <= "collections"."total_amount"),
	CONSTRAINT "ck_collections_status" CHECK ("collections"."status" IN ('ACTIVE','ANNULLED')),
	CONSTRAINT "ck_collections_annulment" CHECK ("collections"."status" <> 'ANNULLED' OR ("collections"."annulled_at" IS NOT NULL AND "collections"."annul_reason" IS NOT NULL AND "collections"."unapplied_amount" = 0))
);
--> statement-breakpoint
CREATE TABLE "customer_account_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customer_account_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_id" bigint NOT NULL,
	"entry_date" date NOT NULL,
	"entry_type" text NOT NULL,
	"document_id" bigint,
	"collection_id" bigint,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"description" text NOT NULL,
	"reversal_of_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	CONSTRAINT "ux_customer_entries_reversal" UNIQUE("reversal_of_id"),
	CONSTRAINT "ck_customer_entries_type" CHECK ("customer_account_entries"."entry_type" IN ('DOCUMENT','COLLECTION','REVERSAL')),
	CONSTRAINT "ck_customer_entries_amounts" CHECK ("customer_account_entries"."debit" >= 0 AND "customer_account_entries"."credit" >= 0 AND (("customer_account_entries"."debit" > 0) <> ("customer_account_entries"."credit" > 0))),
	CONSTRAINT "ck_customer_entries_source" CHECK (num_nonnulls("customer_account_entries"."document_id", "customer_account_entries"."collection_id") = 1
      AND ("customer_account_entries"."entry_type" <> 'DOCUMENT' OR "customer_account_entries"."document_id" IS NOT NULL)
      AND ("customer_account_entries"."entry_type" <> 'COLLECTION' OR "customer_account_entries"."collection_id" IS NOT NULL)
      AND (("customer_account_entries"."entry_type" = 'REVERSAL') = ("customer_account_entries"."reversal_of_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "payment_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"payment_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"cash_box_id" bigint,
	"bank_account_id" bigint,
	"transfer_date" date,
	"transfer_reference" text,
	"issued_check_id" bigint,
	"received_check_id" bigint,
	"retention_tax_id" bigint,
	"retention_certificate" text,
	"retention_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_payment_lines_issued_check" UNIQUE("issued_check_id"),
	CONSTRAINT "ck_payment_lines_amount" CHECK ("payment_lines"."amount" > 0),
	CONSTRAINT "ck_payment_lines_method" CHECK (("payment_lines"."method" = 'CASH' AND "payment_lines"."cash_box_id" IS NOT NULL
            AND num_nonnulls("payment_lines"."bank_account_id", "payment_lines"."issued_check_id", "payment_lines"."received_check_id", "payment_lines"."retention_tax_id") = 0)
       OR ("payment_lines"."method" = 'TRANSFER' AND "payment_lines"."bank_account_id" IS NOT NULL AND "payment_lines"."transfer_date" IS NOT NULL
            AND num_nonnulls("payment_lines"."cash_box_id", "payment_lines"."issued_check_id", "payment_lines"."received_check_id", "payment_lines"."retention_tax_id") = 0)
       OR ("payment_lines"."method" = 'OWN_CHECK' AND "payment_lines"."issued_check_id" IS NOT NULL
            AND num_nonnulls("payment_lines"."cash_box_id", "payment_lines"."bank_account_id", "payment_lines"."received_check_id", "payment_lines"."retention_tax_id") = 0)
       OR ("payment_lines"."method" = 'THIRD_PARTY_CHECK' AND "payment_lines"."received_check_id" IS NOT NULL
            AND num_nonnulls("payment_lines"."cash_box_id", "payment_lines"."bank_account_id", "payment_lines"."issued_check_id", "payment_lines"."retention_tax_id") = 0)
       OR ("payment_lines"."method" = 'RETENTION' AND "payment_lines"."retention_tax_id" IS NOT NULL AND "payment_lines"."retention_certificate" IS NOT NULL
            AND "payment_lines"."retention_date" IS NOT NULL
            AND num_nonnulls("payment_lines"."cash_box_id", "payment_lines"."bank_account_id", "payment_lines"."issued_check_id", "payment_lines"."received_check_id") = 0))
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" text NOT NULL,
	"payment_id" bigint NOT NULL,
	"issue_date" date NOT NULL,
	"party_name" text NOT NULL,
	"party_tax_id" text,
	"amount" numeric(18, 2) NOT NULL,
	"amount_in_words" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"annulled_at" timestamp with time zone,
	"annulled_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ux_payment_orders_number" UNIQUE("number"),
	CONSTRAINT "ux_payment_orders_payment" UNIQUE("payment_id"),
	CONSTRAINT "ck_payment_orders_amount" CHECK ("payment_orders"."amount" > 0),
	CONSTRAINT "ck_payment_orders_status" CHECK ("payment_orders"."status" IN ('ACTIVE','ANNULLED'))
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" text NOT NULL,
	"collection_id" bigint NOT NULL,
	"issue_date" date NOT NULL,
	"party_name" text NOT NULL,
	"party_tax_id" text,
	"amount" numeric(18, 2) NOT NULL,
	"amount_in_words" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"annulled_at" timestamp with time zone,
	"annulled_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ux_receipts_number" UNIQUE("number"),
	CONSTRAINT "ux_receipts_collection" UNIQUE("collection_id"),
	CONSTRAINT "ck_receipts_amount" CHECK ("receipts"."amount" > 0),
	CONSTRAINT "ck_receipts_status" CHECK ("receipts"."status" IN ('ACTIVE','ANNULLED'))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "refunds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ledger" text NOT NULL,
	"client_id" bigint,
	"supplier_id" bigint,
	"refund_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"method" text NOT NULL,
	"cash_box_id" bigint,
	"bank_account_id" bigint,
	"reference" text,
	"document_id" bigint NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"annulled_at" timestamp with time zone,
	"annulled_by" bigint,
	"annul_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ux_refunds_document" UNIQUE("document_id"),
	CONSTRAINT "ux_refunds_idempotency_key" UNIQUE("idempotency_key"),
	CONSTRAINT "ck_refunds_amount" CHECK ("refunds"."amount" > 0),
	CONSTRAINT "ck_refunds_party" CHECK (("refunds"."ledger" = 'AR' AND "refunds"."client_id" IS NOT NULL AND "refunds"."supplier_id" IS NULL)
       OR ("refunds"."ledger" = 'AP' AND "refunds"."supplier_id" IS NOT NULL AND "refunds"."client_id" IS NULL)),
	CONSTRAINT "ck_refunds_method" CHECK (("refunds"."method" = 'CASH' AND "refunds"."cash_box_id" IS NOT NULL AND "refunds"."bank_account_id" IS NULL)
       OR ("refunds"."method" = 'TRANSFER' AND "refunds"."bank_account_id" IS NOT NULL AND "refunds"."cash_box_id" IS NULL)),
	CONSTRAINT "ck_refunds_status" CHECK ("refunds"."status" IN ('ACTIVE','ANNULLED'))
);
--> statement-breakpoint
CREATE TABLE "supplier_account_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_account_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"supplier_id" bigint NOT NULL,
	"entry_date" date NOT NULL,
	"entry_type" text NOT NULL,
	"document_id" bigint,
	"payment_id" bigint,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"description" text NOT NULL,
	"reversal_of_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	CONSTRAINT "ux_supplier_entries_reversal" UNIQUE("reversal_of_id"),
	CONSTRAINT "ck_supplier_entries_type" CHECK ("supplier_account_entries"."entry_type" IN ('DOCUMENT','PAYMENT','REVERSAL')),
	CONSTRAINT "ck_supplier_entries_amounts" CHECK ("supplier_account_entries"."debit" >= 0 AND "supplier_account_entries"."credit" >= 0 AND (("supplier_account_entries"."debit" > 0) <> ("supplier_account_entries"."credit" > 0))),
	CONSTRAINT "ck_supplier_entries_source" CHECK (num_nonnulls("supplier_account_entries"."document_id", "supplier_account_entries"."payment_id") = 1
      AND ("supplier_account_entries"."entry_type" <> 'DOCUMENT' OR "supplier_account_entries"."document_id" IS NOT NULL)
      AND ("supplier_account_entries"."entry_type" <> 'PAYMENT' OR "supplier_account_entries"."payment_id" IS NOT NULL)
      AND (("supplier_account_entries"."entry_type" = 'REVERSAL') = ("supplier_account_entries"."reversal_of_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"supplier_id" bigint NOT NULL,
	"payment_date" date NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"unapplied_amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"idempotency_key" uuid NOT NULL,
	"annulled_at" timestamp with time zone,
	"annulled_by" bigint,
	"annul_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone,
	"updated_by" bigint,
	CONSTRAINT "ux_supplier_payments_idempotency_key" UNIQUE("idempotency_key"),
	CONSTRAINT "ck_supplier_payments_total" CHECK ("supplier_payments"."total_amount" > 0),
	CONSTRAINT "ck_supplier_payments_unapplied" CHECK ("supplier_payments"."unapplied_amount" >= 0 AND "supplier_payments"."unapplied_amount" <= "supplier_payments"."total_amount"),
	CONSTRAINT "ck_supplier_payments_status" CHECK ("supplier_payments"."status" IN ('ACTIVE','ANNULLED')),
	CONSTRAINT "ck_supplier_payments_annulment" CHECK ("supplier_payments"."status" <> 'ANNULLED' OR ("supplier_payments"."annulled_at" IS NOT NULL AND "supplier_payments"."annul_reason" IS NOT NULL AND "supplier_payments"."unapplied_amount" = 0))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" bigint,
	"username" text,
	"session_id" bigint,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"result" text NOT NULL,
	"message" text,
	"prev_hash" text,
	"hash" text,
	CONSTRAINT "ck_audit_result" CHECK ("audit_log"."result" IN ('SUCCESS','DENIED','ERROR'))
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "backup_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"file_name" text,
	"size_bytes" bigint,
	"sha256" text,
	"app_version" text,
	"schema_version" text,
	"pg_version" text,
	"control_totals" jsonb,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"error_message" text,
	"verified_at" timestamp with time zone,
	"verify_status" text,
	"verify_detail" jsonb,
	"created_by" bigint,
	CONSTRAINT "ck_backup_kind" CHECK ("backup_runs"."kind" IN ('AUTO','MANUAL','PRE_RESTORE','PRE_MIGRATION')),
	CONSTRAINT "ck_backup_status" CHECK ("backup_runs"."status" IN ('RUNNING','OK','FAILED')),
	CONSTRAINT "ck_backup_verify" CHECK ("backup_runs"."verify_status" IS NULL OR "backup_runs"."verify_status" IN ('PASS','FAIL'))
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_vat_condition_id_vat_conditions_id_fk" FOREIGN KEY ("vat_condition_id") REFERENCES "public"."vat_conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_catalog" ADD CONSTRAINT "tax_catalog_jurisdiction_id_provinces_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."provinces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_id_type_id_id_types_id_fk" FOREIGN KEY ("id_type_id") REFERENCES "public"."id_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_vat_condition_id_vat_conditions_id_fk" FOREIGN KEY ("vat_condition_id") REFERENCES "public"."vat_conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_payment_term_id_payment_terms_id_fk" FOREIGN KEY ("payment_term_id") REFERENCES "public"."payment_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_id_type_id_id_types_id_fk" FOREIGN KEY ("id_type_id") REFERENCES "public"."id_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_vat_condition_id_vat_conditions_id_fk" FOREIGN KEY ("vat_condition_id") REFERENCES "public"."vat_conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_payment_term_id_payment_terms_id_fk" FOREIGN KEY ("payment_term_id") REFERENCES "public"."payment_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_expense_category_id_expense_categories_id_fk" FOREIGN KEY ("expense_category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_relations" ADD CONSTRAINT "document_relations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_relations" ADD CONSTRAINT "document_relations_related_document_id_documents_id_fk" FOREIGN KEY ("related_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tax_lines" ADD CONSTRAINT "document_tax_lines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tax_lines" ADD CONSTRAINT "document_tax_lines_tax_id_tax_catalog_id_fk" FOREIGN KEY ("tax_id") REFERENCES "public"."tax_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tax_lines" ADD CONSTRAINT "document_tax_lines_jurisdiction_id_provinces_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."provinces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_party_vat_condition_id_vat_conditions_id_fk" FOREIGN KEY ("party_vat_condition_id") REFERENCES "public"."vat_conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_from_cash_box_id_cash_boxes_id_fk" FOREIGN KEY ("from_cash_box_id") REFERENCES "public"."cash_boxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_from_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("from_bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_to_cash_box_id_cash_boxes_id_fk" FOREIGN KEY ("to_cash_box_id") REFERENCES "public"."cash_boxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_to_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("to_bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_closures" ADD CONSTRAINT "cash_closures_cash_box_id_cash_boxes_id_fk" FOREIGN KEY ("cash_box_id") REFERENCES "public"."cash_boxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_events" ADD CONSTRAINT "check_events_received_check_id_received_checks_id_fk" FOREIGN KEY ("received_check_id") REFERENCES "public"."received_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_events" ADD CONSTRAINT "check_events_issued_check_id_issued_checks_id_fk" FOREIGN KEY ("issued_check_id") REFERENCES "public"."issued_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_checks" ADD CONSTRAINT "issued_checks_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_checks" ADD CONSTRAINT "issued_checks_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_cash_items" ADD CONSTRAINT "planned_cash_items_concept_id_treasury_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."treasury_concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_checks" ADD CONSTRAINT "received_checks_issuer_bank_id_banks_id_fk" FOREIGN KEY ("issuer_bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_checks" ADD CONSTRAINT "received_checks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "received_checks" ADD CONSTRAINT "received_checks_deposit_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("deposit_bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_cash_box_id_cash_boxes_id_fk" FOREIGN KEY ("cash_box_id") REFERENCES "public"."cash_boxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_concept_id_treasury_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."treasury_concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_check_event_id_check_events_id_fk" FOREIGN KEY ("check_event_id") REFERENCES "public"."check_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_account_transfer_id_account_transfers_id_fk" FOREIGN KEY ("account_transfer_id") REFERENCES "public"."account_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_cash_closure_id_cash_closures_id_fk" FOREIGN KEY ("cash_closure_id") REFERENCES "public"."cash_closures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_reversal_of_id_treasury_movements_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."treasury_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_target_document_id_documents_id_fk" FOREIGN KEY ("target_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_source_collection_id_collections_id_fk" FOREIGN KEY ("source_collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_source_payment_id_supplier_payments_id_fk" FOREIGN KEY ("source_payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_lines" ADD CONSTRAINT "collection_lines_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_lines" ADD CONSTRAINT "collection_lines_cash_box_id_cash_boxes_id_fk" FOREIGN KEY ("cash_box_id") REFERENCES "public"."cash_boxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_lines" ADD CONSTRAINT "collection_lines_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_lines" ADD CONSTRAINT "collection_lines_received_check_id_received_checks_id_fk" FOREIGN KEY ("received_check_id") REFERENCES "public"."received_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_lines" ADD CONSTRAINT "collection_lines_retention_tax_id_tax_catalog_id_fk" FOREIGN KEY ("retention_tax_id") REFERENCES "public"."tax_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_account_entries" ADD CONSTRAINT "customer_account_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_account_entries" ADD CONSTRAINT "customer_account_entries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_account_entries" ADD CONSTRAINT "customer_account_entries_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_account_entries" ADD CONSTRAINT "customer_account_entries_reversal_of_id_customer_account_entries_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."customer_account_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_payment_id_supplier_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_cash_box_id_cash_boxes_id_fk" FOREIGN KEY ("cash_box_id") REFERENCES "public"."cash_boxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_issued_check_id_issued_checks_id_fk" FOREIGN KEY ("issued_check_id") REFERENCES "public"."issued_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_received_check_id_received_checks_id_fk" FOREIGN KEY ("received_check_id") REFERENCES "public"."received_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_retention_tax_id_tax_catalog_id_fk" FOREIGN KEY ("retention_tax_id") REFERENCES "public"."tax_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_payment_id_supplier_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_cash_box_id_cash_boxes_id_fk" FOREIGN KEY ("cash_box_id") REFERENCES "public"."cash_boxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_account_entries" ADD CONSTRAINT "supplier_account_entries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_account_entries" ADD CONSTRAINT "supplier_account_entries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_account_entries" ADD CONSTRAINT "supplier_account_entries_payment_id_supplier_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_account_entries" ADD CONSTRAINT "supplier_account_entries_reversal_of_id_supplier_account_entries_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."supplier_account_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_username" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_email" ON "users" USING btree (lower("email")) WHERE "users"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_document_types_arca" ON "document_types" USING btree ("arca_code") WHERE "document_types"."arca_code" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_clients_tax_id" ON "clients" USING btree ("tax_id") WHERE "clients"."tax_id" IS NOT NULL AND "clients"."duplicate_tax_id_reason" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_clients_name" ON "clients" USING btree (lower("legal_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "ux_suppliers_tax_id" ON "suppliers" USING btree ("tax_id") WHERE "suppliers"."tax_id" IS NOT NULL AND "suppliers"."duplicate_tax_id_reason" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_suppliers_name" ON "suppliers" USING btree (lower("legal_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "ux_document_items_line" ON "document_items" USING btree ("document_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_document_relations" ON "document_relations" USING btree ("document_id","related_document_id");--> statement-breakpoint
CREATE INDEX "ix_document_relations_related" ON "document_relations" USING btree ("related_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_document_tax_lines" ON "document_tax_lines" USING btree ("document_id","tax_id",coalesce("jurisdiction_id", 0));--> statement-breakpoint
CREATE UNIQUE INDEX "ux_documents_issued" ON "documents" USING btree ("document_type_id","point_of_sale","number") WHERE "documents"."direction" = 'ISSUED' AND "documents"."status" <> 'ANNULLED';--> statement-breakpoint
CREATE UNIQUE INDEX "ux_documents_received" ON "documents" USING btree ("supplier_id","document_type_id","point_of_sale","number") WHERE "documents"."direction" = 'RECEIVED' AND "documents"."status" <> 'ANNULLED';--> statement-breakpoint
CREATE INDEX "ix_documents_client_date" ON "documents" USING btree ("client_id","issue_date");--> statement-breakpoint
CREATE INDEX "ix_documents_supplier_date" ON "documents" USING btree ("supplier_id","issue_date");--> statement-breakpoint
CREATE INDEX "ix_documents_open_due" ON "documents" USING btree ("direction","due_date") WHERE "documents"."balance" > 0 AND "documents"."status" <> 'ANNULLED';--> statement-breakpoint
CREATE INDEX "ix_documents_vat_period" ON "documents" USING btree ("direction","vat_period");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_bank_accounts_cbu" ON "bank_accounts" USING btree ("cbu") WHERE "bank_accounts"."cbu" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_bank_accounts_number" ON "bank_accounts" USING btree ("bank_id","account_number");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_cash_closures" ON "cash_closures" USING btree ("cash_box_id","closure_date");--> statement-breakpoint
CREATE INDEX "ix_check_events_received" ON "check_events" USING btree ("received_check_id");--> statement-breakpoint
CREATE INDEX "ix_check_events_issued" ON "check_events" USING btree ("issued_check_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_issued_checks_number" ON "issued_checks" USING btree ("bank_account_id","number");--> statement-breakpoint
CREATE INDEX "ix_issued_checks_status_date" ON "issued_checks" USING btree ("status","payment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_received_checks" ON "received_checks" USING btree ("issuer_bank_id","number","drawer_tax_id") WHERE "received_checks"."status" <> 'ANNULLED';--> statement-breakpoint
CREATE INDEX "ix_received_checks_status_date" ON "received_checks" USING btree ("status","payment_date");--> statement-breakpoint
CREATE INDEX "ix_treasury_cash" ON "treasury_movements" USING btree ("cash_box_id","movement_date","id");--> statement-breakpoint
CREATE INDEX "ix_treasury_bank" ON "treasury_movements" USING btree ("bank_account_id","movement_date","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_treasury_collection_line" ON "treasury_movements" USING btree ("collection_line_id") WHERE "treasury_movements"."collection_line_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_treasury_payment_line" ON "treasury_movements" USING btree ("payment_line_id") WHERE "treasury_movements"."payment_line_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_treasury_check_event" ON "treasury_movements" USING btree ("check_event_id") WHERE "treasury_movements"."check_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_treasury_transfer" ON "treasury_movements" USING btree ("account_transfer_id","direction") WHERE "treasury_movements"."account_transfer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_treasury_refund" ON "treasury_movements" USING btree ("refund_id") WHERE "treasury_movements"."refund_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_treasury_cash_closure" ON "treasury_movements" USING btree ("cash_closure_id") WHERE "treasury_movements"."cash_closure_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_treasury_reversal" ON "treasury_movements" USING btree ("reversal_of_id") WHERE "treasury_movements"."reversal_of_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_treasury_opening_cash" ON "treasury_movements" USING btree ("cash_box_id") WHERE "treasury_movements"."origin_type" = 'OPENING' AND "treasury_movements"."cash_box_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_treasury_opening_bank" ON "treasury_movements" USING btree ("bank_account_id") WHERE "treasury_movements"."origin_type" = 'OPENING' AND "treasury_movements"."bank_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_allocations_target" ON "allocations" USING btree ("target_document_id");--> statement-breakpoint
CREATE INDEX "ix_allocations_collection" ON "allocations" USING btree ("source_collection_id");--> statement-breakpoint
CREATE INDEX "ix_allocations_payment" ON "allocations" USING btree ("source_payment_id");--> statement-breakpoint
CREATE INDEX "ix_allocations_source_doc" ON "allocations" USING btree ("source_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_collection_lines_no" ON "collection_lines" USING btree ("collection_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_collections_client_date" ON "collections" USING btree ("client_id","collection_date");--> statement-breakpoint
CREATE INDEX "ix_customer_entries_client" ON "customer_account_entries" USING btree ("client_id","entry_date","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_customer_entries_document" ON "customer_account_entries" USING btree ("document_id","entry_type") WHERE "customer_account_entries"."document_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_customer_entries_collection" ON "customer_account_entries" USING btree ("collection_id","entry_type") WHERE "customer_account_entries"."collection_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_payment_lines_no" ON "payment_lines" USING btree ("payment_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_payment_lines_received_check" ON "payment_lines" USING btree ("received_check_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_entries_supplier" ON "supplier_account_entries" USING btree ("supplier_id","entry_date","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_supplier_entries_document" ON "supplier_account_entries" USING btree ("document_id","entry_type") WHERE "supplier_account_entries"."document_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_supplier_entries_payment" ON "supplier_account_entries" USING btree ("payment_id","entry_type") WHERE "supplier_account_entries"."payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_supplier_payments_supplier_date" ON "supplier_payments" USING btree ("supplier_id","payment_date");--> statement-breakpoint
CREATE INDEX "ix_audit_entity" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ix_audit_user_time" ON "audit_log" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_audit_module_time" ON "audit_log" USING btree ("module","occurred_at");