# Encore data model

Two databases, split by what they are for:

| | Postgres (Supabase) | MongoDB |
|---|---|---|
| Holds | `encore_users`, `encore_venues`, `encore_screens`, `encore_seats`, `encore_shows`, `encore_bookings`, `encore_booking_seats`, `encore_payments` | the `content` collection |
| Optimised for | correctness — money and inventory | flexibility — a movie and a concert describe themselves differently |
| Enforcement | constraints, foreign keys, partial unique indexes | Mongoose schema validation |

The join between them is `encore_shows.content_id`, a MongoDB ObjectId stored as text.
Postgres cannot foreign-key across databases, so the closest available guarantee
is a `CHECK` that the value is 24 hex characters — enough to catch a slug or a
title being written into that column, which is the realistic failure.

## The `encore_` prefix

This Supabase project is shared with other applications on the same free tier —
as of the first push, `pradaan_` (11 tables/views) and `scorely_` (4 tables) —
and all of them live in the `public` schema. Every object Encore creates is therefore
prefixed `encore_` — **not just tables**:

| Object kind | Example |
|---|---|
| Tables | `encore_bookings` |
| Enum types | `encore_booking_status`, `encore_payment_status` |
| Constraints | `encore_bookings_quantity_check` |
| Indexes | `encore_shows_venue_id_start_time_idx` |

Enum types matter as much as tables here: they are schema-level objects too, so
an unprefixed `create type payment_status` would fail outright the moment the
other project already had one — the migration would not even apply.

TypeScript names are *not* prefixed. The `shared` package already namespaces
them, so `BookingStatus` maps to `encore_booking_status` and a `Booking` is a
row of `encore_bookings`. The mapping is noted in each type's docstring.

**The migration history table is shared, and cannot be prefixed.** The Supabase
CLI records applied migrations in `supabase_migrations.schema_migrations`, one
table per database. Encore's first `db push` created it, so today it holds only
Encore's versions. If another tenant of this database ever runs `supabase db push`,
the CLI will see Encore's versions as "remote migrations not found locally" and
refuse — and the fix it suggests, `supabase migration repair --status reverted`,
would delete Encore's history rows. Encore's own pushes would hit the mirror-image
problem. Anyone adopting CLI migrations on this database needs to coordinate
first.

> If the projects ever need stronger isolation than a naming convention, the
> alternative is a dedicated Postgres schema (`create schema encore`). That was
> not chosen here because Supabase's PostgREST only exposes `public` by default,
> so it would mean extra API configuration for no gain while the prefix holds.

## The two seating modes

Encore sells two fundamentally different things, and the schema keeps them
apart rather than blending them into one nullable mess.

**Assigned seating** — a movie screening. The venue has a `screen`, the screen
has a fixed `encore_seats` layout, and buying a ticket means claiming specific seats.
Inventory is the seat map. A sale is rows in `encore_booking_seats`.

**General admission** — a standing concert or a festival. There is no seat map,
just a headcount. Inventory is a number. A sale is `encore_bookings.quantity`.

These meet at `encore_shows.seating_mode`, and every column that belongs to only one
mode is forced `NULL` in the other:

| | `seating_mode = 'assigned'` | `seating_mode = 'general'` |
|---|---|---|
| `encore_shows.screen_id` | required | must be `NULL` |
| `encore_shows.total_capacity` | must be `NULL` | required, `> 0` |
| `encore_bookings.quantity` | must be `NULL` | required, `> 0` |
| `encore_booking_seats` rows | one per seat | none, and structurally impossible |
| Capacity check | seats not already confirmed | `SUM(quantity)` over confirmed bookings vs `total_capacity` |

`encore_shows_seating_mode_check` enforces the first two rows. The third is enforced on
`encore_bookings` by `encore_bookings_quantity_check`.

That last one needs care: `encore_bookings` has to know its show's mode to check its
own `quantity`, and a `CHECK` cannot read another table. So `encore_bookings` carries a
`seating_mode` column — but it is *not* maintained by application code. The
foreign key is composite:

```sql
foreign key (show_id, seating_mode) references encore_shows (id, seating_mode)
```

so Postgres itself refuses any booking whose mode disagrees with its show's.
The denormalized column is provably correct, which is what makes the `CHECK`
above trustworthy.

**A general-admission show cannot grow seat rows.** `encore_booking_seats.screen_id` is
`NOT NULL` and foreign-keys to `encore_shows (id, screen_id)`. A GA show has
`screen_id IS NULL`, so no row can satisfy that reference. The separation is
structural, not a convention someone has to remember.

## Preventing double-booked seats

The requirement: no two **confirmed** bookings may hold the same
`(show_id, seat_id)`. Three ways to express that, two of which are wrong.

