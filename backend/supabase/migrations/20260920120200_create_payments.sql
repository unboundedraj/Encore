-- Payment records. This table is an audit trail first and application state
-- second: rows are appended and transitioned, never deleted.
-- All objects are `encore_` prefixed; see the core tables migration for why.

create type encore_payment_gateway as enum ('stripe', 'razorpay');
create type encore_payment_status as enum ('pending', 'succeeded', 'failed');

create table encore_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  gateway encore_payment_gateway not null,
  gateway_payment_id text not null,
  status encore_payment_status not null default 'pending',
  amount integer not null,
  -- Verbatim webhook body, for reconciliation and for arguing with a gateway
  -- about what they actually sent. Nullable: the row is created when we open a
  -- PaymentIntent, before any webhook has arrived.
  raw_webhook_payload jsonb,
  created_at timestamptz not null default now(),

  constraint encore_payments_amount_check check (amount >= 0),

  -- ON DELETE RESTRICT: never cascade a financial record. This is also the
  -- backstop that makes encore_bookings effectively undeletable once money is
  -- involved -- deleting such a booking is refused here even though
  -- encore_booking_seats would have happily cascaded.
  constraint encore_payments_booking_id_fkey foreign key (booking_id)
    references encore_bookings (id) on delete restrict on update cascade,

  -- One payment per booking, as specified. Split attempts/retries belong in an
  -- encore_payment_attempts table if we ever need them, rather than loosening
  -- this.
  constraint encore_payments_booking_id_key unique (booking_id),

  -- Webhook idempotency. Stripe and Razorpay both retry deliveries, and both
  -- expect the receiver to deduplicate. This makes a replayed webhook a unique
  -- violation the handler can swallow, instead of a second processed payment.
  constraint encore_payments_gateway_gateway_payment_id_key
    unique (gateway, gateway_payment_id)
);

-- encore_payments_booking_id_key already provides the booking_id index.

-- Reconciliation sweeps: payments stuck pending past their window.
create index encore_payments_status_created_at_idx
  on encore_payments (status, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security (see note in the core tables migration)
-- ---------------------------------------------------------------------------
alter table encore_payments enable row level security;
