/**
 * Live verification against the real Supabase Postgres.
 *
 * Two parts:
 *   1. Catalog introspection -- the 8 tables, 6 enum types, the composite
 *      foreign key and the partial unique index exist exactly as designed.
 *   2. A behavioural integration test -- a real booking flow, ending with the
 *      double-booking constraint rejecting a second confirmation.
 *
 * Everything runs inside a single transaction that is ALWAYS rolled back, so
 * the live database is never modified. That is also why this uses a direct
 * Postgres connection rather than supabase-js: PostgREST cannot hold a
 * transaction open across requests, and cannot read pg_catalog.
 *
 * Requires SUPABASE_DB_URL (the direct connection string, or the pooler in
 * session mode). Run with: npm run verify:live -w backend
 */

import "dotenv/config";
import { Client } from "pg";

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;

const EXPECTED_TABLES = [
  "encore_booking_seats",
  "encore_bookings",
  "encore_payments",
  "encore_screens",
  "encore_seats",
  "encore_shows",
  "encore_users",
  "encore_venues",
];

const EXPECTED_ENUMS = [
  "encore_booking_status",
  "encore_content_type",
  "encore_payment_gateway",
  "encore_payment_status",
  "encore_seat_type",
  "encore_seating_mode",
];

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok   " : "FAIL "} ${label}${detail ? ` -- ${detail}` : ""}`);
  ok ? pass++ : fail++;
}

async function expectReject(client: Client, label: string, sql: string, expectConstraint: string) {
  // Each attempt runs in a savepoint so a rejection does not poison the
  // surrounding transaction.
  await client.query("savepoint attempt");
  try {
    await client.query(sql);
    await client.query("release savepoint attempt");
    check(label, false, "was accepted but should have been rejected");
  } catch (e) {
    await client.query("rollback to savepoint attempt");
    const err = e as { constraint?: string; message: string };
    const matched = err.constraint === expectConstraint;
    check(label, matched, matched ? `rejected by ${err.constraint}` : `rejected by ${err.constraint ?? err.message}, expected ${expectConstraint}`);
  }
}

