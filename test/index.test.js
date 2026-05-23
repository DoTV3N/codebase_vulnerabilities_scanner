import nock from "nock";
import { Probot, ProbotOctokit } from "probot";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert";

// Set the API key BEFORE dynamically loading index.js so @google/genai
// initialises with it (static imports are hoisted, dynamic ones are not).
process.env.GOOGLE_API_KEY = "test-key";
const { default: myProbotApp } = await import("../index.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const privateKey = fs.readFileSync(
  path.join(__dirname, "fixtures/mock-cert.pem"),
  "utf-8"
);

const prPayload = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/pull_request.opened.json"), "utf-8")
);

const pushPayload = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/push.main.json"), "utf-8")
);

// Minimal valid Gemini API response shape
const mockGeminiResponse = JSON.stringify({
  candidates: [{
    content: { parts: [{ text: "## Summary\nMock AI review." }] },
    finishReason: "STOP",
  }],
});

describe("My Probot app", () => {
  let probot;
  let originalFetch;

  beforeEach(() => {
    nock.disableNetConnect();

    // @google/genai uses globalThis.fetch (undici), which nock doesn't intercept.
    // We swap it out so tests stay offline and deterministic.
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
        return new Response(mockGeminiResponse, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(url, opts);
    };

    probot = new Probot({
      appId: 123,
      privateKey,
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });
    probot.load(myProbotApp);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    nock.cleanAll();
    nock.enableNetConnect();
  });

  test("posts a review comment when a pull request is opened", async () => {
    nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, { token: "test", permissions: { issues: "write", contents: "write" } });

    nock("https://github.com")
      .get("/hiimbex/testing-things/pull/1.diff")
      .reply(200, "diff --git a/index.js b/index.js\n+console.log('hello');");

    nock("https://api.github.com")
      .post("/repos/hiimbex/testing-things/issues/1/comments")
      .reply(200);

    await probot.receive({ name: "pull_request", payload: prPayload });

    assert.strictEqual(nock.pendingMocks().length, 0, "All HTTP mocks should be consumed");
  });

  test("posts a commit comment when code is pushed to main", async () => {
    nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, { token: "test", permissions: { issues: "write", contents: "write" } });

    nock("https://api.github.com")
      .get(/\/repos\/hiimbex\/testing-things\/compare\//)
      .reply(200, "diff --git a/index.js b/index.js\n+console.log('hello');");

    nock("https://api.github.com")
      .post(`/repos/hiimbex/testing-things/commits/${pushPayload.after}/comments`)
      .reply(200);

    await probot.receive({ name: "push", payload: pushPayload });

    assert.strictEqual(nock.pendingMocks().length, 0, "All HTTP mocks should be consumed");
  });

  test("ignores pushes to branches other than main", async () => {
    const nonMainPayload = { ...pushPayload, ref: "refs/heads/feature-branch" };

    // No mocks set up — nock will throw if any network call is made
    await probot.receive({ name: "push", payload: nonMainPayload });
  });
});
