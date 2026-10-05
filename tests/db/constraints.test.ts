/**
 * Pruebas de la última barrera: se intenta violar cada regla crítica escribiendo directamente
 * en la base (salteando servicios y UI). Todas deben ser rechazadas por PostgreSQL.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  appPool,
  q1,
  bank,
  concept,
  docType,
  expectDbError,
  insertDocument,
  invoiceA,
  makeBankAccount,
  makeCashBox,
  makeCashCollection,
  makeClient,
  makeDocument,
  makeSupplier,
  nextSeq,
  ownerPool,
  q,
  tx,
} from "./helpers";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

const allocate = (targetId: number, collectionId: number, amount: string) =>
  tx(async (c) => {
    await c.query(
      `INSERT INTO allocations (ledger, target_document_id, source_kind, source_collection_id, amount, allocation_date)
       VALUES ('AR', $1, 'COLLECTION', $2, $3, DATE '2026-10-02')`,
      [targetId, collectionId, amount],
    );
    await c.query(
      `UPDATE documents SET balance = balance - $2,
         status = CASE WHEN balance - $2 = 0 THEN 'SETTLED' ELSE 'PARTIAL' END WHERE id = $1`,
      [targetId, amount],
    );
    await c.query(`UPDATE collections SET unapplied_amount = unapplied_amount - $2 WHERE id = $1`, [collectionId, amount]);
  });

describe("DB-01 Comprobantes: total derivado de sus componentes", () => {
  it("acepta neto $100.000 + IVA 21% $21.000 = total $121.000 con saldo $121.000", async () => {
    const id = await invoiceA(await makeClient(), "100000.00");
    const d = await q1<{ total: string; balance: string; vat_total: string }>(
      "SELECT total, balance, vat_total FROM documents WHERE id = $1",
      [id],
    );
    expect(d).toEqual({ total: "121000.00", balance: "121000.00", vat_total: "21000.00" });
  });

  it("rechaza un total incompatible con netos, IVA, percepciones y descuentos", async () => {
    await expectDbError(
      invoiceA(await makeClient(), "100000.00", { header: { total: "121000.01", balance: "121000.01" } }),
      /ck_documents_total_formula/,
    );
  });

  it("rechaza una cabecera que no coincide con el detalle por alícuota (restricción diferida)", async () => {
    await expectDbError(
      invoiceA(await makeClient(), "100000.00", {
        header: { vat_total: "21000.50", total: "121000.50", balance: "121000.50" },
      }),
      /no coincide con el detalle tributario/,
    );
  });

  it("acepta múltiples alícuotas: 21% y 10,5% suman IVA $26.250", async () => {
    const id = await makeDocument({
      direction: "ISSUED",
      type: "FA",
      partyId: await makeClient(),
      lines: [
        { tax: "IVA_21", kind: "VAT", base: "100000", rate: "21.000", amount: "21000" },
        { tax: "IVA_10_5", kind: "VAT", base: "50000", rate: "10.500", amount: "5250" },
      ],
    });
    const d = await q1<{ vat_total: string; total: string }>("SELECT vat_total, total FROM documents WHERE id = $1", [id]);
    expect(d).toEqual({ vat_total: "26250.00", total: "176250.00" });
  });

  it("rechaza una línea de IVA cuya alícuota no coincide con el catálogo", async () => {
    await expectDbError(
      makeDocument({
        direction: "ISSUED",
        type: "FA",
        partyId: await makeClient(),
        lines: [{ tax: "IVA_21", kind: "VAT", base: "100", rate: "10.500", amount: "10.50" }],
      }),
      /no coincide con la del catálogo/,
    );
  });

  it("almacena importes exactos (0,10 + 0,20 = 0,30, sin errores de coma flotante)", async () => {
    const id = await makeDocument({
      direction: "ISSUED",
      type: "FA",
      partyId: await makeClient(),
      netUntaxed: "0.10",
      netExempt: "0.20",
    });
    const d = await q1<{ total: string }>("SELECT total FROM documents WHERE id = $1", [id]);
    expect(d.total).toBe("0.30");
  });
});

describe("DB-02 Comprobantes: duplicados", () => {
  it("rechaza tipo + punto de venta + número repetido en emitidos, aun para otro cliente", async () => {
    const number = nextSeq();
    await invoiceA(await makeClient(), "1000", { pos: 3, number });
    await expectDbError(invoiceA(await makeClient(), "500", { pos: 3, number }), /ux_documents_issued/);
  });

  it("permite volver a registrar el número si el registro anterior fue anulado (D3)", async () => {
    const number = nextSeq();
    const clientId = await makeClient();
    const id = await invoiceA(clientId, "1000", { pos: 4, number });
    await q(
      `UPDATE documents SET status = 'ANNULLED', balance = 0, annulled_at = now(), annul_reason = 'Error de carga' WHERE id = $1`,
      [id],
    );
    await expect(invoiceA(clientId, "1000", { pos: 4, number })).resolves.toBeGreaterThan(0);
  });

  it("en recibidos el contexto es el proveedor: mismo número de otro proveedor es válido", async () => {
    const number = nextSeq();
    const s1 = await makeSupplier();
    const doc = (supplierId: number) =>
      makeDocument({
        direction: "RECEIVED",
        type: "FA",
        partyId: supplierId,
        pos: 7,
        number,
        lines: [{ tax: "IVA_21", kind: "VAT", base: "100", rate: "21.000", amount: "21" }],
      });
    await doc(s1);
    await expect(doc(await makeSupplier())).resolves.toBeGreaterThan(0);
    await expectDbError(doc(s1), /ux_documents_received/);
  });
});

describe("DB-03 Comprobantes: reglas de tipo", () => {
  it("rechaza registrar como emitida una Factura C (la empresa no la emite)", async () => {
    await expectDbError(
      makeDocument({ direction: "ISSUED", type: "FC", partyId: await makeClient(), netUntaxed: "100" }),
      /no se admite en comprobantes emitidos/,
    );
  });

  it("rechaza IVA discriminado en una Factura B recibida", async () => {
    await expectDbError(
      makeDocument({
        direction: "RECEIVED",
        type: "FB",
        partyId: await makeSupplier(),
        lines: [{ tax: "IVA_21", kind: "VAT", base: "100", rate: "21.000", amount: "21" }],
      }),
      /no discrimina IVA/,
    );
  });

  it("exige motivo en notas de crédito", async () => {
    await expectDbError(
      makeDocument({ direction: "ISSUED", type: "NCA", partyId: await makeClient(), netUntaxed: "100" }),
      /requieren motivo/,
    );
  });

  it("exige que un emitido tenga cliente y no proveedor", async () => {
    await expectDbError(
      q(
        `INSERT INTO documents (direction, document_type_id, point_of_sale, number, supplier_id, party_name,
           party_vat_condition_id, issue_date, due_date, vat_period, net_untaxed, total, balance)
         VALUES ('ISSUED', $1, 1, $2, $3, 'X', (SELECT id FROM vat_conditions WHERE code='RI'),
           DATE '2026-10-01', DATE '2026-10-01', DATE '2026-10-01', 1, 1, 1)`,
        [await docType("FA"), nextSeq(), await makeSupplier()],
      ),
      /ck_documents_party/,
    );
  });

  it("rechaza vincular una NC con un comprobante de otro cliente", async () => {
    const inv = await invoiceA(await makeClient(), "100");
    const nc = await makeDocument({
      direction: "ISSUED",
      type: "NCA",
      partyId: await makeClient(),
      netUntaxed: "10",
      reason: "Bonificación",
    });
    await expectDbError(
      q("INSERT INTO document_relations (document_id, related_document_id, relation_type) VALUES ($1,$2,'CREDIT_NOTE_OF')", [
        nc,
        inv,
      ]),
      /mismo tercero/,
    );
  });
});

describe("DB-04 Imputaciones: sin sobreimputación", () => {
  it("imputación válida: comprobante $100.000, cobranza $40.000 → saldo $60.000", async () => {
    const clientId = await makeClient();
    const inv = await makeDocument({ direction: "ISSUED", type: "FA", partyId: clientId, netUntaxed: "100000" });
    const { collectionId } = await makeCashCollection(clientId, "40000.00", await makeCashBox());
    await allocate(inv, collectionId, "40000.00");
    const d = await q1<{ balance: string; status: string }>("SELECT balance, status FROM documents WHERE id = $1", [inv]);
    expect(d).toEqual({ balance: "60000.00", status: "PARTIAL" });
  });

  it("rechaza imputar más que el saldo del comprobante (saldo negativo)", async () => {
    const clientId = await makeClient();
    const inv = await makeDocument({ direction: "ISSUED", type: "FA", partyId: clientId, netUntaxed: "100" });
    const { collectionId } = await makeCashCollection(clientId, "500.00", await makeCashBox());
    await expectDbError(allocate(inv, collectionId, "150.00"), /ck_documents_balance|ck_documents_status_balance/);
  });

  it("rechaza imputar más que el importe disponible de la cobranza", async () => {
    const clientId = await makeClient();
    const inv = await makeDocument({ direction: "ISSUED", type: "FA", partyId: clientId, netUntaxed: "1000" });
    const { collectionId } = await makeCashCollection(clientId, "100.00", await makeCashBox());
    await expectDbError(allocate(inv, collectionId, "150.00"), /ck_collections_unapplied/);
  });

  it("rechaza una imputación que no actualiza el saldo cacheado (restricción diferida)", async () => {
    const clientId = await makeClient();
    const inv = await makeDocument({ direction: "ISSUED", type: "FA", partyId: clientId, netUntaxed: "1000" });
    const { collectionId } = await makeCashCollection(clientId, "100.00", await makeCashBox());
    await expectDbError(
      q(
        `INSERT INTO allocations (ledger, target_document_id, source_kind, source_collection_id, amount, allocation_date)
         VALUES ('AR', $1, 'COLLECTION', $2, 100, DATE '2026-10-02')`,
        [inv, collectionId],
      ),
      /saldo .* no coincide|saldo sin imputar/,
    );
  });

  it("rechaza imputar la cobranza de un cliente al comprobante de otro", async () => {
    const inv = await makeDocument({ direction: "ISSUED", type: "FA", partyId: await makeClient(), netUntaxed: "1000" });
    const { collectionId } = await makeCashCollection(await makeClient(), "100.00", await makeCashBox());
    await expectDbError(allocate(inv, collectionId, "100.00"), /clientes distintos/);
  });

  it("una imputación no puede editarse, solo revertirse", async () => {
    const clientId = await makeClient();
    const inv = await makeDocument({ direction: "ISSUED", type: "FA", partyId: clientId, netUntaxed: "1000" });
    const { collectionId } = await makeCashCollection(clientId, "100.00", await makeCashBox());
    await allocate(inv, collectionId, "100.00");
    await expectDbError(
      q("UPDATE allocations SET amount = 50 WHERE source_collection_id = $1", [collectionId]),
      /solo puede revertirse/,
    );
  });
});

describe("DB-05 Cobranzas y tesorería: sin doble impacto", () => {
  it("rechaza una cobranza cuyos medios no suman el total", async () => {
    const clientId = await makeClient();
    const cashBox = await makeCashBox();
    await expectDbError(
      tx(async (c) => {
        const col = (
          await c.query(
            `INSERT INTO collections (client_id, collection_date, total_amount, unapplied_amount, idempotency_key)
             VALUES ($1, DATE '2026-10-02', 100, 100, $2) RETURNING id`,
            [clientId, randomUUID()],
          )
        ).rows[0];
        await c.query(
          `INSERT INTO collection_lines (collection_id, line_no, method, amount, cash_box_id) VALUES ($1, 1, 'CASH', 90, $2)`,
          [col.id, cashBox],
        );
      }),
      /suma de medios/,
    );
  });

  it("rechaza registrar dos veces la misma cobranza (clave de idempotencia)", async () => {
    const clientId = await makeClient();
    const key = randomUUID();
    // Se prueba la unicidad dentro de una transacción (sin medios, el COMMIT fallaría por otra regla).
    await expectDbError(
      tx(async (c) => {
        await c.query("SET CONSTRAINTS ALL DEFERRED");
        await c.query(
          `INSERT INTO collections (client_id, collection_date, total_amount, unapplied_amount, idempotency_key)
           VALUES ($1, DATE '2026-10-02', 100, 100, $2)`,
          [clientId, key],
        );
        await c.query(
          `INSERT INTO collections (client_id, collection_date, total_amount, unapplied_amount, idempotency_key)
           VALUES ($1, DATE '2026-10-02', 100, 100, $2)`,
          [clientId, key],
        );
      }),
      /ux_collections_idempotency_key/,
    );
  });

  it("una línea de cobranza no puede generar dos movimientos de caja", async () => {
    const cashBox = await makeCashBox();
    const { lineId } = await makeCashCollection(await makeClient(), "100.00", cashBox);
    await expectDbError(
      q(
        `INSERT INTO treasury_movements (account_kind, cash_box_id, movement_date, direction, amount, description, origin_type, collection_line_id)
         VALUES ('CASH', $1, DATE '2026-10-02', 'IN', 100, 'Duplicado', 'COLLECTION_LINE', $2)`,
        [cashBox, lineId],
      ),
      /ux_treasury_collection_line/,
    );
  });

  it("caja: saldo inicial $500.000 + ingreso $100.000 − egreso $150.000 = $450.000", async () => {
    const cashBox = await makeCashBox();
    const mov = async (direction: string, amount: string, origin: string) =>
      q(
        `INSERT INTO treasury_movements (account_kind, cash_box_id, movement_date, direction, amount, description, origin_type, concept_id, idempotency_key)
         VALUES ('CASH', $1, DATE '2026-10-01', $2, $3, 'Prueba', $4, $5, $6)`,
        [cashBox, direction, amount, origin, await concept("OTROS_INGRESOS"), randomUUID()],
      );
    await mov("IN", "500000", "OPENING");
    await mov("IN", "100000", "MANUAL");
    const bal = async () =>
      (await q1<{ balance: string }>("SELECT balance FROM treasury_balances WHERE account_kind='CASH' AND account_id=$1", [cashBox]))
        .balance;
    expect(await bal()).toBe("600000.00");
    await mov("OUT", "150000", "MANUAL");
    expect(await bal()).toBe("450000.00");
    await expectDbError(mov("IN", "1", "OPENING"), /ux_treasury_opening_cash/);
  });

  it("un movimiento de tesorería no se puede editar ni borrar", async () => {
    const cashBox = await makeCashBox();
    await makeCashCollection(await makeClient(), "100.00", cashBox);
    await expectDbError(q("UPDATE treasury_movements SET amount = 1 WHERE cash_box_id = $1", [cashBox]), /inmutables/);
    await expectDbError(q("DELETE FROM treasury_movements WHERE cash_box_id = $1", [cashBox]), "42501");
    await expectDbError(
      q("DELETE FROM treasury_movements WHERE cash_box_id = $1", [cashBox], ownerPool),
      /No se permite eliminar/,
    );
  });

  it("una reversión debe ser el espejo exacto del movimiento original", async () => {
    const cashBox = await makeCashBox();
    await makeCashCollection(await makeClient(), "100.00", cashBox);
    const m = await q1<{ id: string }>("SELECT id FROM treasury_movements WHERE cash_box_id = $1", [cashBox]);
    const reverse = (amount: string, direction: string) =>
      q(
        `INSERT INTO treasury_movements (account_kind, cash_box_id, movement_date, direction, amount, description, origin_type, reversal_of_id)
         VALUES ('CASH', $1, DATE '2026-10-03', $2, $3, 'Reversión', 'REVERSAL', $4)`,
        [cashBox, direction, amount, m.id],
      );
    await expectDbError(reverse("90", "OUT"), /espejo exacto/);
    await expectDbError(reverse("100", "IN"), /espejo exacto/);
    await reverse("100", "OUT");
    await expectDbError(reverse("100", "OUT"), /ux_treasury_reversal/);
  });
});

describe("DB-06 Cheques", () => {
  const newReceivedCheck = async () => {
    const r = await q1<{ id: string }>(
      `INSERT INTO received_checks (format, check_type, issuer_bank_id, number, drawer_tax_id, drawer_name, issue_date, payment_date, amount)
       VALUES ('PHYSICAL','DEFERRED',$1,$2,'20111111112','Librador',DATE '2026-10-01',DATE '2026-11-01',1000) RETURNING id`,
      [await bank("007"), String(nextSeq())],
    );
    return Number(r.id);
  };

  it("un cheque recibido sigue su máquina de estados", async () => {
    const id = await newReceivedCheck();
    const bankAccount = await makeBankAccount();
    await q(`UPDATE received_checks SET status='DEPOSITED', deposit_bank_account_id=$2, deposited_at=DATE '2026-11-01' WHERE id=$1`, [
      id,
      bankAccount,
    ]);
    await expectDbError(q("UPDATE received_checks SET status='IN_PORTFOLIO' WHERE id=$1", [id]), /Transición de estado inválida/);
    await q("UPDATE received_checks SET status='CREDITED', credited_at=DATE '2026-11-03' WHERE id=$1", [id]);
    await expectDbError(q("UPDATE received_checks SET status='ENDORSED' WHERE id=$1", [id]), /Transición de estado inválida/);
  });

  it("los datos de un cheque recibido son inmutables", async () => {
    const id = await newReceivedCheck();
    await expectDbError(q("UPDATE received_checks SET amount = 2000 WHERE id=$1", [id]), /inmutables/);
  });

  it("un número de cheque propio no se repite en la misma cuenta", async () => {
    const acct = await makeBankAccount();
    const ins = () =>
      q(
        `INSERT INTO issued_checks (bank_account_id, format, check_type, number, amount, issue_date, payment_date)
         VALUES ($1,'ECHEQ','COMMON','00012345',500,DATE '2026-10-01',DATE '2026-10-01')`,
        [acct],
      );
    await ins();
    await expectDbError(ins(), /ux_issued_checks_number/);
  });

  it("un cheque propio no puede debitarse sin haberse entregado", async () => {
    const acct = await makeBankAccount();
    const c = await q1<{ id: string }>(
      `INSERT INTO issued_checks (bank_account_id, format, check_type, number, amount, issue_date, payment_date)
       VALUES ($1,'PHYSICAL','COMMON',$2,500,DATE '2026-10-01',DATE '2026-10-01') RETURNING id`,
      [acct, String(nextSeq())],
    );
    await expectDbError(
      q("UPDATE issued_checks SET status='DEBITED', debited_at=DATE '2026-10-05' WHERE id=$1", [c.id]),
      /Transición de estado inválida/,
    );
  });
});

describe("DB-07 Terceros y cuentas corrientes", () => {
  it("rechaza un CUIT duplicado salvo que se indique un motivo", async () => {
    const taxId = String(30_000_000_000 + nextSeq());
    await makeClient({ taxId });
    await expectDbError(makeClient({ taxId }), /ux_clients_tax_id/);
    await expect(makeClient({ taxId, duplicateTaxIdReason: "Sucursal Rosario" })).resolves.toBeGreaterThan(0);
  });

  it("no se puede borrar un cliente", async () => {
    const id = await makeClient();
    await expectDbError(q("DELETE FROM clients WHERE id=$1", [id]), "42501");
  });

  it("un asiento de cuenta corriente debe pertenecer al cliente del comprobante", async () => {
    const inv = await invoiceA(await makeClient(), "100");
    await expectDbError(
      q(
        `INSERT INTO customer_account_entries (client_id, entry_date, entry_type, document_id, debit, description)
         VALUES ($1, DATE '2026-10-01', 'DOCUMENT', $2, 121, 'Factura')`,
        [await makeClient(), inv],
      ),
      /no corresponde al cliente/,
    );
  });

  it("un comprobante no puede impactar dos veces en la cuenta corriente", async () => {
    const clientId = await makeClient();
    const inv = await invoiceA(clientId, "100");
    const entry = () =>
      q(
        `INSERT INTO customer_account_entries (client_id, entry_date, entry_type, document_id, debit, description)
         VALUES ($1, DATE '2026-10-01', 'DOCUMENT', $2, 121, 'Factura')`,
        [clientId, inv],
      );
    await entry();
    await expectDbError(entry(), /ux_customer_entries_document/);
  });

  it("un asiento tiene débito o crédito, nunca ambos", async () => {
    const clientId = await makeClient();
    const inv = await invoiceA(clientId, "100");
    await expectDbError(
      q(
        `INSERT INTO customer_account_entries (client_id, entry_date, entry_type, document_id, debit, credit, description)
         VALUES ($1, DATE '2026-10-01', 'DOCUMENT', $2, 121, 121, 'Factura')`,
        [clientId, inv],
      ),
      /ck_customer_entries_amounts/,
    );
  });
});

describe("DB-08 Auditoría inviolable", () => {
  const audit = () =>
    q(`INSERT INTO audit_log (module, action, entity_type, entity_id, after, result) VALUES ('test','create','x','1','{"a":1}','SUCCESS')`);

  it("encadena los registros con hash y la cadena verifica íntegra", async () => {
    await audit();
    await audit();
    const rows = await q<{ prev_hash: string; hash: string }>("SELECT prev_hash, hash FROM audit_log ORDER BY id DESC LIMIT 2");
    const [last, previous] = rows;
    expect(last?.prev_hash).toBe(previous?.hash);
    expect(last?.hash).toMatch(/^[0-9a-f]{64}$/);
    const v = await q1<{ broken: string | null }>("SELECT erp_verify_audit_chain() AS broken");
    expect(v.broken).toBeNull();
  });

  it("la aplicación no puede modificar ni borrar la auditoría; el dueño tampoco", async () => {
    await audit();
    await expectDbError(q("UPDATE audit_log SET action = 'x'"), "42501");
    await expectDbError(q("DELETE FROM audit_log"), "42501");
    await expectDbError(q("UPDATE audit_log SET action = 'x'", [], ownerPool), /inmutables/);
    await expectDbError(q("DELETE FROM audit_log", [], ownerPool), /No se permite eliminar/);
  });
});

describe("DB-09 Numeración interna concurrente", () => {
  it("50 numeraciones simultáneas producen 50 números distintos y consecutivos", async () => {
    const take = () =>
      tx(async (c) => {
        const r = await c.query(
          "UPDATE numbering_sequences SET next_value = next_value + 1 WHERE key = 'RECEIPT' RETURNING next_value - 1 AS n",
        );
        return Number(r.rows[0].n);
      });
    const nums = await Promise.all(Array.from({ length: 50 }, take));
    const sorted = [...nums].sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(50);
    expect(sorted.at(-1)! - sorted[0]!).toBe(49);
  });
});

describe("DB-10 Permisos del rol de la aplicación", () => {
  it("el rol de la aplicación no puede crear ni alterar tablas", async () => {
    await expectDbError(q("CREATE TABLE hack (id int)"), "42501");
    await expectDbError(q("ALTER TABLE documents DISABLE TRIGGER ALL"), "42501");
  });

  it("los tipos internos usan punto de venta 0 y los fiscales al menos 1", async () => {
    const clientId = await makeClient();
    await expectDbError(
      tx((c) => insertDocument(c, { direction: "ISSUED", type: "FA", partyId: clientId, pos: 0, netUntaxed: "1" })),
      /punto de venta entre 1 y 99999/,
    );
    expect(await docType("INT_SALDO_DEUDOR")).toBeGreaterThan(0);
  });
});
