# Encore

Encore is a full-stack ticketing platform for movies and live events — browse showtimes, pick seats in real time, and check out securely, all from one booking flow that works the same whether you're buying a movie ticket or a concert pass.

## Tech Stack

- **Frontend** — Next.js (App Router), TypeScript, Tailwind CSS
- **Backend** — Node.js, Express, TypeScript
- **Transactional data** — Supabase (Postgres) — users, bookings, payments
- **Catalog content** — MongoDB — movies, events, venues
- **Auth** — Firebase Auth
- **Seat locking** — Redis
- **Payments** — Stripe
- **Tooling** — npm workspaces, concurrently

## Project Structure

```
encore/
├── frontend/   Next.js app (TypeScript, Tailwind, App Router)
├── backend/    Express API (TypeScript)
├── shared/     Shared TypeScript types used by both frontend and backend
├── .gitignore
├── README.md
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- Docker (for local Redis)

### Redis

Seat holds need Redis. From `backend/`, `docker compose up -d` starts it on
port 6380 — 6379 is deliberately avoided because it is commonly already taken.
`REDIS_URL` in `backend/.env` must point at the same port.

### Install

From the repo root (installs and links all workspaces):

```bash
npm install
```

### Configure environment variables

Copy the example env files and fill in real values as they become available:

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

> Supabase, MongoDB, Firebase, Redis, and Stripe are not wired up yet — the `.env.example` files list the variables we'll need, but no services are connected in this step.

### Run the dev servers

From the repo root, runs frontend and backend together:

```bash
npm run dev
```

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend: [http://localhost:4000](http://localhost:4000) (health check at `/api/health`)

To run a single workspace instead:

```bash
npm run dev -w frontend
npm run dev -w backend
```

### Build

```bash
npm run build
```

## Data model

The schema and the reasoning behind it are documented in
[backend/docs/schema.md](backend/docs/schema.md) — in particular how assigned
seating and general admission coexist without one polluting the other, and how
double-booking is made structurally impossible.

All Postgres objects — tables, enum types, constraints, indexes — are prefixed
`encore_`, because this Supabase project shares its `public` schema with another
application. The MongoDB side is unaffected.

- Postgres migrations: `backend/supabase/migrations/` — applied to the live
  project with `npm run db:push -w backend` (dry run: `db:diff`); verify with
  `npm run verify:live -w backend`
- MongoDB catalog model: `backend/src/models/Content.ts`
- Shared types mirroring both: `shared/src/types/`

## Production checklist

This project has run entirely against Stripe test mode, with the CLI's
`stripe listen` forwarding events to a local backend. Before pointing it at a
real Stripe account:

- **Register a real webhook endpoint** in the Stripe Dashboard (Developers →
  Webhooks) pointing at the deployed backend's `/api/webhooks/stripe`, and use
  *that* endpoint's signing secret for `STRIPE_WEBHOOK_SECRET`. The `whsec_...`
  value `stripe listen` prints locally is unique to that CLI session and does
  not work once you're no longer forwarding through it.
- **Revisit the pinned Stripe API version** (`apiVersion` in
  `backend/src/config/stripe.ts`, currently `2026-08-26.dahlia`) if the Stripe
  CLI or SDK gets upgraded later — it has to stay in sync with whatever version
  the installed `stripe` package actually expects.

## Status / TBD

- [x] Design the Supabase schema (users, venues, screens, seats, shows, bookings, payments)
- [x] Design the MongoDB `content` collection (movies, events)
- [x] Apply the migrations to a Supabase project and wire up the connection
- [ ] Connect MongoDB
- [ ] Wire up Firebase Auth on frontend and backend
- [ ] Implement Redis-backed seat locking
- [ ] Integrate Stripe checkout and webhooks
