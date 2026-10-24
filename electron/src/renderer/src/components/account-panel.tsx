import { useCallback, useEffect, useRef, useState } from "react";
import {
  CloudUploadIcon,
  LoaderCircleIcon,
  LogOutIcon,
  UserRoundIcon,
} from "lucide-react";
import { getBridge } from "@/components/bridge";
import { Button } from "@/components/ui/button";

/**
 * Account panel and cloud upload for VoicerAI.
 *
 * The app is unlocked by the ThinkFlyFlow sign-in gate, so by the time this
 * renders there is always a signed-in user. What lives here is the second half
 * of that: taking a file the app produced and saving it in the user's
 * ThinkFlyFlow workspace. Voice files are capped at 5 MB; the check runs here
 * so people get an instant answer, and again on the server so the limit holds
 * no matter what talks to the API.
 */

const MAX_VOICE_BYTES = 5 * 1024 * 1024;

interface Profile {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
}

interface UploadOutcome {
  name: string;
  ok: boolean;
  detail: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function AccountPanel() {
  const api = getBridge()?.voicerai;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.state().then((state) => live && setProfile(state.profile));
    const off = api.onState((state) => setProfile(state.profile));
    return () => {
      live = false;
      off();
    };
  }, [api]);

  const upload = useCallback(
    async (files: FileList) => {
      if (!api) return;
      setBusy(true);
      const results: UploadOutcome[] = [];
      for (const file of Array.from(files)) {
        if (file.size > MAX_VOICE_BYTES) {
          results.push({
            name: file.name,
            ok: false,
            detail: `${humanSize(file.size)} is over the 5 MB voice file limit`,
          });
          continue;
        }
        try {
          const data = await file.arrayBuffer();
          const result = await api.upload({ name: file.name, data });
          results.push({
            name: file.name,
            ok: result.ok,
            detail: result.ok
              ? "Saved to ThinkFlyFlow"
              : (result.error ?? "Upload failed"),
          });
        } catch (error) {
          results.push({
            name: file.name,
            ok: false,
            detail: error instanceof Error ? error.message : "Upload failed",
          });
        }
      }
      setOutcomes(results);
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    },
    [api],
  );

  if (!api) return null;

  const name =
    `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() ||
    profile?.username ||
    profile?.email ||
    "";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <UserRoundIcon className="size-4 text-muted-foreground" />
          <div className="leading-tight">
            <div className="text-sm font-medium">
              {name || "ThinkFlyFlow account"}
            </div>
            <div className="text-xs text-muted-foreground">
              {profile?.email}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void api.signOut()}>
          <LogOutIcon className="size-3.5" />
          Sign out
        </Button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Anything you make in VoicerAI can go straight into your ThinkFlyFlow
        workspace, under a project called VoicerAI. Voice files can be up to 5
        MB each.
      </p>

      <div className="mt-3">
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg,.opus"
          className="hidden"
          onChange={(event) =>
            event.target.files && void upload(event.target.files)
          }
        />
        <Button disabled={busy} onClick={() => fileInput.current?.click()}>
          {busy ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <CloudUploadIcon className="size-4" />
          )}
          {busy ? "Uploading…" : "Upload a voice file"}
        </Button>
      </div>

      {outcomes.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {outcomes.map((outcome) => (
            <li
              key={`${outcome.name}-${outcome.detail}`}
              className={`rounded-lg px-3 py-2 text-xs ${
                outcome.ok
                  ? "bg-primary/10 text-foreground"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              <span className="font-medium">{outcome.name}</span>
              {": "}
              {outcome.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
