// @vitest-environment node
import { expect, it } from 'vitest';
import { decideMissingRuntime } from './runtime-repair';

const base = { packaged: true, previouslyInstalled: true, repairAttempted: false };

it('repairs a packaged runtime that lost its environment', () => {
  expect(decideMissingRuntime(base)).toBe('repair');
});
it('stops after one attempt per launch', () => {
  expect(decideMissingRuntime({ ...base, repairAttempted: true })).toBe('repair_failed');
});
it('leaves a first run to the setup wizard', () => {
  expect(decideMissingRuntime({ ...base, previouslyInstalled: false })).toBe('wizard');
});
it('never auto-repairs where the runtime cannot resolve', () => {
  expect(decideMissingRuntime({ ...base, unsupported: true })).toBe('wizard');
});
it('advises setup:api for a source checkout', () => {
  expect(decideMissingRuntime({ ...base, packaged: false })).toBe('setup_api');
});

// The install-detection regression: a machine that has been set up before must
// never be treated as a fresh machine just because the runtime folder went away.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeWasInstalled } from './runtime-repair';

function emptyDir() {
  return mkdtempSync(join(tmpdir(), 'voicerai-install-'));
}

it('treats a fresh machine with no markers and no records as never installed', async () => {
  expect(await runtimeWasInstalled(join(emptyDir(), 'project'), [])).toBe(false);
});

it('still sees an install from the project markers alone', async () => {
  const project = join(emptyDir(), 'project');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, '.runtime-ready'), '{}');
  expect(await runtimeWasInstalled(project, [])).toBe(true);
});

it('sees an earlier install when the runtime folder is gone but its location record survives', async () => {
  const userData = emptyDir();
  const record = join(userData, 'runtime-location.json');
  writeFileSync(record, JSON.stringify({ root: '/mnt/d/VoicerAI', owned: false }));

  // The project folder no longer exists on this machine.
  const missingProject = join(userData, 'runtime', 'project');

  expect(await runtimeWasInstalled(missingProject, [record])).toBe(true);
});

it('sees an earlier install when only the recorded custom root still has markers', async () => {
  const parent = emptyDir();
  const customProject = join(parent, 'project');
  mkdirSync(customProject, { recursive: true });
  writeFileSync(join(customProject, 'pyproject.toml'), '[project]\n');

  const missingDefault = join(emptyDir(), 'runtime', 'project');
  const record = join(emptyDir(), 'runtime-location.json');
  writeFileSync(record, JSON.stringify({ root: parent, owned: false, scoped: true }));

  expect(await runtimeWasInstalled(missingDefault, [record, parent])).toBe(true);
});
