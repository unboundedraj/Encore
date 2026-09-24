/**
 * Unit tests for requireAuth, with the Firebase verifier injected.
 *
 * Uses node:test rather than adding a test framework -- these are pure function
 * tests with no fixtures to manage, and the runner ships with Node.
 *
 * The verifier is injected through createRequireAuth instead of patching the
 * firebase-admin module. No real token is ever verified, no service account is
 * loaded (config/firebase initialises lazily, on first verification), and
 * nothing here touches the network.
 *
 * config/supabase does still build its client at import time, and the module
 * graph reaches it via the provisioning service. Placeholder env vars below
 * satisfy that constructor so these tests run without a .env -- creating a
 * Supabase client opens no connection, so a fake URL is harmless. They are set
 * before the middleware is loaded, which is why that one import is a require:
 * ES import bindings are hoisted and would otherwise run first.
 *
 * Run with: npm run test:unit -w backend
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";

process.env.SUPABASE_URL ||= "https://placeholder.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "placeholder-service-role-key";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRequireAuth } = require("../middleware/auth") as typeof import("../middleware/auth");

/** Minimal Response double capturing what the middleware sets. */
function mockResponse() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  };
  return { res: res as unknown as Response, captured };
}

function mockRequest(authorization?: string): Request {
  return {
    headers: authorization === undefined ? {} : { authorization },
  } as Request;
}

const VALID_TOKEN = "valid.jwt.token";

const decoded = {
  uid: "firebase-uid-123",
  email: "alice@example.com",
  email_verified: true,
  name: "Alice Example",
} as unknown as DecodedIdToken;

/** Mirrors the shape firebase-admin throws: an Error carrying a `code`. */
function firebaseError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const alwaysValid = async (token: string) => {
  if (token !== VALID_TOKEN) throw firebaseError("auth/argument-error", "Decoding failed");
  return decoded;
};

test("valid token populates req.user and calls next()", async () => {
  const requireAuth = createRequireAuth(alwaysValid);
  const req = mockRequest(`Bearer ${VALID_TOKEN}`);
  const { res, captured } = mockResponse();
  let nextCalled = false;

  await requireAuth(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);

  assert.equal(nextCalled, true, "next() should be called");
  assert.equal(captured.status, undefined, "no status should be set on success");
  assert.deepEqual(req.user, {
    uid: "firebase-uid-123",
    email: "alice@example.com",
    name: "Alice Example",
    emailVerified: true,
  });
});

test("token without optional claims still authenticates, with nulls", async () => {
  const minimal = { uid: "uid-no-claims" } as unknown as DecodedIdToken;
  const requireAuth = createRequireAuth(async () => minimal);
  const req = mockRequest("Bearer anything");
  const { res } = mockResponse();
  let nextCalled = false;

  await requireAuth(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);

  assert.equal(nextCalled, true);
  assert.deepEqual(req.user, {
    uid: "uid-no-claims",
    email: null,
    name: null,
    emailVerified: false,
  });
});

test("missing Authorization header rejects with 401", async () => {
  const requireAuth = createRequireAuth(alwaysValid);
  const req = mockRequest();
  const { res, captured } = mockResponse();
  let nextCalled = false;

  await requireAuth(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);

  assert.equal(nextCalled, false, "next() must not run");
  assert.equal(captured.status, 401);
  assert.equal(req.user, undefined);
});

test("malformed Authorization header rejects with 401", async () => {
  const requireAuth = createRequireAuth(alwaysValid);

  for (const header of [
    VALID_TOKEN, // no scheme
    `Basic ${VALID_TOKEN}`, // wrong scheme
    "Bearer", // scheme with no token
    `bearer ${VALID_TOKEN}`, // wrong case: schemes are compared exactly
    `Bearer${VALID_TOKEN}`, // no separating space
  ]) {
    const req = mockRequest(header);
    const { res, captured } = mockResponse();
    let nextCalled = false;

    await requireAuth(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);

    assert.equal(nextCalled, false, `next() must not run for ${JSON.stringify(header)}`);
    assert.equal(captured.status, 401, `expected 401 for ${JSON.stringify(header)}`);
  }
});

test("expired token rejects with 401", async () => {
  const expired = async () => {
    throw firebaseError("auth/id-token-expired", "Firebase ID token has expired");
  };
  const requireAuth = createRequireAuth(expired);
  const req = mockRequest(`Bearer ${VALID_TOKEN}`);
  const { res, captured } = mockResponse();
  let nextCalled = false;

  await requireAuth(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);

  assert.equal(nextCalled, false);
  assert.equal(captured.status, 401);
  assert.equal(req.user, undefined);
});

test("malformed token rejects with 401", async () => {
  const requireAuth = createRequireAuth(alwaysValid);
  const req = mockRequest("Bearer not-a-real-jwt");
  const { res, captured } = mockResponse();
  let nextCalled = false;

  await requireAuth(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);

  assert.equal(nextCalled, false);
  assert.equal(captured.status, 401);
});

test("invalid signature rejects with 401", async () => {
  const badSignature = async () => {
    throw firebaseError("auth/argument-error", "Firebase ID token has invalid signature");
  };
  const requireAuth = createRequireAuth(badSignature);
  const req = mockRequest(`Bearer ${VALID_TOKEN}`);
  const { res, captured } = mockResponse();

  await requireAuth(req, res, (() => undefined) as NextFunction);

  assert.equal(captured.status, 401);
});

test("rejection reason is never echoed to the client", async () => {
  const secretLeak = async () => {
    throw firebaseError(
      "auth/id-token-expired",
      "Firebase ID token has expired at 2026-09-24T10:00:00Z; project encore-839e1"
    );
  };
  const requireAuth = createRequireAuth(secretLeak);
  const req = mockRequest(`Bearer ${VALID_TOKEN}`);
  const { res, captured } = mockResponse();

  await requireAuth(req, res, (() => undefined) as NextFunction);

  const body = JSON.stringify(captured.body);
  assert.equal(captured.status, 401);
  assert.ok(!body.includes("expired at"), "must not leak the failure detail");
  assert.ok(!body.includes("encore-839e1"), "must not leak the project id");
  assert.deepEqual(captured.body, { error: "Invalid or expired token" });
});

test("requireAuth performs no database work", async () => {
  // The whole point of splitting provisioning out: verification must not depend
  // on Postgres. If a DB call ever creeps in here, this catches it -- the
  // injected verifier is the only async dependency allowed.
  let verifierCalls = 0;
  const requireAuth = createRequireAuth(async () => {
    verifierCalls++;
    return decoded;
  });
  const req = mockRequest(`Bearer ${VALID_TOKEN}`);
  const { res } = mockResponse();

  await requireAuth(req, res, (() => undefined) as NextFunction);

  assert.equal(verifierCalls, 1);
  assert.equal(req.userRecord, undefined, "requireAuth must not provision");
});
