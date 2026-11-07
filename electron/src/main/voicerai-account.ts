import { app, safeStorage, shell } from "electron";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * ThinkFlyFlow account gate for VoicerAI.
 *
 * VoicerAI is a ThinkFlyFlow product, so the desktop app only unlocks for
 * people with a ThinkFlyFlow account. The app never sees a password: the user
 * signs in on the ThinkFlyFlow website, the site hands back a short-lived
 * hand-off code, and this module exchanges that code for the account's API
 * token over a deep link (`voicerai://auth?code=...`).
 *
 * The token is kept in the main process, encrypted with the OS keychain through
 * safeStorage, and only ever used here for `auth/me` and for uploading files.
 * The renderer gets the signed-in profile, never the token itself.
 */

/**
 * Which ThinkFlyFlow deployment this build talks to.
 *
 * A packaged build is always pinned to production, whatever the environment
 * says: a stray variable on a user's machine must never point the account gate
 * somewhere else. An unpackaged (developer) run can point at staging by setting
 * both `VOICERAI_ACCOUNT_ENV=staging` and `VOICERAI_ACCOUNT_ENV_ALLOW=1`, so the
 * sign-in hand-off can be exercised end to end against the test environment
 * before a production release exists.
 */
const PRODUCTION_ORIGINS = {
  web: "https://thinkflyflow.laureljar.com",
  api: "https://api.laureljar.com",
} as const;

const STAGING_ORIGINS = {
  web: "https://thinkflyflow-test.laureljar.com",
  api: "https://apitest.laureljar.com",
} as const;

let webOrigin: string = PRODUCTION_ORIGINS.web;
let apiOrigin: string = PRODUCTION_ORIGINS.api;
let apiBase = `${apiOrigin}/api/v2`;

/**
 * Resolve the deployment once the Electron app object can answer for itself
 * (`isPackaged` is only reliable after the app module has loaded). Callers that
 * run before `whenReady` simply keep the production defaults, which is exactly
 * what a packaged build should use anyway.
 *
 * `VOICERAI_ACCOUNT_ENV` is ignored unless `VOICERAI_ACCOUNT_ENV_ALLOW` is also
 * set. Electron ships any `VOICERAI_*` variable found in the environment, so a
 * single forwarded variable must not be enough to point a released build at the
 * test backend; a tester has to opt in to both.
 */
export function resolveAccountEnvironment(): void {
  const requested =
    process.env.VOICERAI_ACCOUNT_ENV?.trim().toLowerCase() === "staging";
  const allowed = process.env.VOICERAI_ACCOUNT_ENV_ALLOW === "1";
  const packaged = typeof app?.isPackaged === "boolean" ? app.isPackaged : true;
  const origins = requested && allowed && !packaged ? STAGING_ORIGINS : PRODUCTION_ORIGINS;
  webOrigin = origins.web;
  apiOrigin = origins.api;
  apiBase = `${apiOrigin}/api/v2`;
}

/** The resolved API base, for tests that assert which deployment is in use. */
export function __apiBaseForTests(): string {
  return apiBase;
}

export const WEB_ORIGIN = PRODUCTION_ORIGINS.web;
export const API_ORIGIN = PRODUCTION_ORIGINS.api;
export const API_BASE = `${API_ORIGIN}/api/v2`;
export const DEEP_LINK_SCHEME = "voicerai";

/** Server-issued hand-off codes expire quickly; they are single use. */
const REQUEST_TIMEOUT_MS = 20_000;

export interface AccountProfile {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface StoredSession {
  token: string;
  refresh?: string;
  profile: AccountProfile;
  signedInAt: number;
}

export interface AccountState {
  signedIn: boolean;
  profile: AccountProfile | null;
  signedInAt: number | null;
  /** Present when the session was rejected by the server and was cleared. */
  message?: string;
}

export interface UploadResult {
  ok: boolean;
  fileId?: string;
  name?: string;
  size?: number;
  error?: string;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

async function requestJson<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init.token ? authHeader(init.token) : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    };
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      throw new Error(errorMessage(body, response.status));
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Pull a readable message out of whatever shape the API returned. */
function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["error", "detail", "message"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    const nonField = record.non_field_errors;
    if (Array.isArray(nonField) && nonField.length) return String(nonField[0]);
  }
  return `Request failed (${status})`;
}

function sessionFile(): string {
  return join(app.getPath("userData"), "voicerai-account.json");
}

export class AccountStore {
  private session: StoredSession | null | undefined;

  private load(): StoredSession | null {
    if (this.session !== undefined) return this.session;
    try {
      const raw = readFileSync(sessionFile(), "utf8");
      const envelope = JSON.parse(raw) as {
        encrypted?: string;
        plain?: StoredSession;
      };
      if (envelope.encrypted) {
        const decrypted = safeStorage.decryptString(
          Buffer.from(envelope.encrypted, "base64"),
        );
        this.session = JSON.parse(decrypted) as StoredSession;
      } else if (envelope.plain) {
        // safeStorage is unavailable on a few Linux setups without a keyring.
        // The file is written 0600; still better than not being able to sign in.
        this.session = envelope.plain;
      } else {
        this.session = null;
      }
    } catch {
      this.session = null;
    }
    return this.session;
  }

