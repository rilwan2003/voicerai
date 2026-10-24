import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sign-in gate's waiting rules.
 *
 * Regression: a second click on "Sign in" used to throw "A sign-in window is
 * already open in your browser", which left the user with a dead button and no
 * way back into the app short of restarting it.
 */
const electron = vi.hoisted(() => ({
  app: {
    on: vi.fn(),
    setAsDefaultProtocolClient: vi.fn(),
  },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn<(url: string) => Promise<void>>(async () => {}) },
}));

vi.mock("electron", () => ({
  app: electron.app,
  ipcMain: electron.ipcMain,
  shell: electron.shell,
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
  },
}));

vi.mock("./voicerai-account", () => ({
  // `openSignInPage` is the same spy the test asserts on.
  AccountStore: class {
    state() {
      return { signedIn: false, profile: null, signedInAt: null };
    }
  },
  DEEP_LINK_SCHEME: "voicerai",
  exchangeCode: vi.fn(),
  openSignInPage: () =>
    electron.shell.openExternal("https://example.test/desktop-auth"),
  signInUrl: () => "https://example.test/desktop-auth",
  uploadFile: vi.fn(),
  verifySession: vi.fn(),
}));

import { registerAccountGate, resetSignInAttempt } from "./voicerai-gate";

type Handler = (...args: unknown[]) => Promise<unknown>;
const handlersByChannel = new Map<string, Handler>();

function handlers() {
  return handlersByChannel;
}

beforeEach(() => {
  // The in-flight attempt flag belongs to the process, so clear it the way a
  // restart would between tests.
  resetSignInAttempt();
  handlersByChannel.clear();
  electron.ipcMain.handle.mockReset();
  electron.app.on.mockClear();
  electron.shell.openExternal.mockClear();
  // ipcMain.handle throws on a duplicate channel, so the mock also records the
  // handler it was given: the tests call them the way Electron would. This must
  // be in place before the gate registers.
  electron.ipcMain.handle.mockImplementation((channel: string, fn: Handler) => {
    handlersByChannel.set(String(channel), fn);
  });
  registerAccountGate(() => null);
});

describe("registerAccountGate", () => {
  it("registers the deep-link listeners once, however often it is called", () => {
    // main registers the gate at startup; a repeat call must not double-handle
    // every hand-off (the first handler would burn the single-use code).
    const before = electron.app.on.mock.calls.length;
    registerAccountGate(() => null);
    registerAccountGate(() => null);
    expect(electron.app.on.mock.calls.length).toBe(before);
  });

  it("opens the sign-in page on the first call", async () => {
    const signIn = handlers().get("voicerai:signIn")!;
    const pending = signIn();
    await Promise.resolve();
    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1);
    // Release the call so it does not outlive the test.
    resetSignInAttempt();
    await expect(pending).rejects.toThrow("Sign-in cancelled.");
  });

  it("joins the attempt already in flight instead of refusing the second click", async () => {
    const signIn = handlers().get("voicerai:signIn")!;
    const first = signIn();
    const second = signIn();
    await Promise.resolve();
    // A second tab would not help, but the call must not reject either.
    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1);
    const settled = await Promise.race([
      Promise.allSettled([first, second]).then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("still waiting"), 50)),
    ]);
    // Both calls are still waiting on the browser, which is a valid state.
    expect(settled).toBe("still waiting");

    // Cancelling releases them with a readable error rather than leaving the
    // IPC call hanging forever (this is also what sign-out does).
    resetSignInAttempt();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.map((o) => o.status)).toEqual(["rejected", "rejected"]);
  });
});
