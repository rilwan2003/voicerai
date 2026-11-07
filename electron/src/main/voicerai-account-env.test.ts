import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The account gate's deployment choice.
 *
 * A released build must always talk to production: the sign-in hand-off only
 * works against the site and API that actually serve VoicerAI. A test build
 * needs the opposite, so it can be exercised against the test environment
 * before there is a release to replace.
 */
const electron = vi.hoisted(() => ({
  app: { getPath: () => "/tmp/voicerai-test", isPackaged: true },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn() },
}));

vi.mock("electron", () => ({
  app: electron.app,
  safeStorage: electron.safeStorage,
  shell: electron.shell,
}));

const ENV_KEYS = ["VOICERAI_ACCOUNT_ENV", "VOICERAI_ACCOUNT_ENV_ALLOW"];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  electron.app.isPackaged = true;
});

async function loadFresh() {
  // The origins are module state, resolved by resolveAccountEnvironment, so
  // each case imports a fresh copy rather than reading a cached value.
  vi.resetModules();
  return await import("./voicerai-account");
}

async function signInUrlWith(packaged: boolean, env: Record<string, string>) {
  electron.app.isPackaged = packaged;
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  const account = await loadFresh();
  account.resolveAccountEnvironment();
  return account.signInUrl();
}

describe("account environment", () => {
  it("pins a packaged build to production even when staging is requested", async () => {
    const url = await signInUrlWith(true, {
      VOICERAI_ACCOUNT_ENV: "staging",
      VOICERAI_ACCOUNT_ENV_ALLOW: "1",
    });
    expect(url).toContain("https://thinkflyflow.laureljar.com/desktop-auth");
  });

  it("ignores a lone VOICERAI_ACCOUNT_ENV (Electron forwards VOICERAI_* vars)", async () => {
    const url = await signInUrlWith(false, { VOICERAI_ACCOUNT_ENV: "staging" });
    expect(url).toContain("https://thinkflyflow.laureljar.com/desktop-auth");
  });

  it("uses the test site and test API for an unpackaged run that opts in", async () => {
    electron.app.isPackaged = false;
    process.env.VOICERAI_ACCOUNT_ENV = "staging";
    process.env.VOICERAI_ACCOUNT_ENV_ALLOW = "1";
    const account = await loadFresh();
    account.resolveAccountEnvironment();
    expect(account.signInUrl()).toContain(
      "https://thinkflyflow-test.laureljar.com/desktop-auth",
    );
    // The upload path is what the 5 MB voice cap is enforced on in the test
    // backend, so the API origin has to move with the website.
    expect(account.__apiBaseForTests()).toBe(
      "https://apitest.laureljar.com/api/v2",
    );
  });

  it("defaults to production", async () => {
    const url = await signInUrlWith(false, {});
    expect(url).toContain("https://thinkflyflow.laureljar.com/desktop-auth");
  });
});
