import { test } from "node:test";
import assert from "node:assert/strict";
import { WeeekClient } from "./client.ts";
import { WeeekApiError, describeApiError } from "./quirks.ts";
import type { WeeekOperation } from "../openapi-types.ts";

const config = { token: "secret", baseUrl: "https://api.test/v1", timeoutMs: 1000 };

const getTasks: WeeekOperation = {
  name: "get_tasks",
  method: "GET",
  path: "/tm/tasks",
  summary: "",
  tags: [],
  parameters: [],
};

const getTask: WeeekOperation = {
  name: "get_task",
  method: "GET",
  path: "/tm/tasks/{id}",
  summary: "",
  tags: [],
  parameters: [],
};

const createTask: WeeekOperation = {
  name: "create_task",
  method: "POST",
  path: "/tm/tasks",
  summary: "",
  tags: [],
  parameters: [],
};

const uploadAttachment: WeeekOperation = {
  name: "upload_attachment",
  method: "POST",
  path: "/tm/tasks/{task_id}/attachments",
  summary: "",
  tags: [],
  parameters: [],
};

/**
 * Stands in for a Weeek that never answers. A signal the client reuses across attempts arrives
 * already aborted, with its "abort" event long since fired: subscribing to that would hang the run
 * rather than fail it, and node:test has no default per-test timeout. Rejecting with a distinct
 * error instead turns the reuse into a failed assertion, since it is not the timeout we expect.
 */
function hangUntilAborted(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal === undefined || signal === null) return;
    if (signal.aborted) {
      reject(new Error("the client reused an AbortSignal that had already fired"));
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason));
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("fills in path parameters and sends the token", async () => {
  let seenUrl = "";
  let seenAuth: string | null = null;
  let seenAccept: string | null = null;
  const client = new WeeekClient(config, {
    fetch: async (input, init) => {
      seenUrl = String(input);
      const headers = new Headers(init?.headers);
      seenAuth = headers.get("authorization");
      seenAccept = headers.get("accept");
      return jsonResponse({ success: true });
    },
  });

  await client.request(getTask, { pathParams: { id: 7197 } });

  assert.equal(seenUrl, "https://api.test/v1/tm/tasks/7197");
  assert.equal(seenAuth, "Bearer secret");
  assert.equal(seenAccept, "application/json");
});

test("assembles the query through buildQuery", async () => {
  let seenUrl = "";
  const client = new WeeekClient(config, {
    fetch: async (input) => {
      seenUrl = String(input);
      return jsonResponse({ success: true });
    },
  });

  await client.request(getTasks, { query: { all: true, tags: [51] } });

  assert.ok(seenUrl.includes("all=1"), seenUrl);
  assert.ok(seenUrl.includes("tags%5B%5D=51"), seenUrl);
});

test("a missing path parameter is caught before the request goes out", async () => {
  const client = new WeeekClient(config, {
    fetch: async () => {
      throw new Error("the request should never have been sent");
    },
  });

  await assert.rejects(() => client.request(getTask, {}), /id/);
});

test("204 returns null instead of failing to parse", async () => {
  // DELETE /tm/tasks/{taskId}/comments/{commentId} answers 204 with an empty body.
  const client = new WeeekClient(config, {
    fetch: async () => new Response(null, { status: 204 }),
  });

  assert.equal(await client.request(getTasks), null);
});

test("an HTML error body does not break the client, and 405 is not retried", async () => {
  // PATCH /tm/tasks/{id} answers 405 with an HTML page, not JSON. The call count is what keeps
  // RETRY_STATUSES honest: a status quietly added to that set would cost four round trips here.
  let calls = 0;
  const client = new WeeekClient(config, {
    fetch: async () => {
      calls += 1;
      return new Response("<html>Method Not Allowed</html>", {
        status: 405,
        headers: { "content-type": "text/html" },
      });
    },
    sleep: async () => {},
  });

  await assert.rejects(() => client.request(getTasks), WeeekApiError);
  assert.equal(calls, 1);
});

