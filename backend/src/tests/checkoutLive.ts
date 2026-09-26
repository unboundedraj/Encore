/**
 * End-to-end checkout against Stripe's test-mode API.
 *
 * Separate from checkoutWebhook.ts because this one genuinely needs a real
 * test-mode secret key: it creates actual Checkout Sessions. Everything that
 * can be proven without touching Stripe's API -- signature verification,
 * idempotency, the commit-before-release ordering -- lives in that file and
 * runs with no credentials at all.
 *
 * Covers the double-click case, which is the part that needs real sessions:
 * a second checkout for an unchanged selection must hand back the same
 * session rather than opening a second one.
 *
 * Requires a running backend (npm run dev) and a real STRIPE_SECRET_KEY.
 * No card is ever charged -- sessions are created and then abandoned.
 *
 * Run with: npm run test:checkout:live -w backend
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getPool, closePool } from "../config/postgres";
import { connectRedis, disconnectRedis } from "../config/redis";
import { holdSeats, releaseSeats } from "../services/lockService";

const API = `http://localhost:${process.env.PORT ?? 4000}`;
const SHOW_ID = "a4620294-915a-4671-be81-03e313c9df81";
const GA_SHOW_ID = "aed18429-63c1-4165-9d1f-17ae3b2688c8";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok   " : "FAIL "} ${label}${detail ? ` -- ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

function requireRealKeys(): void {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_") || /your|placeholder/i.test(key)) {
    console.error(
      "STRIPE_SECRET_KEY is missing or still a placeholder.\n\n" +
        "This test creates real (test-mode) Stripe Checkout Sessions, so it needs a\n" +
        "genuine sk_test_... key in backend/.env. Nothing is charged.\n\n" +
        "Dashboard -> Developers -> API keys -> Secret key (test mode).\n\n" +
        "The webhook, idempotency and ordering tests do not need this key and are\n" +
        "run separately with: npm run test:checkout -w backend"
    );
    process.exit(2);
  }
}

/** A Firebase ID token for a throwaway user, via the Auth REST API. */
async function signUp(email: string): Promise<{ token: string; uid: string }> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY ?? process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error("No Firebase web API key available to mint a test token.");

  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: `Ck${randomUUID().slice(0, 12)}!`, returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken?: string; localId?: string; error?: unknown };
  if (!res.ok || !body.idToken) throw new Error(`signup failed: ${JSON.stringify(body.error)}`);
  return { token: body.idToken, uid: body.localId as string };
}

async function main() {
  requireRealKeys();
  await connectRedis();

  const stamp = Date.now();
  const user = await signUp(`checkout-live-${stamp}@example.com`);
  const created: string[] = [];

  const { rows: seatRows } = await getPool().query<{ id: string }>(
    `select id from encore_seats
     where screen_id = (select screen_id from encore_shows where id = $1)
     order by row_label, seat_number limit 3`,
    [SHOW_ID]
  );
  const seats = seatRows.map((r) => r.id);

  const call = (path: string, body: unknown) =>
    fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify(body),
    });

  try {
    console.log("=== checkout requires a live hold ===");
    const noHold = await call(`/api/shows/${SHOW_ID}/checkout`, { seatIds: [seats[0]] });
    check(
      "checking out seats you do not hold is refused",
      noHold.status === 409,
      `got ${noHold.status}`
    );

    console.log("\n=== successful checkout ===");
    await holdSeats(SHOW_ID, [seats[0], seats[1]], user.uid);
    const first = await call(`/api/shows/${SHOW_ID}/checkout`, { seatIds: [seats[0], seats[1]] });
    const firstBody = (await first.json()) as {
      booking_id?: string; checkout_url?: string; amount?: number; reused?: boolean;
    };
    check("checkout succeeds with a held selection", first.status === 200, `got ${first.status}`);
    check("a Stripe session URL is returned", Boolean(firstBody.checkout_url?.startsWith("https://")),
      firstBody.checkout_url?.slice(0, 40));
    check("the amount is seats x show price", firstBody.amount === 70000, `${firstBody.amount}`);
    if (firstBody.booking_id) created.push(firstBody.booking_id);

    const { rows: bookingRows } = await getPool().query<{ status: string; n: string }>(
      `select b.status, count(bs.id) n from encore_bookings b
       left join encore_booking_seats bs on bs.booking_id = b.id
       where b.id = $1 group by b.status`,
      [firstBody.booking_id]
    );
    check("a pending booking exists with two seat rows",
      bookingRows[0]?.status === "pending" && bookingRows[0]?.n === "2",
      JSON.stringify(bookingRows[0]));

    console.log("\n=== the double-click ===");
    const second = await call(`/api/shows/${SHOW_ID}/checkout`, { seatIds: [seats[0], seats[1]] });
    const secondBody = (await second.json()) as { booking_id?: string; checkout_url?: string; reused?: boolean };
    check("a second identical checkout succeeds", second.status === 200, `got ${second.status}`);
    check("it reuses the same booking rather than creating another",
      secondBody.booking_id === firstBody.booking_id,
      `${secondBody.booking_id} vs ${firstBody.booking_id}`);
    check("and hands back the same Stripe session",
      secondBody.checkout_url === firstBody.checkout_url && secondBody.reused === true);

    const { rows: countRows } = await getPool().query<{ n: string }>(
      `select count(*) n from encore_bookings where user_id = $1 and show_id = $2 and status = 'pending'`,
      [user.uid, SHOW_ID]
    );
    check("exactly one pending booking exists, not two", countRows[0].n === "1", `${countRows[0].n}`);

    console.log("\n=== changing the selection supersedes the old booking ===");
    await releaseSeats(SHOW_ID, [seats[1]], user.uid);
    await holdSeats(SHOW_ID, [seats[2]], user.uid);
    const changed = await call(`/api/shows/${SHOW_ID}/checkout`, { seatIds: [seats[0], seats[2]] });
    const changedBody = (await changed.json()) as { booking_id?: string };
    check("a different selection starts a new booking", changed.status === 200 && changedBody.booking_id !== firstBody.booking_id,
      `${changedBody.booking_id}`);
    if (changedBody.booking_id) created.push(changedBody.booking_id);
    check("and the superseded one is cancelled",
      (await getPool().query<{ status: string }>(`select status from encore_bookings where id = $1`, [firstBody.booking_id]))
        .rows[0]?.status === "cancelled");

    console.log("\n=== general admission ===");
    const gaNoHold = await call(`/api/shows/${GA_SHOW_ID}/checkout`, { quantity: 3 });
    check("GA checkout without a hold is refused", gaNoHold.status === 409, `got ${gaNoHold.status}`);
  } finally {
    console.log("\n=== cleanup ===");
    await releaseSeats(SHOW_ID, seats, user.uid).catch(() => undefined);
    if (created.length) {
      await getPool().query(`delete from encore_payments where booking_id = any($1)`, [created]);
      await getPool().query(`delete from encore_booking_seats where booking_id = any($1)`, [created]);
      await getPool().query(`delete from encore_bookings where id = any($1)`, [created]);
    }
    await getPool().query(`delete from encore_users where id = $1`, [user.uid]);
    console.log(`  removed ${created.length} booking(s); Firebase user ${user.uid} left for manual cleanup`);
    await disconnectRedis();
    await closePool();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`\nFailed: ${err.message}`);
  await disconnectRedis().catch(() => undefined);
  await closePool().catch(() => undefined);
  process.exit(1);
});
