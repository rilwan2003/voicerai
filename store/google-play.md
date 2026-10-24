# Google Play runbook

Status: listing prepared; no Play Console app exists yet.

Package name: `sh.voicestudio.mobile`

Everything the Play Console asks for is in [`google-play/listing.json`](google-play/listing.json),
so the answers stay reviewable in Git. Graphics are rendered from the app's own
brand sources by `uv run python scripts/create_google_play_assets.py`.
`tests/test_google_play_listing.py` checks Play's length and size limits and that
every permission in the Android manifest has a declaration here.

## Owner steps

1. Register a Play developer account as an **organization** (Yupcha Softwares
   Private Limited; needs a D-U-N-S number). New personal accounts must run a
   closed test with 12 testers for 14 days before production.
2. Create the app with the package name above, keep Play App Signing on, and set
   the contact email.
3. **Main store listing:** title, short and full description (join the
   `fullDescription` lines with newlines), icon, feature graphic, category and
   2–8 phone screenshots.
4. **App content:** privacy policy URL, ads (none), app access (no login), target
   audience, content rating questionnaire and the data safety form from
   `dataSafety` (no data collected or shared).
5. **Permissions and foreground services:** use the reasons in `permissions`.
   Play asks for a short video of each foreground service type in use.
6. Upload the first bundle by hand, then use the `Android Play internal testing`
   workflow ([`docs/mobile.md`](../docs/mobile.md#play-internal-testing-maintainers)).

## Before production

- **AI-generated content:** Play requires an in-app way to report or flag
  offensive generated content. The app does not have one yet; it ships on both
  phone apps or neither (`mobile/contract/SPEC.md`).
- **Privacy policy:** `https://voicestudio.sh/privacy` should describe the phone
  apps (what leaves the phone: model downloads and requests to the paired computer).
- **Screenshots:** capture from a release build on a phone or emulator.