test("retries a 429 and returns the successful response", async () => {
  let calls = 0;
  const client = new WeeekClient(config, {
    fetch: async () => {
      calls += 1;
      return calls < 3 ? jsonResponse({}, 429) : jsonResponse({ success: true, tasks: [] });
    },
    sleep: async () => {},
  });

  await client.request(getTasks);
  assert.equal(calls, 3);
});

test("422 is not retried, because a malformed request is not a transient fault", async () => {
  let calls = 0;
  const client = new WeeekClient(config, {
    fetch: async () => {
      calls += 1;
      return jsonResponse({ success: false, errors: { all: ["bad"] } }, 422);
    },
    sleep: async () => {},
  });

  await assert.rejects(() => client.request(getTasks), WeeekApiError);
  assert.equal(calls, 1);
});

test("a JSON body is serialized and declared as JSON", async () => {
  let seenMethod: string | undefined;
  let seenBody: unknown;
  let seenContentType: string | null = null;
  const client = new WeeekClient(config, {
    fetch: async (_input, init) => {
      seenMethod = init?.method;
      seenBody = init?.body;
      seenContentType = new Headers(init?.headers).get("content-type");
      return jsonResponse({ success: true, task: {} });
    },
  });

  await client.request(createTask, { body: { title: "Buy milk", boardColumnId: 1 } });

  assert.equal(seenMethod, "POST");
  assert.equal(seenBody, '{"title":"Buy milk","boardColumnId":1}');
  assert.equal(seenContentType, "application/json");
});

test("a multipart upload reaches fetch untouched", async () => {
  // Only fetch may set the multipart content type: it carries the boundary of the body it encodes.
  const form = new FormData();
  form.set("file", new Blob(["note"]), "note.txt");

  let seenBody: unknown;
  let seenContentType: string | null = null;
  const client = new WeeekClient(config, {
    fetch: async (_input, init) => {
      seenBody = init?.body;
      seenContentType = new Headers(init?.headers).get("content-type");
      return jsonResponse({ success: true });
    },
  });

  await client.request(uploadAttachment, { pathParams: { task_id: 7197 }, formData: form });

  assert.equal(seenBody, form);
  assert.equal(seenContentType, null);
});

test("a 200 body that says success:false names the call that failed", async () => {
  // unwrapEnvelope sees the payload alone, so it can only report "Weeek rejected the request".
  // The transport knows the method and the resolved url, so the failure is raised here instead.
  const client = new WeeekClient(config, {
    fetch: async () => jsonResponse({ success: false, code: 2000000, message: "Unauthenticated." }),
  });

  await assert.rejects(
    () => client.request(getTask, { pathParams: { id: 7197 } }),
    (error: unknown) => {
      assert.ok(error instanceof WeeekApiError);
      assert.equal(error.status, 200);
      assert.equal(
        describeApiError(error),
        "Weeek rejected the request (GET https://api.test/v1/tm/tasks/7197)\n" +
          "  Unauthenticated. (code 2000000)",
      );
      return true;
    },
  );
});

test("a transport failure names the cause once and keeps the original error", async () => {
  // describeApiError reads details as a Weeek body, and an Error carries a .message too: passing
  // the Error as details would print the cause a second time as a detail line.
  const cause = new TypeError("fetch failed");
  const client = new WeeekClient(config, {
    fetch: async () => {
      throw cause;
    },
    sleep: async () => {},
  });

  await assert.rejects(
    () => client.request(getTasks),
    (error: unknown) => {
      assert.ok(error instanceof WeeekApiError);
      assert.equal(error.status, 0);
      assert.equal(
        describeApiError(error),
        "Could not reach Weeek: fetch failed (GET https://api.test/v1/tm/tasks)",
      );
      assert.equal(error.cause, cause);
      return true;
    },
  );
});