**A plain `UNIQUE (show_id, seat_id)`** is wrong. It is not scoped to confirmed
bookings, so the first cancelled or expired booking would burn that seat for the
lifetime of the show. Seats must return to inventory when a hold lapses.

**A trigger** that queries `encore_bookings` on write is expressible, but it is a
read-then-write check: two transactions confirming the same seat can both see it
free and both commit, unless we hand-roll row locking. Correctness would then
depend on every future write path remembering to take that lock.

**A partial unique index scoped to confirmed** is the right shape:

```sql
create unique index encore_booking_seats_confirmed_show_id_seat_id_key
  on encore_booking_seats (show_id, seat_id)
  where status = 'confirmed';
```

But as specified it is not expressible. A unique index can only reference
columns of its own table, and its `WHERE` clause cannot reach into another
table — yet `show_id` and `status` both live on `encore_bookings`.

So `encore_booking_seats` carries copies of both. The copies are not application
maintained; keeping them in sync by hand would just move the bug. A composite
foreign key does it:

```sql
foreign key (booking_id, show_id, status)
  references encore_bookings (id, show_id, status)
  on delete cascade on update cascade
```

`encore_bookings.id` is already unique, so `UNIQUE (id, show_id, status)` on the parent
constrains nothing new — it exists purely to be a foreign-key target. The
payoff is `ON UPDATE CASCADE`: when a booking's status changes, Postgres
rewrites `status` on every child row **in the same statement**. The copies are
therefore always equal to the parent's, and the partial index over them is
exact. Neither column can be forged — writing an `encore_booking_seats` row with a
`show_id` or `status` that disagrees with its booking is rejected by the FK.

The useful consequence:

```sql
UPDATE encore_bookings SET status = 'confirmed' WHERE id = $1;
```

cascades into the seat rows, which is the moment the partial unique index is
evaluated. Two racing confirmations for the same seat means one of them fails on
a unique violation, decided by the index itself. There is no check-then-act
window to get wrong, at any isolation level.

### What the database deliberately does not do

`pending` is **not** covered by that index. Two users may hold the same seat in
a pending booking simultaneously.

That is intentional. A seat hold has to expire on its own after a few minutes,
and a database constraint has no notion of time — enforcing pending exclusivity
in Postgres would mean a sweeper job racing every checkout. Short-lived
exclusivity is Redis's job (a TTL'd lock taken when a user selects a seat).

The split: **Redis owns the temporary invariant, Postgres owns the permanent
one.** If Redis is down or a lock is lost, the worst case is that a user reaches
the payment step and loses the race at confirmation — a bad experience, but
never a double sale. The money-critical guarantee never depends on the cache
being up.

## Other cross-table invariants

Both use the same composite-FK technique, so they cost an index and no runtime
code:

- **A show's screen belongs to its venue.** `encore_shows (screen_id, venue_id)`
  references `encore_screens (id, venue_id)`, so a show at venue A cannot be seated on
  venue B's screen. `screen_id` is `NULL` for GA shows and `MATCH SIMPLE` skips
  the check entirely there, which is what we want.
- **A booked seat is on the show's screen.** `encore_booking_seats (seat_id, screen_id)`
  references `encore_seats (id, screen_id)`, and `(show_id, screen_id)` references
  `encore_shows (id, screen_id)`. Together they make "seat from screen 3 sold for a
  show on screen 1" unrepresentable.

## Deletion policy

The default is `RESTRICT`. Almost everything here is either a financial record
or is reachable from one, and cascading deletes through financial data is how
audit trails quietly disappear.

| Foreign key | On delete | Why |
|---|---|---|
| `encore_screens.venue_id` | `RESTRICT` | A venue reaches booking history transitively. Retire a venue by removing its future shows, not by deleting the row. |
| `encore_seats.screen_id` | `CASCADE` | A seat is part of a screen's physical layout and is meaningless without it. Safe because a *sold* seat is protected one level down. |
| `encore_shows.venue_id` | `RESTRICT` | A venue with scheduled shows is live inventory. |
| `encore_shows.(screen_id, venue_id)` | `RESTRICT` | Deleting a screen under a scheduled show would strand its seat map. |
| `encore_bookings.user_id` | `RESTRICT` | Purchase history is retained for tax and audit. GDPR erasure scrubs PII on the `encore_users` row; it does not delete it. |
| `encore_bookings.(show_id, seating_mode)` | `RESTRICT` | **What happens to bookings if a show is deleted: the delete is refused.** A show with bookings represents money taken. Cancelling a show is a state change — move its bookings to `cancelled` and refund — never a row delete. |
| `encore_booking_seats.(booking_id, …)` | `CASCADE` | Line items with no independent meaning. |
| `encore_booking_seats.(seat_id, screen_id)` | `RESTRICT` | A sold seat is part of the audit trail. This is also what makes the `encore_seats → encore_screens` cascade safe. |
| `encore_payments.booking_id` | `RESTRICT` | Never cascade a financial record. |

