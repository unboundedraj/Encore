/**
 * Runs Supabase CLI migration commands using credentials from backend/.env.
 *
 * Exists so the connection string is never typed on a command line, pasted
 * into a chat, or committed: it is read from .env, passed to the CLI as an
 * argument in a spawned process, and redacted from anything this script logs.
 *
 *   npm run db:diff -w backend   -- dry run, prints what WOULD be applied
 *   npm run db:push -w backend   -- actually applies pending migrations
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, "..");

const env = {};
try {
  const raw = readFileSync(path.join(backendDir, ".env"), "utf8");
  // trimEnd handles CRLF files; a trailing \r would otherwise end up in values.
  for (const line of raw.split("\n").map((l) => l.trimEnd())) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  console.error("Could not read backend/.env. Copy backend/.env.example and fill it in.");
  process.exit(2);
}

const dbUrl = env.SUPABASE_DB_URL ?? env.DATABASE_URL;
if (!dbUrl) {
  console.error(
    "SUPABASE_DB_URL is not set in backend/.env.\n\n" +
      "It is NOT the same as SUPABASE_URL. SUPABASE_URL points at PostgREST,\n" +
      "which cannot run DDL. Migrations need a direct Postgres connection.\n\n" +
      "Supabase dashboard -> Project Settings -> Database -> Connection string\n" +
      "  -> URI, then add to backend/.env as:\n" +
      "     SUPABASE_DB_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres\n\n" +
      "If the password contains special characters it must be percent-encoded."
  );
  process.exit(2);
}

const mode = process.argv[2];
if (!["diff", "push"].includes(mode)) {
  console.error("Usage: node scripts/db.mjs <diff|push>");
  process.exit(2);
}

// Run the CLI's JS entry point with node directly, with no shell. Going through
// `npx` on Windows means cmd.exe, which expands %XX sequences -- and a
// percent-encoded password is made of exactly those.
const require = createRequire(import.meta.url);
const cliEntry = path.join(
  path.dirname(require.resolve("supabase/package.json")),
  require("supabase/package.json").bin.supabase
);

// --skip-vault: this project is shared, and vault.secrets is project-wide.
// Encore keeps no secrets there, so the push has no reason to touch it.
const args = [cliEntry, "db", "push", "--db-url", dbUrl, "--skip-vault"];
if (mode === "diff") args.push("--dry-run");

console.log(
  mode === "diff"
    ? "Dry run -- showing what WOULD be applied, changing nothing.\n"
    : "Applying pending migrations to the linked Supabase project.\n"
);

const res = spawnSync(process.execPath, args, {
  cwd: backendDir,
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
  encoding: "utf8",
});

// The connection string embeds the password, and the CLI echoes it back in
// some messages. Scrub it from anything we print.
const redact = (s) =>
  (s ?? "")
    .split(dbUrl).join("<SUPABASE_DB_URL>")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "<redacted-connection-string>");

if (res.stdout) process.stdout.write(redact(res.stdout));
if (res.stderr) process.stderr.write(redact(res.stderr));
process.exit(res.status ?? 1);