test("retries are finite and the last status is what the caller sees", async () => {
  const delays: number[] = [];
  let calls = 0;
  const client = new WeeekClient(config, {
    fetch: async () => {
      calls += 1;
      return jsonResponse({ success: false, message: "Server Error" }, 503);
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  await assert.rejects(
    () => client.request(getTasks),
    (error: unknown) => {
      assert.ok(error instanceof WeeekApiError);
      assert.equal(error.status, 503);
      return true;
    },
  );

  assert.equal(calls, 4);
  assert.deepEqual(delays, [500, 1000, 2000]);
});

test("every attempt is bounded by the configured timeout", { timeout: 1000 }, async () => {
  // The abort has to come from a signal the client passes: a hung Weeek would otherwise hold
  // the MCP server's stdio loop for as long as the socket stays open.
  const client = new WeeekClient(
    { ...config, timeoutMs: 20 },
    {
      fetch: (_input, init) => hangUntilAborted(init),
      sleep: async () => {},
    },
  );

  await assert.rejects(
    () => client.request(getTasks),
    (error: unknown) => {
      assert.ok(error instanceof WeeekApiError);
      assert.equal(error.status, 0);
      assert.match(describeApiError(error), /timed out after 20 ?ms/);
      return true;
    },
  );
});

test("a JSON body next to a multipart form is refused, not dropped", async () => {
  const client = new WeeekClient(config, {
    fetch: async () => {
      throw new Error("the request should never have been sent");
    },
  });

  await assert.rejects(
    () =>
      client.request(uploadAttachment, {
        pathParams: { task_id: 7197 },
        formData: new FormData(),
        body: { title: "dropped on the floor" },
      }),
    /formData/,
  );
});

function bodyDiesMidRead(): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError("terminated"));
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("a body that dies mid-read keeps the status the response arrived with", async () => {
  // The response reached us with headers and a status; only the body was lost. Reporting that as
  // "could not reach Weeek" would describe a failure that did not happen — and for a write that
  // Weeek already applied, it would be the opposite of the truth.
  let calls = 0;
  const client = new WeeekClient(config, {
    fetch: async () => {
      calls += 1;
      return bodyDiesMidRead();
    },
    sleep: async () => {},
  });

  await assert.rejects(
    () => client.request(getTasks),
    (error: unknown) => {
      assert.ok(error instanceof WeeekApiError);
      assert.equal(error.status, 200);
      const text = describeApiError(error);
      assert.match(text, /Weeek responded 200, but the body could not be read/);
      assert.match(text, /terminated/);
      assert.doesNotMatch(text, /Could not reach Weeek/);
      return true;
    },
  );

  assert.equal(calls, 4);
});

test("a POST whose body dies mid-read is told Weeek may already have applied it", async () => {
  let calls = 0;
  const client = new WeeekClient(config, {
    fetch: async () => {
      calls += 1;
      return bodyDiesMidRead();
    },
    sleep: async () => {},
  });

  await assert.rejects(
    () => client.request(createTask, { body: { title: "Buy milk" } }),
    (error: unknown) => {
      assert.ok(error instanceof WeeekApiError);
      assert.equal(error.status, 200);
      assert.match(describeApiError(error), /Weeek may have applied it before failing/);
      return true;
    },
  );

  assert.equal(calls, 1);
});

test("the reason behind a bare fetch failure survives into the message", async () => {
  // Node's fetch reports every network failure as "fetch failed" and puts what actually happened
  // in cause; without it a wrong WEEEK_BASE_URL is indistinguishable from Weeek being down.
  const cause = new TypeError("fetch failed");
  cause.cause = new Error("getaddrinfo ENOTFOUND api.weeek.invalid");
  const client = new WeeekClient(config, {
    fetch: async () => {
      throw cause;
    },
    sleep: async () => {},
  });

  await assert.rejects(
    () => client.request(getTasks),
    (error: unknown) => {
      assert.ok(error instanceof WeeekApiError);
      assert.equal(
        describeApiError(error),
        "Could not reach Weeek: fetch failed: getaddrinfo ENOTFOUND api.weeek.invalid " +
          "(GET https://api.test/v1/tm/tasks)",
      );
      return true;
    },
  );
});

test("only the methods that are safe to replay are retried after a 503", async () => {
  // Both directions matter, and the dangerous one is adding: a method quietly moved into the safe
  // set starts replaying writes, which is how one create becomes four.
  const classification = [
    ["GET", true],
    ["POST", false],
    ["PUT", true],
    ["DELETE", true],
    ["PATCH", false],
  ] as const;

  for (const [method, replayed] of classification) {
    let calls = 0;
    const client = new WeeekClient(config, {
      fetch: async () => {
        calls += 1;
        return jsonResponse({ success: false, message: "Server Error" }, 503);
      },
      sleep: async () => {},
    });
    const operation: WeeekOperation = {
      name: `probe_${method}`,
      method,
      path: "/tm/tasks",
      summary: "",
      tags: [],
      parameters: [],
    };

    await assert.rejects(() => client.request(operation), WeeekApiError);
    assert.equal(calls, replayed ? 4 : 1, `${method} after 503`);
  }
});

test("a write left unretried after a 503 is told the state is unknown", async () => {
  // Replaying a create is how one timed-out task becomes two. The model is the next retry loop,
  // so the error has to tell it that the request may already have landed.
  const client = new WeeekClient(config, {
    fetch: async () => jsonResponse({ success: false, message: "Server Error" }, 503),
    sleep: async () => {},
  });

  await assert.rejects(
    () => client.request(createTask, { body: { title: "Buy milk" } }),
    (error: unknown) => {
      assert.ok(error instanceof WeeekApiError);
      assert.equal(error.status, 503);
      const text = describeApiError(error);
      assert.match(text, /not retried/);
      assert.match(text, /may have applied it/);
      assert.match(text, /Check the current state before sending it again/);
      return true;
    },
  );
});

test("a POST is retried after a 429, because a rejected request was never applied", async () => {
  let calls = 0;
  const client = new WeeekClient(config, {
    fetch: async () => {
      calls += 1;
      return calls < 3 ? jsonResponse({}, 429) : jsonResponse({ success: true, task: {} });
    },
    sleep: async () => {},
  });

  await client.request(createTask, { body: { title: "Buy milk" } });
  assert.equal(calls, 3);
});

test("a POST is not retried after a transport failure, and says so", async () => {
  let calls = 0;
  const client = new WeeekClient(config, {
    fetch: async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    },
    sleep: async () => {},
  });

  await assert.rejects(
    () => client.request(createTask, { body: { title: "Buy milk" } }),
    (error: unknown) => {
      assert.ok(error instanceof WeeekApiError);
      assert.equal(error.status, 0);
      const text = describeApiError(error);
      assert.match(text, /fetch failed/);
      assert.match(text, /not retried/);
      assert.match(text, /Check the current state before sending it again/);
      return true;
    },
  );

  assert.equal(calls, 1);
});

test(
  "a timed-out POST says the timeout was ours and Weeek may have processed it",
  { timeout: 1000 },
  async () => {
    // Aborting is a local decision: the request may be running on Weeek's side at that very moment.
    let calls = 0;
    const client = new WeeekClient(
      { ...config, timeoutMs: 20 },
      {
        fetch: (_input, init) => {
          calls += 1;
          return hangUntilAborted(init);
        },
        sleep: async () => {},
      },
    );

    await assert.rejects(
      () => client.request(createTask, { body: { title: "Buy milk" } }),
      (error: unknown) => {
        assert.ok(error instanceof WeeekApiError);
        const text = describeApiError(error);
        assert.match(text, /timed out after 20 ms/);
        assert.match(text, /timeout was ours/);
        assert.match(text, /may have processed it/);
        return true;
      },
    );

    assert.equal(calls, 1);
  },
);