These compose into a sensible whole:

- A booking that has a payment **cannot be deleted at all** — `encore_payments`
  refuses it, even though `encore_booking_seats` would have cascaded happily.
- An abandoned `pending` booking with no payment **can** be deleted, and its
  seat rows go with it. That is what lets the expiry sweeper clean up.
- A screen whose seats have ever been sold cannot be deleted, because the
  cascade into `encore_seats` is blocked by `encore_booking_seats`.

`ON UPDATE CASCADE` is set on every foreign key. On the uuid keys it is a no-op
(primary keys never change); on the composite keys carrying `status` and
`seating_mode` it is the mechanism described above.

## Indexes

Beyond the primary keys and the unique constraints (which index their own
columns):

| Index | Serves |
|---|---|
| `encore_users (lower(email))` unique | Case-insensitive email uniqueness. A plain `UNIQUE` would let `Alice@x.com` and `alice@x.com` coexist. |
| `encore_venues (lower(city))` | "What's on in Mumbai" — top of the funnel. |
| `encore_seats (screen_id, row_label, seat_number)` unique | The layout constraint, and doubles as the seats-by-screen index. |
| `encore_shows (content_id, start_time)` | Showtimes for one title — the movie detail page. |
| `encore_shows (venue_id, start_time)` | Showtimes at one venue. |
| `encore_shows (start_time)` | "What's on today" across everything. |
| `encore_shows (screen_id, start_time)` partial | A screen's schedule; keeps the `encore_screens` RESTRICT check cheap. |
| `encore_bookings (user_id, created_at DESC)` | A user's booking history, newest first. |
| `encore_bookings (show_id, status)` | Bookings for a show, and the GA capacity sum. |
| `encore_bookings (created_at) WHERE status = 'pending'` | The expiry sweeper. Partial, because pending rows are a tiny, short-lived slice. |
| `encore_booking_seats (show_id, seat_id) WHERE status = 'confirmed'` | The double-booking constraint itself. |
| `encore_booking_seats (show_id, status)` | Seat map rendering — which seats are taken. |
| `encore_booking_seats (seat_id)` | Keeps the `encore_seats` RESTRICT check cheap. |
| `encore_payments (gateway, gateway_payment_id)` unique | Webhook idempotency. Both gateways retry deliveries; this turns a replay into a unique violation the handler can swallow instead of a second processed payment. |
| `encore_payments (status, created_at)` | Reconciliation sweeps for payments stuck pending. |

## Conventions

- **Money is integer minor units** (cents/paise), never `numeric` or float.
  Stripe and Razorpay both transact in minor units, and `numeric` round-trips
  through node-postgres as a *string*, which would make the shared TypeScript
  types dishonest.
- **Timestamps are `timestamptz`**, always.
- **`encore_users.id` is text**, not a generated uuid — it is the Firebase UID.
  Firebase owns identity; this table is the local projection we can foreign-key
  to.
- **RLS is enabled on every table with no policies.** Supabase exposes tables
  through PostgREST using the publicly-shipped anon key. Auth here is Firebase,
  not Supabase Auth, so `auth.uid()` policies do not apply — the backend
  connects with the service role key, which bypasses RLS. Enabling RLS with zero
  policies means nothing is reachable with the anon key and everything is
  reachable from our own API. Without it, anyone with the anon key could read
  every booking.

## Not yet enforced

Deliberate gaps, listed so they are decisions rather than oversights:

- **Overlapping shows on one screen.** Needs an `end_time` and an exclusion
  constraint over a `tstzrange`. `encore_shows` has no `end_time` yet; runtime comes
  from the Mongo catalog.
- **Seat count within a screen's capacity.** `COUNT(*)` over `encore_seats` vs
  `encore_screens.capacity` is cross-row, so it needs a trigger or a maintained
  counter.
- **General-admission capacity.** `SUM(quantity)` over confirmed bookings vs
  `total_capacity` is cross-row and cannot be a `CHECK`. It needs a serialized
  transaction or a Redis counter at sale time — the GA equivalent of seat
  locking.

## The MongoDB side

`backend/src/models/Content.ts` defines the `content` collection: one collection
holding both movies and events, via Mongoose discriminators on a `type` key. The
file's header comment explains why Mongoose rather than a plain interface plus
Zod. In short: discriminators are purpose-built for shared-fields-plus-variant,
Mongo has no DDL so validation has to live somewhere every write path goes
through, and the catalog is descriptive content — a bad value here is a wrong
poster, not a double sale.

The `encore_` prefix does not apply there. It exists to avoid collisions in a
shared Supabase `public` schema; the MongoDB database is Encore's own, so the
collection stays `content`.
