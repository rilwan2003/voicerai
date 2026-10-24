import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  LogOutIcon,
} from "lucide-react";
import { getBridge } from "@/components/bridge";
import { brandIcon } from "@/lib/brand";
import { Button } from "@/components/ui/button";

/**
 * VoicerAI only runs for a signed-in ThinkFlyFlow user.
 *
 * The desktop app never asks for a password. "Sign in" opens the ThinkFlyFlow
 * website in the default browser; once the visitor is signed in there, the site
 * hands a single-use code back to the app over `voicerai://auth?code=...`, and
 * the main process swaps it for an API token. This screen only ever sees the
 * profile that comes back.
 */

interface Profile {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
}

interface AccountState {
  signedIn: boolean;
  profile: Profile | null;
  signedInAt: number | null;
  message?: string;
}

type Phase = "loading" | "signedOut" | "opening" | "signedIn";

function displayName(profile: Profile | null): string {
  if (!profile) return "";
  const full = `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim();
  return full || profile.username || profile.email;
}

/** The bridge is absent in a plain browser tab (vitest, web preview). */
function accountApi() {
  return getBridge()?.voicerai ?? null;
}

export function AccountGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AccountState | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((next: AccountState) => {
    setState(next);
    if (next.message) setError(next.message);
    setPhase(next.signedIn ? "signedIn" : "signedOut");
  }, []);

  useEffect(() => {
    const api = accountApi();
    if (!api) {
      // No Electron shell in front of us; nothing to gate.
      setPhase("signedIn");
      return;
    }
    let cancelled = false;
    void api
      .state()
      .then((next) => {
        if (cancelled) return;
        apply(next);
        // Confirm the stored session is still good, without blocking the UI.
        if (next.signedIn)
          void api.refresh().then((fresh) => !cancelled && apply(fresh));
      })
      .catch(() => !cancelled && setPhase("signedOut"));
    const off = api.onState((next) => {
      if (!cancelled) apply(next);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [apply]);

  const signIn = useCallback(async () => {
    const api = accountApi();
    if (!api) return;
    setError(null);
    setPhase("opening");
    try {
      const next = await api.signIn();
      apply(next);
    } catch (cause) {
      setPhase("signedOut");
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not sign in to ThinkFlyFlow.",
      );
    }
  }, [apply]);

  const signOut = useCallback(async () => {
    const api = accountApi();
    if (!api) return;
    apply(await api.signOut());
  }, [apply]);

  if (phase === "signedIn") return <>{children}</>;

  return (
    <div className="app-surface relative flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="flex min-h-full flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5">
            <img src={brandIcon} alt="" className="size-9" />
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">
                VoicerAI
              </div>
              <div className="text-xs text-muted-foreground">
                by ThinkFlyFlow
              </div>
            </div>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">
            Use your ThinkFlyFlow account
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            VoicerAI is part of ThinkFlyFlow. Sign in with the account you
            already use there to open the app, and every file you create can be
            saved straight to your ThinkFlyFlow workspace.
          </p>

          <div className="mt-6 rounded-xl border border-border bg-card p-4">
            {phase === "loading" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" />
                Checking your session…
              </div>
            )}

            {phase === "opening" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <LoaderCircleIcon className="size-4 animate-spin text-primary" />
                  Waiting for you to finish signing in your browser…
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  A ThinkFlyFlow tab should have opened. Sign in there, or
                  create an account, and this window unlocks on its own. Keep
                  this app open.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void signIn()}
                >
                  <ExternalLinkIcon className="size-3.5" />
                  Open the sign-in page again
                </Button>
              </div>
            )}

            {phase === "signedOut" && (
              <div className="space-y-4">
                <Button className="w-full" onClick={() => void signIn()}>
                  <ExternalLinkIcon className="size-4" />
                  Sign in to ThinkFlyFlow
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  No account yet? The same page lets you create one for free.
                </p>
              </div>
            )}

            {error && (
              <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                {error}
              </p>
            )}
          </div>

          {state?.signedIn && state.profile && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2Icon className="size-4 text-primary" />
                <div className="leading-tight">
                  <div className="text-sm font-medium">
                    {displayName(state.profile)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {state.profile.email}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                <LogOutIcon className="size-3.5" />
                Sign out
              </Button>
            </div>
          )}

          <ul className="mt-6 space-y-2 text-xs text-muted-foreground">
            <li>
              Voice cloning runs on this computer. Your recordings stay local.
            </li>
            <li>
              Upload finished voice files to your ThinkFlyFlow workspace any
              time.
            </li>
            <li>Voice files can be up to 5 MB each.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