async function main() {
  if (!DB_URL) {
    console.error(
      "SUPABASE_DB_URL is not set.\n\n" +
        "This is the direct Postgres connection string, which is separate from\n" +
        "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (those reach PostgREST, which\n" +
        "cannot run DDL, hold transactions, or read pg_catalog).\n\n" +
        "Supabase dashboard -> Project Settings -> Database -> Connection string -> URI\n" +
        "Add it to backend/.env as SUPABASE_DB_URL."
    );
    process.exit(2);
  }

  const client = new Client({
    connectionString: DB_URL,
    // Supabase requires TLS; its certificate chain is not in Node's default
    // store, so verification is relaxed for this admin/test connection only.
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const version = await client.query("select version()");
    console.log(`Connected: ${String(version.rows[0].version).split(",")[0]}\n`);

    // ---- 1. catalog ------------------------------------------------------
    console.log("=== tables ===");
    const tables = await client.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name like 'encore\\_%'
       order by table_name`
    );
    const found = tables.rows.map((r) => r.table_name);
    check(`all 8 encore_ tables exist`, found.length === 8, `found ${found.length}: ${found.join(", ")}`);
    for (const t of EXPECTED_TABLES) check(`  ${t}`, found.includes(t));

    console.log("\n=== enum types ===");
    const enums = await client.query(
      // ::text because node-postgres has no parser for name[]; it would hand
      // back the raw "{a,b}" string instead of an array.
      `select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
       from pg_type t
       join pg_enum e on e.enumtypid = t.oid
       join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typname like 'encore\\_%'
       group by t.typname order by t.typname`
    );
    const enumNames = enums.rows.map((r) => r.typname);
    check(`all 6 encore_ enum types exist`, enumNames.length === 6, `found ${enumNames.length}`);
    for (const r of enums.rows) {
      check(`  ${r.typname}`, EXPECTED_ENUMS.includes(r.typname), `[${r.labels.join(", ")}]`);
    }

    console.log("\n=== the composite FK (what keeps the denormalized columns honest) ===");
    const fk = await client.query(
      `select conname, pg_get_constraintdef(oid) as def
       from pg_constraint
       where conname = 'encore_booking_seats_booking_id_show_id_status_fkey'`
    );
    check("composite FK exists", fk.rowCount === 1);
    if (fk.rowCount) {
      const def = fk.rows[0].def as string;
      console.log(`        ${def}`);
      check("  references encore_bookings (id, show_id, status)",
        /REFERENCES encore_bookings\(id, show_id, status\)/i.test(def));
      check("  ON UPDATE CASCADE", /ON UPDATE CASCADE/i.test(def));
      check("  ON DELETE CASCADE", /ON DELETE CASCADE/i.test(def));
    }

    console.log("\n=== the partial unique index (the double-booking constraint) ===");
    const idx = await client.query(
      `select indexdef from pg_indexes
       where schemaname='public'
         and indexname='encore_booking_seats_confirmed_show_id_seat_id_key'`
    );
    check("partial unique index exists", idx.rowCount === 1);
    if (idx.rowCount) {
      const def = idx.rows[0].indexdef as string;
      console.log(`        ${def}`);
      check("  is UNIQUE", /CREATE UNIQUE INDEX/i.test(def));
      check("  on (show_id, seat_id)", /\(show_id, seat_id\)/i.test(def));
      check("  scoped WHERE status = 'confirmed'", /WHERE \(status = 'confirmed'/i.test(def));
    }

    console.log("\n=== RLS enabled on every table ===");
    const rls = await client.query(
      `select relname, relrowsecurity, (select count(*) from pg_policies p
          where p.schemaname='public' and p.tablename = c.relname) as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relname like 'encore\\_%' and c.relkind='r'
       order by relname`
    );
    check("RLS on all 8 tables", rls.rows.every((r) => r.relrowsecurity),
      rls.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname).join(", ") || "all enabled");
    check("zero policies (deny-all to the anon key)",
      rls.rows.every((r) => Number(r.policies) === 0));

    // ---- 2. behavioural --------------------------------------------------
    console.log("\n=== live booking flow (inside a transaction, rolled back) ===");
    await client.query("begin");

    const ids = {
      user: `test_${crypto.randomUUID()}`,
      venue: crypto.randomUUID(),
      screen: crypto.randomUUID(),
      seatA: crypto.randomUUID(),
      seatB: crypto.randomUUID(),
      show: crypto.randomUUID(),
      bookingAlice: crypto.randomUUID(),
      bookingBob: crypto.randomUUID(),
      bsAlice: crypto.randomUUID(),
      bsBob: crypto.randomUUID(),
    };

    await client.query(
      `insert into encore_users (id, email, name) values ($1, $2, 'Integration Test')`,
      [ids.user, `${ids.user}@test.invalid`]
    );
    await client.query(
      `insert into encore_venues (id, name, address, city) values ($1,'IT Venue','1 Test St','Testville')`,
      [ids.venue]
    );
    await client.query(
      `insert into encore_screens (id, venue_id, name, capacity) values ($1,$2,'Screen IT',120)`,
      [ids.screen, ids.venue]
    );
    await client.query(
      `insert into encore_seats (id, screen_id, row_label, seat_number, seat_type)
       values ($1,$3,'A',1,'standard'), ($2,$3,'A',2,'premium')`,
      [ids.seatA, ids.seatB, ids.screen]
    );
    await client.query(
      `insert into encore_shows (id, content_id, content_type, venue_id, screen_id, seating_mode, start_time, price)
       values ($1,'65f1a2b3c4d5e6f701020304','movie',$2,$3,'assigned', now() + interval '7 days', 35000)`,
      [ids.show, ids.venue, ids.screen]
    );
    check("seeded venue, screen, 2 seats and an assigned show", true);

    await client.query(
      `insert into encore_bookings (id,user_id,show_id,seating_mode,total_amount)
       values ($1,$2,$3,'assigned',35000)`,
      [ids.bookingAlice, ids.user, ids.show]
    );
    await client.query(
      `insert into encore_booking_seats (id,booking_id,show_id,screen_id,seat_id)
       values ($1,$2,$3,$4,$5)`,
      [ids.bsAlice, ids.bookingAlice, ids.show, ids.screen, ids.seatA]
    );
    check("Alice holds seat A1 (pending)", true);

    await client.query(`update encore_bookings set status='confirmed' where id=$1`, [ids.bookingAlice]);
    const cascaded = await client.query(`select status from encore_booking_seats where id=$1`, [ids.bsAlice]);
    check("confirming cascades status onto encore_booking_seats",
      cascaded.rows[0].status === "confirmed", `booking_seats.status = ${cascaded.rows[0].status}`);

    await client.query(
      `insert into encore_bookings (id,user_id,show_id,seating_mode,total_amount)
       values ($1,$2,$3,'assigned',35000)`,
      [ids.bookingBob, ids.user, ids.show]
    );
    await client.query(
      `insert into encore_booking_seats (id,booking_id,show_id,screen_id,seat_id)
       values ($1,$2,$3,$4,$5)`,
      [ids.bsBob, ids.bookingBob, ids.show, ids.screen, ids.seatA]
    );
    check("Bob may also hold seat A1 while pending (Redis's job, not the DB's)", true);

    await expectReject(
      client,
      "Bob confirming the same seat is REJECTED",
      `update encore_bookings set status='confirmed' where id='${ids.bookingBob}'`,
      "encore_booking_seats_confirmed_show_id_seat_id_key"
    );

    await client.query(`update encore_bookings set status='cancelled' where id=$1`, [ids.bookingAlice]);
    await client.query(`update encore_bookings set status='confirmed' where id=$1`, [ids.bookingBob]);
    const bobNow = await client.query(`select status from encore_booking_seats where id=$1`, [ids.bsBob]);
    check("after Alice cancels, Bob can confirm the freed seat",
      bobNow.rows[0].status === "confirmed");

    await expectReject(
      client,
      "forging booking_seats.status is REJECTED",
      `insert into encore_booking_seats (booking_id,show_id,screen_id,seat_id,status)
       values ('${ids.bookingAlice}','${ids.show}','${ids.screen}','${ids.seatB}','confirmed')`,
      "encore_booking_seats_booking_id_show_id_status_fkey"
    );

    await expectReject(
      client,
      "deleting a show that has bookings is REJECTED",
      `delete from encore_shows where id='${ids.show}'`,
      "encore_bookings_show_id_seating_mode_fkey"
    );

    // General admission: the show and a quantity booking are fine, but seat
    // rows against it must be structurally impossible.
    const gaShow = crypto.randomUUID();
    const gaBooking = crypto.randomUUID();
    await client.query(
      `insert into encore_shows (id,content_id,content_type,venue_id,seating_mode,start_time,price,total_capacity)
       values ($1,'65f1a2b3c4d5e6f701020399','event',$2,'general', now() + interval '8 days', 150000, 500)`,
      [gaShow, ids.venue]
    );
    await client.query(
      `insert into encore_bookings (id,user_id,show_id,seating_mode,quantity,total_amount)
       values ($1,$2,$3,'general',2,300000)`,
      [gaBooking, ids.user, gaShow]
    );
    check("general-admission show + quantity booking accepted", true);

    await expectReject(
      client,
      "seat rows against a general-admission show are REJECTED",
      `insert into encore_booking_seats (booking_id,show_id,screen_id,seat_id)
       values ('${gaBooking}','${gaShow}','${ids.screen}','${ids.seatB}')`,
      "encore_booking_seats_show_id_screen_id_fkey"
    );

    await expectReject(
      client,
      "an assigned booking carrying a quantity is REJECTED",
      `insert into encore_bookings (user_id,show_id,seating_mode,quantity,total_amount)
       values ('${ids.user}','${ids.show}','assigned',3,100)`,
      "encore_bookings_quantity_check"
    );
  } finally {
    // Always roll back. Nothing this script did is persisted.
    await client.query("rollback").catch(() => undefined);
    const leftover = await client
      .query(`select count(*)::int c from encore_venues where name = 'IT Venue'`)
      .catch(() => ({ rows: [{ c: -1 }] }));
    console.log(`\nRolled back. Leftover test venues in live DB: ${leftover.rows[0].c} (expected 0)`);
    await client.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}`);
  process.exit(1);
});
