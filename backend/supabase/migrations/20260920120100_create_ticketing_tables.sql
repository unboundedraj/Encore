-- Shows, bookings, and the seat allocation that must never double-book.
-- All objects are `encore_` prefixed; see the core tables migration for why.

create type encore_content_type as enum ('movie', 'event');
create type encore_seating_mode as enum ('assigned', 'general');
create type encore_booking_status as enum ('pending', 'confirmed', 'cancelled', 'expired');

-- ---------------------------------------------------------------------------
-- encore_shows
-- ---------------------------------------------------------------------------
-- A show is one screening/performance. It is the join point between the Mongo
-- catalog (content_id) and the Postgres ticketing world.
--
-- Two seating modes, and the CHECK below is what stops one from polluting the
-- other:
--   assigned -- movies with a seat map. screen_id required, total_capacity NULL.
--               Inventory is encore_seats; a sale is rows in
--               encore_booking_seats.
--   general  -- standing/GA events. screen_id NULL, total_capacity required.
--               Inventory is a counter; a sale is encore_bookings.quantity.
create table encore_shows (
  id uuid primary key default gen_random_uuid(),
  content_id text not null,
  content_type encore_content_type not null,
  venue_id uuid not null,
  screen_id uuid,
  seating_mode encore_seating_mode not null,
  start_time timestamptz not null,
  price integer not null,
  total_capacity integer,
  created_at timestamptz not null default now(),

  -- content_id points at a MongoDB ObjectId. Postgres cannot foreign-key across
  -- databases, so the next best guarantee is shape: 24 hex chars. This catches
  -- the common bug of writing a title or a slug into this column.
  constraint encore_shows_content_id_format_check check (content_id ~ '^[0-9a-f]{24}$'),

  constraint encore_shows_price_check check (price >= 0),

  -- The mode invariant. Every column that belongs to only one mode is forced
  -- NULL in the other, so an 'assigned' show can never grow a stray capacity
  -- counter and a 'general' show can never point at a seat map.
  constraint encore_shows_seating_mode_check check (
    (seating_mode = 'assigned'
      and screen_id is not null
      and total_capacity is null)
    or
    (seating_mode = 'general'
      and screen_id is null
      and total_capacity is not null
      and total_capacity > 0)
  ),

  -- ON DELETE RESTRICT: same reasoning as encore_screens -- a venue with
  -- scheduled shows is live inventory, not something to cascade away.
  constraint encore_shows_venue_id_fkey foreign key (venue_id)
    references encore_venues (id) on delete restrict on update cascade,

  -- Composite FK, not a plain screen_id FK. This additionally proves the screen
  -- belongs to this show's venue, making "show at venue A seated on venue B's
  -- screen" unrepresentable. screen_id is NULL for general admission and
  -- MATCH SIMPLE skips the check entirely in that case, which is what we want.
  constraint encore_shows_screen_id_venue_id_fkey foreign key (screen_id, venue_id)
    references encore_screens (id, venue_id) on delete restrict on update cascade,

  -- FK targets for encore_bookings and encore_booking_seats (see below).
  -- Neither constrains anything new, since id alone is already unique.
  constraint encore_shows_id_seating_mode_key unique (id, seating_mode),
  constraint encore_shows_id_screen_id_key unique (id, screen_id)
);

-- Showtimes for one title, the movie detail page.
create index encore_shows_content_id_start_time_idx on encore_shows (content_id, start_time);
-- Showtimes at one venue, the venue page.
create index encore_shows_venue_id_start_time_idx on encore_shows (venue_id, start_time);
-- "What's on today" across everything.
create index encore_shows_start_time_idx on encore_shows (start_time);
-- A screen's schedule, and it keeps the encore_screens RESTRICT check cheap.
create index encore_shows_screen_id_start_time_idx on encore_shows (screen_id, start_time)
  where screen_id is not null;

-- ---------------------------------------------------------------------------
-- encore_bookings
-- ---------------------------------------------------------------------------
create table encore_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  show_id uuid not null,
  -- Denormalized from encore_shows. Not app-maintained: the composite FK below
  -- makes Postgres itself guarantee it equals the show's mode.
  seating_mode encore_seating_mode not null,
  status encore_booking_status not null default 'pending',
  quantity integer,
  total_amount integer not null,
  created_at timestamptz not null default now(),

  constraint encore_bookings_total_amount_check check (total_amount >= 0),

  -- The booking half of the mode invariant. A general-admission booking is a
  -- quantity; an assigned booking is rows in encore_booking_seats and must not
  -- carry a quantity that could disagree with how many seats it actually holds.
  constraint encore_bookings_quantity_check check (
    (seating_mode = 'general' and quantity is not null and quantity > 0)
    or
    (seating_mode = 'assigned' and quantity is null)
  ),

  -- ON DELETE RESTRICT: deleting a user must not delete their purchase history,
  -- which we are required to retain for tax/audit. GDPR erasure is handled by
  -- scrubbing PII on the encore_users row (email, name), not by deleting it.
  constraint encore_bookings_user_id_fkey foreign key (user_id)
    references encore_users (id) on delete restrict on update cascade,

  -- ON DELETE RESTRICT: this is the "what happens to bookings if a show is
  -- deleted" question. Answer: the delete is refused. A show with bookings
  -- against it represents money taken. Cancelling a show is a state change --
  -- move its bookings to 'cancelled' and refund -- never a row delete.
  -- The composite form also pins seating_mode to the show's, which is what lets
  -- the CHECK above be trusted.
  constraint encore_bookings_show_id_seating_mode_fkey foreign key (show_id, seating_mode)
    references encore_shows (id, seating_mode) on delete restrict on update cascade,

  -- FK target for encore_booking_seats. Carrying show_id and status here is
  -- what lets the partial unique index on that table work at all -- see below.
  constraint encore_bookings_id_show_id_status_key unique (id, show_id, status)
);

