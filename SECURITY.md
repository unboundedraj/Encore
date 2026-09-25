# Security

## Reporting

Encore is pre-release and not deployed publicly. Raise anything security-relevant
directly with the maintainer rather than opening a public issue.

## Credential handling

- Real credentials live only in `backend/.env` and `frontend/.env.local`, both
  git-ignored. `.env.example` files carry placeholders and are the only env
  files tracked.
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `MONGODB_URI` and
  `FIREBASE_PRIVATE_KEY` are backend-only. None may be given a `NEXT_PUBLIC_`
  name — that prefix inlines a value into the client bundle at build time.
- The Firebase **client** config (`NEXT_PUBLIC_FIREBASE_*`) is deliberately
  public. Firebase enforces access through security rules, not by hiding those
  values. The **service account** key is the opposite: it signs on behalf of
  the whole project and must never reach the browser.
- Supabase tables have RLS enabled with zero policies, so the public anon key
  opens nothing. The backend connects with the service role key, which bypasses
  RLS — which means authorization is the API's job, not the database's. See
  `backend/src/config/supabase.ts`.

## Accepted advisories

Findings we have assessed and chosen not to act on yet. Each should be
re-checked when the parent dependency is next upgraded.

### `uuid` < 11.1.1 — missing buffer bounds check (moderate)

- **Advisory:** [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
- **Path:** `firebase-admin` → `google-auth-library` → `gaxios` → `uuid`
- **Status:** accepted, not remediated.

The flaw is in `uuid` v3/v5/v6 when the caller passes its own `buf` argument.
`gaxios` uses v4 to generate request identifiers and passes no buffer, so the
affected code path is never reached from here.

`npm audit fix` would bump transitive packages beneath `firebase-admin`, whose
compatibility contract we do not control. Trading a theoretical issue on an
unreachable path for a realistic chance of a subtler runtime breakage in the
auth stack is a bad exchange.

**Revisit on the next routine `firebase-admin` upgrade**, which will most likely
resolve it upstream without any direct intervention.
