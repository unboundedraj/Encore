-- Core reference data: users, venues, screens, and the physical seat layout.
--
-- Everything Encore creates is prefixed `encore_`. This Supabase project is
-- shared with another application on the same free tier, and both live in the
-- `public` schema -- so tables, enum types, constraints and indexes all need
-- namespacing, not just tables. An unprefixed `create type payment_status`
-- would fail outright the moment the other project already had one.
--
-- Money is stored as integer minor units (cents/paise), never numeric or float:
-- Stripe and Razorpay both transact in minor units, and numeric round-trips
-- through node-postgres as a string, which would make the shared TypeScript
-- types dishonest.

create type encore_seat_type as enum ('standard', 'premium');

-- ---------------------------------------------------------------------------
-- encore_users
-- ---------------------------------------------------------------------------
-- id is the Firebase UID, so it is text rather than a generated uuid. Firebase
-- owns the identity; this table is the local projection we can foreign-key to.
create table encore_users (
  id text primary key,
  email text not null,
  name text,
  created_at timestamptz not null default now(),

  constraint encore_users_id_length_check check (char_length(id) between 1 and 128),
  constraint encore_users_email_format_check check (position('@' in email) > 1)
);

-- name is nullable on purpose: email/password Firebase signups have no
-- displayName until the user sets one, and a NOT NULL here would force the
-- backend to invent a placeholder.

-- Email uniqueness must be case-insensitive; a plain UNIQUE would let
-- Alice@x.com and alice@x.com both exist.
create unique index encore_users_email_lower_key on encore_users (lower(email));

-- ---------------------------------------------------------------------------
-- encore_venues
-- ---------------------------------------------------------------------------
create table encore_venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  city text not null,
  created_at timestamptz not null default now()
);

-- "What's playing in Mumbai" is the top-of-funnel query for the whole product.
create index encore_venues_city_lower_idx on encore_venues (lower(city));

-- ---------------------------------------------------------------------------
-- encore_screens
-- ---------------------------------------------------------------------------
create table encore_screens (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null,
  name text not null,
  capacity integer not null,
  created_at timestamptz not null default now(),

  constraint encore_screens_capacity_check check (capacity > 0),

  -- ON DELETE RESTRICT: a venue reaches booking history transitively
  -- (encore_venues -> encore_screens -> encore_seats -> encore_booking_seats).
  -- Cascading a venue delete would silently destroy financial records. Retiring
  -- a venue should mean removing its future shows, not deleting the row.
  constraint encore_screens_venue_id_fkey foreign key (venue_id)
    references encore_venues (id) on delete restrict on update cascade,

  constraint encore_screens_venue_id_name_key unique (venue_id, name),

  -- Not a business rule. This exists purely so `encore_shows` can carry a
  -- composite foreign key proving its screen belongs to its venue. id is
  -- already unique, so this constrains nothing new.
  constraint encore_screens_id_venue_id_key unique (id, venue_id)
);

-- encore_screens_venue_id_name_key already indexes venue_id as its leading
-- column, so no separate index on venue_id is needed.

-- ---------------------------------------------------------------------------
-- encore_seats
-- ---------------------------------------------------------------------------
-- The physical seat map of a screen. Rows here are long-lived: a seat is
-- referenced by historical bookings, so it is never rewritten per show.
create table encore_seats (
  id uuid primary key default gen_random_uuid(),
  screen_id uuid not null,
  row_label text not null,
  seat_number integer not null,
  seat_type encore_seat_type not null default 'standard',
  created_at timestamptz not null default now(),

  constraint encore_seats_seat_number_check check (seat_number > 0),
  constraint encore_seats_row_label_check check (char_length(row_label) between 1 and 8),

  -- ON DELETE CASCADE: a seat is part of a screen's physical layout and is
  -- meaningless without it. This is safe despite the note on venues above,
  -- because encore_booking_seats.seat_id is ON DELETE RESTRICT -- so deleting a
  -- screen whose seats have ever been booked is still blocked by the cascade
  -- failing one level down. Only never-booked layouts can be cascaded away.
  constraint encore_seats_screen_id_fkey foreign key (screen_id)
    references encore_screens (id) on delete cascade on update cascade,

  -- The real layout constraint: one seat per (screen, row, number). Doubles as
  -- the "seats by screen_id" index, since screen_id leads the key.
  constraint encore_seats_screen_id_row_label_seat_number_key
    unique (screen_id, row_label, seat_number),

  -- FK target so encore_booking_seats can prove a seat is on the show's screen.
  constraint encore_seats_id_screen_id_key unique (id, screen_id)
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Supabase exposes every table through PostgREST using the anon key. Auth here
-- is Firebase, not Supabase Auth, so auth.uid() based policies do not apply and
-- the backend talks to Postgres with the service role key (which bypasses RLS).
-- Enabling RLS with zero policies therefore means: nothing reachable with the
-- anon key, everything reachable from our own API. Without this, anyone holding
-- the publicly-shipped anon key could read the whole catalog and booking set.
alter table encore_users enable row level security;
alter table encore_venues enable row level security;
alter table encore_screens enable row level security;
alter table encore_seats enable row level security;
