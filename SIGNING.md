# Signing the VoicerAI installers (free route)

Status: **Windows via SignPath Foundation (free, application pending). macOS deferred.**

This file is the working checklist for getting rid of the "unknown publisher" warnings without
buying a certificate. It records what is already wired up, what only you can do, and the exact
trade being made.

---

## The trade, stated plainly

SignPath Foundation issues the certificate **to themselves**, not to you. Everything else here
follows from that:

- The publisher shown in the installer's Properties dialog and in the SmartScreen prompt will read
  **SignPath Foundation**, not ThinkFlyFlow or FedaCash.
- They can pause the subscription or revoke the certificate if the project breaks their code of
  conduct, and revocation can be retroactive (existing signatures stop validating).
- You must be the maintainer of all source in the signed bundle, and every job leading to the
  signing request must run on GitHub-hosted agents.
- If the publisher line ever needs to say ThinkFlyFlow, this route cannot do it. That is a paid OV or
  EV certificate, roughly $200 to $600 a year.

## macOS: no free equivalent

Apple has no open source signing programme. Developer ID plus notarization needs a $99/yr Apple
Developer Program membership, an Apple ID with two-factor authentication, and a D-U-N-S number for
the company. None of that can be automated from a server.

Current macOS state is unchanged and honest: the app is **ad-hoc signed**
(`identity: '-'` in `electron/electron-builder.config.mjs`), which keeps the bundle from reporting
itself as "damaged" after quarantine, and users still see the Gatekeeper warning and must allow the
app in System Settings. That warning is expected, not a bug.

## Eligibility check against the actual repository

| SignPath condition | VoicerAI state | Verdict |
| --- | --- | --- |
| OSI-approved licence, no commercial dual-licensing | AGPL-3.0-only in `LICENSE`, `package.json`, `electron/package.json` | Pass |
| Already released in the form to be signed | v1.0.6, 2026-11-07, Windows + macOS assets attached | Pass |
| Actively maintained | Commits through 2026-11-07 | Pass |
| Documented on a download page | VoicerAI product page on thinkflyflow | Pass |
| No proprietary components | Clean: no licence keys, no paid gating, no private backend in the bundle. The upstream "Pro" upsell points outward to voicestudio.sh and is not code | Pass |
| Not a hacking tool | Voice cloning and TTS, runs locally | Pass |
| Publisher is SignPath Foundation | Accepted trade, see above | Accepted |

Two things to keep in mind if they ask follow-up questions:

1. **Repository is private, and the product is a fork.** SignPath links builds to repositories through
   their GitHub App, which reads the repo regardless of visibility, so a private repo is workable.
   But voice cloning is a category some reviewers scrutinise closely, so expect questions about
   consent and abuse handling. Have the anti-abuse answer ready: the engine runs locally, no hosted
   cloning service, and the ThinkFlyFlow account backend is not part of the signed binary.
2. **The name on the binary is still `voicestudio-*` internally** in some places (package names,
   `voicestudio.sh` links). That is inherited from upstream and is expected for an AGPL fork; do not
   try to scrub it before applying, it would break the upstream-relationship story rather than help.

## What is already wired in the repo

Nothing needs to be written when approval lands. These pieces are in place and inert:

- `.github/workflows/voicerai-signpath.yml` signs the Windows installer through
  `signpath/github-action-submit-signing-request`, verifies the result with
  `Get-AuthenticodeSignature`, and replaces the asset on the release and on the stable `downloads`
  tag. It is gated on the repository variable `SIGNPATH_ENABLED == 'true'`, so it cannot break a
  release before onboarding.
- `electron/build/signpath/artifact-configuration.xml` is the artifact configuration for a single
  NSIS installer, signed with SHA-256 Authenticode plus an RFC3161 timestamp supplied by the signing
  policy.
- `voicerai-release.yml` already reports the signature state in the run summary and keeps producing
  unsigned installers until SignPath is live.

## Steps for you (cannot be automated)

1. **Apply at <https://signpath.org/apply>** using the repository `rilwan2003/voicerai`. Reference the
   AGPL-3.0 licence and release v1.0.6. This submission needs your sign-off on their terms as the
   project owner, so it is the one step I cannot do on your behalf.
2. **Wait for approval.** They review the repo, the licence, and the release. There is no fee and no
   payment step.
3. **After approval, in the SignPath UI:**
   - Create a project with slug `voicerai`, linked to the GitHub trusted build system.
   - Upload `electron/build/signpath/artifact-configuration.xml` as the artifact configuration.
   - Create a signing policy with slug `release-signing`, using an RFC3161 timestamp server.
   - Generate an API token scoped to submitting signing requests.
4. **Install the SignPath GitHub App** on the repository: <https://github.com/apps/signpath>.
5. **Add the secrets** in `rilwan2003/voicerai` → Settings → Secrets and variables → Actions:
   - `SIGNPATH_API_TOKEN`
   - `SIGNPATH_ORG_ID`
   - `SIGNPATH_PROJECT_SLUG` = `voicerai`
   - `SIGNPATH_POLICY_SLUG` = `release-signing`
6. **Add the variable** `SIGNPATH_ENABLED` = `true` under the Variables tab (not Secrets).
7. **Tell me**, and I will run the workflow against a tag. Success looks like
   `SIGNED: CN=SignPath Foundation, ...` in the run summary, and `Status: Valid` from
   `Get-AuthenticodeSignature`.

## How to verify a build is really signed

On Windows:

```powershell
Get-AuthenticodeSignature .\VoicerAI-Windows-x64-Setup.exe | Format-List Status, SignerCertificate
```

On any platform with `osslsigncode` installed:

```bash
osslsigncode verify -in VoicerAI-Windows-x64-Setup.exe
```

`Status: Valid` or `No signature found` are the only two honest outcomes. A signature that exists but
does not validate usually means the file was modified after signing.

## If they decline

Nothing rots. The release pipeline keeps producing unsigned installers, the summary keeps saying
`UNSIGNED:`, and the download page keeps its warning. The alternative at that point is a paid
certificate in the company's name, which is a purchase decision, not a build task.
