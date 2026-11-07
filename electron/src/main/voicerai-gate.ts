import { app, ipcMain, type BrowserWindow } from "electron";
import {
  AccountStore,
  DEEP_LINK_SCHEME,
  exchangeCode,
  openSignInPage,
  resolveAccountEnvironment,
  signInUrl,
  uploadFile,
  verifySession,
  type AccountState,
} from "./voicerai-account";

/**
 * Wires the ThinkFlyFlow account gate into the shell:
 *
 *  - `voicerai://` deep links are the way the website hands a signed-in user
 *    back to the app. They are registered with the OS at startup and routed
 *    here from both the first launch (`open-url` / argv) and later launches
 *    (`second-instance`).
 *  - IPC gives the renderer the profile, a sign-in trigger and the cloud
 *    upload. The API token stays in this process.
 */

const store = new AccountStore();
let emit: (state: AccountState) => void = () => {};

/** Sign-in waits on the user's browser, so give it a generous window. */
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

interface Waiter {
  resolve: (state: AccountState) => void;
  reject: (error: Error) => void;
}

/**
 * Sign-in is driven by the browser, so this process only waits for a deep link
 * to come back. A list rather than a single slot: a retry, or a click on the
 * button while the previous attempt is still open, joins the same wait instead
 * of being refused.
 */
let waiters: Waiter[] = [];
let signInTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * True from the click until the hand-off comes back (or times out). Kept apart
 * from the waiter list because the list empties once it has been settled, while
 * the browser tab may still be open: a click in that window joins the attempt
 * that is still running instead of opening a second tab.
 */
let attemptOpen = false;

/** Deep links that arrive before the gate is registered (very early launch). */
const queuedLinks: string[] = [];

function settleWaiters(settle: (waiter: Waiter) => void): void {
  if (signInTimer) clearTimeout(signInTimer);
  signInTimer = null;
  attemptOpen = false;
  const current = waiters;
  waiters = [];
  for (const waiter of current) settle(waiter);
}

/** Add a caller to the current attempt and (re)arm its clock. */
function joinAttempt(): Promise<AccountState> {
  const promise = new Promise<AccountState>((resolve, reject) => {
    waiters.push({ resolve, reject });
  });
  if (signInTimer) clearTimeout(signInTimer);
  signInTimer = setTimeout(onSignInTimeout, SIGN_IN_TIMEOUT_MS);
  return promise;
}

function onSignInTimeout(): void {
  settleWaiters((waiter) =>
    waiter.reject(
      new Error(
        "The sign-in window timed out. Click Sign in again to open a fresh one.",
      ),
    ),
  );
}

/** True while a sign-in is waiting on the browser (surfaced for diagnostics). */
export function signInPending(): boolean {
  return attemptOpen;
}

/** Drop any in-flight attempt. Used by tests and by a forced sign-out. */
export function resetSignInAttempt(message = "Sign-in cancelled."): void {
  settleWaiters((waiter) => waiter.reject(new Error(message)));
  queuedLinks.length = 0;
}

export const CLAIM_PATH = "/desktop-auth";

/** Extract the hand-off code from a `voicerai://auth?code=...` URL. */
export function codeFromDeepLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
    // `voicerai://auth?code=x` parses as host "auth"; the bare `voicerai:///?code=x`
    // form has an empty route, which still means "the sign-in hand-off". Only a
    // named route other than auth is a miss.
    const route = (
      url.hostname || url.pathname.replace(/^\/+/, "")
    ).toLowerCase();
    if (route && route !== "auth") return null;
    const code = url.searchParams.get("code");
    return code && code.trim() ? code.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Queue a deep link that arrived from the launch arguments.
 *
 * It has to wait for the gate: the signed-in state is created on first use, and
 * the gate stores the session that a hand-off unlocks. Delivering it earlier (or
 * reading that state earlier, just to make it eager) means an exchange that
 * succeeds but is then thrown away, so a cold start from `voicerai://` would
 * silently land on the sign-in screen again.
 */
export function queueDeepLink(link: string | null): void {
  if (!link) return;
  queuedLinks.push(link);
}