  private persist(session: StoredSession | null): void {
    this.session = session;
    const file = sessionFile();
    if (!session) {
      try {
        rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
      return;
    }
    mkdirSync(dirname(file), { recursive: true });
    const json = JSON.stringify(session);
    // Encrypt with the OS keychain when one is available. Linux desktops
    // without a keyring fall back to a 0600 file rather than refusing to sign in.
    const envelope = safeStorage.isEncryptionAvailable()
      ? { encrypted: safeStorage.encryptString(json).toString("base64") }
      : { plain: session };
    writeFileSync(file, JSON.stringify(envelope), { mode: 0o600 });
  }

  get token(): string | null {
    return this.load()?.token ?? null;
  }

  /** The stored session, loading it from disk on first use. */
  loadSync(): StoredSession | null {
    return this.load();
  }

  state(message?: string): AccountState {
    const session = this.load();
    return {
      signedIn: Boolean(session),
      profile: session?.profile ?? null,
      signedInAt: session?.signedInAt ?? null,
      ...(message ? { message } : {}),
    };
  }

  set(session: StoredSession): AccountState {
    this.persist(session);
    return this.state();
  }

  clear(message?: string): AccountState {
    this.persist(null);
    return this.state(message);
  }
}

/** Exchange a website hand-off code for an API token. */
export async function exchangeCode(code: string): Promise<StoredSession> {
  const body = await requestJson<{
    success?: boolean;
    data?: {
      token?: string;
      access?: string;
      refresh?: string;
      user?: AccountProfile;
    };
  }>("/auth/desktop/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const token = body?.data?.token ?? body?.data?.access;
  if (!token) throw new Error("ThinkFlyFlow did not return a session");
  return {
    token,
    refresh: body?.data?.refresh,
    profile: body?.data?.user as AccountProfile,
    signedInAt: Date.now(),
  };
}

export function signInUrl(): string {
  return `${webOrigin}/desktop-auth?app=voicerai&redirect=${encodeURIComponent(`${DEEP_LINK_SCHEME}://auth`)}`;
}

export async function openSignInPage(): Promise<void> {
  await shell.openExternal(signInUrl());
}

/** Verify the stored token still works, and pick up profile changes. */
export async function verifySession(
  store: AccountStore,
): Promise<AccountState> {
  const session = store.loadSync();
  if (!session) return store.state();
  try {
    const body = await requestJson<{
      success?: boolean;
      data?: AccountProfile;
    }>("/auth/me/", {
      token: session.token,
    });
    const profile = (body?.data ?? body) as AccountProfile;
    if (profile && typeof profile.id === "number") {
      return store.set({ ...session, profile });
    }
    return store.state();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Session expired";
    if (/401|token|expired|invalid|credentials/i.test(message)) {
      return store.clear(
        "Your ThinkFlyFlow session expired. Sign in again to keep using VoicerAI.",
      );
    }
    // Network trouble must not sign the user out; let them keep working.
    return store.state();
  }
}

export async function uploadFile(
  store: AccountStore,
  input: { name: string; data: ArrayBuffer; kind?: string },
): Promise<UploadResult> {
  const session = store.loadSync();
  if (!session)
    return {
      ok: false,
      error: "Sign in to ThinkFlyFlow to save files in the cloud.",
    };
  const size = input.data.byteLength;
  if (size === 0) return { ok: false, error: "That file is empty." };
  if (size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `Voice files must be 5 MB or smaller (this one is ${(size / 1048576).toFixed(1)} MB).`,
    };
  }
  try {
    const projectId = await ensureProject(session.token);
    const form = new FormData();
    form.append(
      "file",
      new Blob([input.data], { type: mimeFor(input.name) }),
      input.name,
    );
    form.append("project_id", projectId);
    const body = await requestJson<{
      success?: boolean;
      data?: { id: string; original_name?: string; size?: number };
    }>("/files/upload/", { method: "POST", token: session.token, body: form });
    if (!body?.data?.id) throw new Error("The upload did not return a file id");
    return {
      ok: true,
      fileId: body.data.id,
      name: body.data.original_name ?? input.name,
      size: body.data.size ?? size,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

export const PROJECT_NAME = "VoicerAI";

/** VoicerAI keeps its cloud files in one project so they are easy to find. */
async function ensureProject(token: string): Promise<string> {
  const workspaces = await requestJson<{
    success?: boolean;
    data?: Array<{ id: string }>;
  }>("/workspaces/", { token });
  let workspaceId = workspaces?.data?.[0]?.id;
  if (!workspaceId) {
    const created = await requestJson<{ data: { id: string } }>(
      "/workspaces/",
      {
        method: "POST",
        token,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "My Workspace",
          plan: "free",
          type: "individual",
        }),
      },
    );
    workspaceId = created?.data?.id;
  }
  if (!workspaceId)
    throw new Error("Could not find a workspace for this account");

  const projects = await requestJson<{
    data?: Array<{ id: string; name: string; workspace?: string }>;
  }>(`/workspaces/${workspaceId}/projects/`, { token });
  const existing = projects?.data?.find((p) => p.name === PROJECT_NAME);
  if (existing) return existing.id;

  const created = await requestJson<{ data: { id: string } }>("/projects/", {
    method: "POST",
    token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace: workspaceId,
      name: PROJECT_NAME,
      icon: "🎙️",
    }),
  });
  if (!created?.data?.id)
    throw new Error("Could not create the VoicerAI project");
  return created.data.id;
}

function mimeFor(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "wav":
      return "audio/wav";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "flac":
      return "audio/flac";
    case "ogg":
      return "audio/ogg";
    case "zip":
      return "application/zip";
    case "json":
      return "application/json";
    case "txt":
      return "text/plain";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

export { MAX_UPLOAD_BYTES };
