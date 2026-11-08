import { stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * What to do when the managed Python environment is not usable (#2988, #2948,
 * #2922, #2787, #2783, #2621). A runtime that was installed once and lost its
 * interpreter (antivirus, disk cleanup, an interrupted update) is rebuilt by the
 * same flow the setup wizard runs, once per launch; a first run still waits for
 * the user's explicit choice (download size, location, region).
 */
export type MissingRuntimeAction =
  | 'repair' // re-run setup automatically
  | 'wizard' // first run: show the setup screen and let the user start it
  | 'repair_failed' // already tried this launch: stop and show the message
  | 'setup_api'; // source checkout: the developer runs `bun run setup:api`

export interface MissingRuntimeFacts {
  packaged: boolean;
  /** The project folder holds traces of an earlier install (marker, .venv, bundle). */
  previouslyInstalled: boolean;
  /** An automatic repair has already been started during this launch. */
  repairAttempted: boolean;
  /** The platform can never resolve the runtime (Intel Mac): repairing would only fail. */
  unsupported?: boolean;
}

export function decideMissingRuntime(facts: MissingRuntimeFacts): MissingRuntimeAction {
  if (!facts.packaged) return 'setup_api';
  if (facts.unsupported || !facts.previouslyInstalled) return 'wizard';
  return facts.repairAttempted ? 'repair_failed' : 'repair';
}

/** Markers inside the runtime project folder that only exist after a setup ran. */
const RUNTIME_PROJECT_MARKERS = ['.runtime-ready', '.runtime-installing', '.venv', 'pyproject.toml'];

/**
 * True when this machine shows an earlier install (never true for a fresh machine).
 *
 * The project markers alone are not enough. A user who moves the runtime folder,
 * reinstalls over an install whose runtime failed to unpack, or keeps data on a
 * second drive leaves those markers behind, and reporting "never installed" sends
 * them back through first-run setup as though nothing was ever there. `records`
 * are durable paths that outlive the folder; any one of them is proof this machine
 * has been set up before.
 */
export async function runtimeWasInstalled(
  project: string,
  records: string[] = [],
): Promise<boolean> {
  for (const candidate of [project, ...records]) {
    for (const name of RUNTIME_PROJECT_MARKERS) {
      try {
        await stat(join(candidate, name));
        return true;
      } catch {
        /* absent */
      }
    }
  }
  for (const record of records) {
    try {
      await stat(record);
      return true;
    } catch {
      /* absent */
    }
  }
  return false;
}