-- A user's booking history, newest first.
create index encore_bookings_user_id_created_at_idx
  on encore_bookings (user_id, created_at desc);
-- Bookings for a show, and the GA capacity sum (which filters on status).
create index encore_bookings_show_id_status_idx on encore_bookings (show_id, status);
-- Drives the sweeper that expires abandoned checkouts. Partial, because
-- pending rows are a tiny and short-lived slice of this table.
create index encore_bookings_pending_created_at_idx on encore_bookings (created_at)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- encore_booking_seats
-- ---------------------------------------------------------------------------
-- Assigned-seating line items. Never written for general-admission bookings --
-- that is enforced structurally: screen_id is NOT NULL here and a general
-- admission show has screen_id NULL, so the FK to encore_shows (id, screen_id)
-- cannot be satisfied for a GA show.
--
-- WHY show_id AND status ARE DUPLICATED HERE
--
-- The requirement is: no two CONFIRMED bookings may hold the same
-- (show_id, seat_id). Consider the options.
--
-- 1. A plain UNIQUE (show_id, seat_id). Wrong -- it is not scoped to confirmed,
--    so the first cancelled or expired booking would burn that seat for the
--    life of the show. Seats must return to inventory when a hold lapses.
--
-- 2. A partial unique index scoped to confirmed. Correct in shape, but a
--    unique index can only reference columns of its own table and its WHERE
--    clause cannot reach into another table. show_id and status both live on
--    encore_bookings, so as specified this index is simply not expressible.
--
-- 3. A trigger that queries encore_bookings on write. Expressible, but it is a
--    read-then-write check: two transactions confirming the same seat can both
--    see it free and both commit unless we hand-roll row locking. Correctness
--    would depend on every future write path remembering to take that lock.
--
-- So: option 2, made expressible by copying show_id and status onto this table.
-- The copies are not application-maintained -- keeping them in sync by hand
-- would just relocate the bug. The composite FK below references
-- encore_bookings (id, show_id, status) with ON UPDATE CASCADE, so when a
-- booking's status changes Postgres rewrites status on every child row in the
-- same statement. The denormalized columns are therefore provably equal to the
-- parent's at all times, and the partial unique index over them is exact.
--
-- The useful consequence: UPDATE encore_bookings SET status = 'confirmed'
-- cascades into these rows, which is the moment the partial unique index is
-- evaluated. Two racing confirmations for one seat means one of them fails on a
-- unique violation, decided by the index, under whatever isolation level. There
-- is no check-then-act window to get wrong.
create table encore_booking_seats (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  show_id uuid not null,
  screen_id uuid not null,
  seat_id uuid not null,
  -- Defaults to 'pending' because seats are attached while the booking is still
  -- pending; after that the cascade owns this column, not the application.
  status encore_booking_status not null default 'pending',
  created_at timestamptz not null default now(),

  -- ON DELETE CASCADE: these are line items with no independent meaning. A
  -- booking that still has a payment row cannot be deleted at all
  -- (encore_payments RESTRICT), so in practice this only fires for abandoned
  -- pending bookings the sweeper cleans up.
  -- ON UPDATE CASCADE: the mechanism described above -- this is what keeps
  -- status honest.
  constraint encore_booking_seats_booking_id_show_id_status_fkey
    foreign key (booking_id, show_id, status)
    references encore_bookings (id, show_id, status)
    on delete cascade on update cascade,

  -- Proves show_id names a real show and pins that show's screen. Combined with
  -- the next constraint this makes "seat from screen 3 sold for a show on
  -- screen 1" unrepresentable, and blocks GA shows outright.
  constraint encore_booking_seats_show_id_screen_id_fkey
    foreign key (show_id, screen_id)
    references encore_shows (id, screen_id) on delete restrict on update cascade,

  -- ON DELETE RESTRICT: a seat that has been sold is part of the audit trail.
  -- This is also what makes the encore_seats -> encore_screens CASCADE safe.
  constraint encore_booking_seats_seat_id_screen_id_fkey
    foreign key (seat_id, screen_id)
    references encore_seats (id, screen_id) on delete restrict on update cascade,

  -- One booking cannot list the same seat twice.
  constraint encore_booking_seats_booking_id_seat_id_key unique (booking_id, seat_id)
);

-- THE constraint. Partial, so only confirmed rows occupy the index and
-- cancelled/expired/pending rows fall out of it, returning the seat to
-- inventory automatically.
--
-- Note what is deliberately NOT covered: 'pending'. Two users may hold the same
-- seat in a pending booking at once. That short-lived exclusivity is Redis's
-- job (a TTL'd seat lock during checkout), because a seat hold must expire on
-- its own and a database constraint has no notion of time. Postgres owns the
-- permanent invariant; Redis owns the temporary one. If Redis is down or a lock
-- is lost, the worst case is a user reaching payment and losing the race at
-- confirmation -- a bad experience, but never a double sale.
create unique index encore_booking_seats_confirmed_show_id_seat_id_key
  on encore_booking_seats (show_id, seat_id)
  where status = 'confirmed';

-- Seat map rendering: which seats are taken for this show.
create index encore_booking_seats_show_id_status_idx
  on encore_booking_seats (show_id, status);
-- Keeps the encore_seats RESTRICT check cheap.
create index encore_booking_seats_seat_id_idx on encore_booking_seats (seat_id);

-- ---------------------------------------------------------------------------
-- Row Level Security (see note in the core tables migration)
-- ---------------------------------------------------------------------------
alter table encore_shows enable row level security;
alter table encore_bookings enable row level security;
alter table encore_booking_seats enable row level security;
