import { app, ipcMain, type BrowserWindow } from "electron";
import {
  AccountStore,
  DEEP_LINK_SCHEME,
  exchangeCode,
  openSignInPage,
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

let pending: {
  resolve: (state: AccountState) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

export const CLAIM_PATH = "/desktop-auth";

/** Extract the hand-off code from a `voicerai://auth?code=...` URL. */
export function codeFromDeepLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
    // voicerai://auth?code=x parses as host "auth"; voicerai:///?code=x as "".
    const route = (
      url.hostname || url.pathname.replace(/^\/+/, "")
    ).toLowerCase();
    if (route !== "auth") return null;
    const code = url.searchParams.get("code");
    return code && code.trim() ? code.trim() : null;
  } catch {
    return null;
  }
}

export function registerAccountGate(
  getWindow: () => BrowserWindow | null,
): void {
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
    const state = store.clear();
    emit(state);
    return state;
  });

  ipcMain.handle("voicerai:signIn", async () => {
    if (pending) {
      // A dialog is already open; reuse the wait rather than opening two tabs.
      throw new Error("A sign-in window is already open in your browser.");
    }
    const waiting = new Promise<AccountState>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending = null;
        reject(new Error("Sign-in timed out. Try again from the app."));
      }, SIGN_IN_TIMEOUT_MS);
      pending = { resolve, reject, timer };
    });
    try {
      await openSignInPage();
    } catch (error) {
      const active = pending as { timer: ReturnType<typeof setTimeout> } | null;
      if (active) clearTimeout(active.timer);
      pending = null;
      throw error;
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

  // Second launch while the app is open: the OS passes the deep link in argv.
  app.on("second-instance", (_event, argv) => {
    for (const arg of argv) {
      if (arg.startsWith(`${DEEP_LINK_SCHEME}://`)) void handleDeepLink(arg);
    }
  });

  // macOS delivers URLs to the running app through open-url.
  app.on("open-url", (event, url) => {
    if (!url.startsWith(`${DEEP_LINK_SCHEME}://`)) return;
    event.preventDefault();
    void handleDeepLink(url);
  });

  if (process.platform === "darwin") {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }
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
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(state);
      pending = null;
    }
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
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      pending = null;
    }
    emit(store.state(message));
    return null;
  }
}

function BrowserWindowRef(): BrowserWindow | null {
  return getWindowRef?.() ?? null;
}

let getWindowRef: (() => BrowserWindow | null) | null = null;

export { signInUrl };
