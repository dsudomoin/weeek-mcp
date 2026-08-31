import { createServer } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, endpoint } from "../config.ts";
import { WeeekClient } from "../http/client.ts";
import { checkToken } from "./init.ts";

// The wizard around this needs a terminal, so it cannot be driven end to end from a test suite.
// The request it makes can be, and that is the half worth pinning: where it goes, and what it does
// with each answer.

type Seen = { authorization: string; url: string };

/** A stand-in Weeek that records what reached it and answers with whatever the test asked for. */
async function fakeWeeek(reply: {
  status: number;
  body: unknown;
}): Promise<{ base: string; seen: Seen[]; close: () => void }> {
  const seen: Seen[] = [];
  const http = createServer((request, response) => {
    seen.push({ authorization: request.headers.authorization ?? "", url: request.url ?? "" });
    response.writeHead(reply.status, { "content-type": "application/json" });
    response.end(JSON.stringify(reply.body));
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, seen, close: () => http.close() };
}

test("the token is checked against WEEEK_BASE_URL, not against a hardcoded address", async () => {
  // The defect this replaced: the wizard wrote api.weeek.net into itself while the server read the
  // variable, so on a self-hosted or proxied Weeek the wizard checked the wrong host and refused a
  // token that was perfectly good. An inconsistency inside one package, and silent.
  const weeek = await fakeWeeek({
    status: 200,
    body: { success: true, user: { firstName: "Ada", lastName: "Lovelace" } },
  });

  try {
    const who = await checkToken("a-token", { WEEEK_BASE_URL: weeek.base });

    assert.equal(who, "Ada Lovelace");
    assert.equal(weeek.seen.length, 1, "the wizard makes exactly one request");
    assert.equal(weeek.seen[0]?.authorization, "Bearer a-token");
  } finally {
    weeek.close();
  }
});

test("a token Weeek rejects is reported as rejected, and said to have been stored nowhere", async () => {
  const weeek = await fakeWeeek({ status: 401, body: { success: false, message: "Unauthorized" } });

  try {
    await assert.rejects(
      () => checkToken("a-token", { WEEEK_BASE_URL: weeek.base }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError, "a rejected token is a refusal, not a defect");
        assert.match(error.message, /rejected that token/);
        assert.match(error.message, /nothing was stored/);
        return true;
      },
    );
  } finally {
    weeek.close();
  }
});

test("a Weeek that cannot be reached is told apart from a Weeek that said no", async () => {
  // Different things to do about them: one is a wrong token, the other is a wrong address or no
  // network. Collapsing the two would send somebody to regenerate a token that was never the fault.
  // A real closed port, which is the real shape of the failure. The backoff is skipped rather than
  // waited out: four attempts at 500 ms doubling is right for a person at a prompt and four wasted
  // seconds in a suite.
  const weeek = await fakeWeeek({ status: 200, body: {} });
  const closed = weeek.base;
  weeek.close();

  const env = { WEEEK_BASE_URL: closed };
  const client = new WeeekClient({ token: "a-token", ...endpoint(env) }, { sleep: async () => {} });

  await assert.rejects(
    () => checkToken("a-token", env, client),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /Could not reach Weeek/);
      return true;
    },
  );
});

test("a profile with no name is accepted rather than treated as a failure", async () => {
  // Weeek does not promise a name. "Accepted." is a fine thing to print; refusing a working token
  // over a missing display name would not be.
  const weeek = await fakeWeeek({ status: 200, body: { success: true, user: {} } });

  try {
    assert.equal(await checkToken("a-token", { WEEEK_BASE_URL: weeek.base }), null);
  } finally {
    weeek.close();
  }
});