export function registerAccountGate(
  getWindow: () => BrowserWindow | null,
): void {
  // `isPackaged` is only trustworthy now that the app has loaded, so the
  // environment is resolved here rather than at module import time.
  resolveAccountEnvironment();
  getWindowRef = getWindow;
  emit = (state) => {
    const win = getWindow();
    win?.webContents.send("voicerai:state", state);
  };

  ipcMain.handle("voicerai:state", () => store.state());

  ipcMain.handle("voicerai:refresh", async () => {
    const state = await verifySession(store);
    emit(state);
    return state;
  });

  ipcMain.handle("voicerai:signOut", async () => {
    // Abandon any sign-in that is still waiting, so it cannot unlock the app
    // behind the user's back after they have signed out.
    resetSignInAttempt();
    const state = store.clear();
    emit(state);
    return state;
  });

  ipcMain.handle("voicerai:signIn", async () => {
    // Opening a second tab would not help, but refusing outright would strand
    // the user behind an attempt they abandoned. Reuse the wait that is already
    // running: whichever sign-in completes answers every caller in it.
    const joining = attemptOpen;
    attemptOpen = true;
    const waiting = joinAttempt();
    // Only the first caller opens the browser; the rest join the wait.
    if (!joining) {
      try {
        await openSignInPage();
      } catch (error) {
        settleWaiters((waiter) => waiter.reject(error as Error));
        throw error;
      }
    }
    return waiting;
  });

  ipcMain.handle(
    "voicerai:upload",
    (_event, input: { name: string; data: ArrayBuffer }) => {
      if (!input || typeof input.name !== "string" || !input.data) {
        return { ok: false, error: "Nothing to upload" };
      }
      return uploadFile(store, input);
    },
  );

  if (registered) {
    // Still flush: a launch argument queued after registration must not be
    // stranded by an early return.
    for (const link of queuedLinks.splice(0)) void handleDeepLink(link);
    return;
  }
  registered = true;

  // Second launch while the app is open: the OS passes the deep link in argv.
  // Registered once, here, and NOT alongside the other second-instance listener
  // in main: a second listener for the same event would handle every hand-off
  // twice, burning the single-use code on the first handler and failing the
  // second, so the app reported a failed sign-in that had actually succeeded.
  app.on("second-instance", (_event, argv) => {
    const link = deepLinkFromArgv(argv);
    if (link) void handleDeepLink(link);
  });

  // macOS delivers URLs to the running app through open-url.
  app.on("open-url", (event, url) => {
    if (!url.startsWith(`${DEEP_LINK_SCHEME}://`)) return;
    event.preventDefault();
    void handleDeepLink(url);
  });

  // Register the link handler on every platform. Windows needs it too: without
  // it the browser's `voicerai://` link has no target and the sign-in silently
  // goes nowhere. During development Electron needs the app's own arguments so
  // the handler launches this app rather than the Electron default.
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  } else {
    const executable = process.execPath;
    const entry = process.argv.length > 1 ? process.argv[1] : null;
    if (entry) {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, executable, [entry]);
    } else {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
    }
  }

  // Any link that arrived before this point is handled now, in order.
  for (const link of queuedLinks.splice(0)) void handleDeepLink(link);
}

/**
 * A deep link from the launch argv (Windows/Linux) or from a very early
 * second-instance event. Queued until the gate is ready to use the store.
 */
export function deliverDeepLink(link: string | null): void {
  if (!link) return;
  if (!registered) {
    queuedLinks.push(link);
    return;
  }
  void handleDeepLink(link);
}

/** Pick a deep link out of the launch argv and handle it once ready. */
export function deepLinkFromArgv(argv: string[]): string | null {
  const link = argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`));
  return link ?? null;
}

export async function handleDeepLink(
  url: string,
): Promise<AccountState | null> {
  const code = codeFromDeepLink(url);
  if (!code) return null;
  try {
    const session = await exchangeCode(code);
    const state = store.set(session);
    settleWaiters((waiter) => waiter.resolve(state));
    emit(state);
    const win = BrowserWindowRef();
    if (win && win.isMinimized()) win.restore();
    win?.focus();
    return state;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not complete the ThinkFlyFlow sign-in";
    settleWaiters((waiter) => waiter.reject(new Error(message)));
    emit(store.state(message));
    return null;
  }
}

function BrowserWindowRef(): BrowserWindow | null {
  return getWindowRef?.() ?? null;
}

let getWindowRef: (() => BrowserWindow | null) | null = null;
let registered = false;

export { signInUrl };
