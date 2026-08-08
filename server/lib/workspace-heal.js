// Repairs the KEMU "nested artifact" write bug: workspace/<name>.json/<name>.json.
//
// KEMU's WriteFile creates a DIRECTORY named after the file and drops the payload inside it when the
// agent calls it with named params — `WriteFile({ fileName: …, content: … })` instead of the positional
// `WriteFile("sn_groups.json", JSON.stringify(…))`. Every agent instruction file warns about this, but
// it's a model behaviour, not something the prompt can guarantee, and the damage is silent: the server
// reads workspace/<name>.json, gets EISDIR, and every reader here swallows read errors by design (a
// missing artifact is a normal state). So SN falls back to floor-only groups, a phase looks like it
// produced nothing, and nothing in the log says why.
//
// Cheapest reliable fix is server-side: after any agent turn, sweep the workspace and lift a nested
// payload back to where it belongs. Runs on a directory of ~25 entries, so cost is irrelevant next to
// a KEMU round-trip.
//
// Deliberately conservative — it MOVES, never deletes:
//   1. the wrapper directory is renamed aside first, so the payload is never left without a home;
//   2. the payload is moved to the canonical path;
//   3. the aside directory is removed ONLY if it is empty. Anything else the agent put in there is
//      left on disk with a warning rather than being cleaned up silently.
import { readdirSync, renameSync, rmdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { WORKSPACE_DIR } from '../config/constants.js';

// Returns the names of the artifacts it repaired (empty array = nothing to do, the normal case).
export function healNestedArtifacts(workspaceDir = WORKSPACE_DIR) {
  const healed = [];
  let entries;
  try { entries = readdirSync(workspaceDir, { withFileTypes: true }); } catch { return healed; }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith('.json')) continue;
    const wrapper = join(workspaceDir, entry.name);
    // Only the exact <name>/<name> shape is the known bug. A directory that happens to end in .json
    // but holds something else is left alone.
    const payload = join(wrapper, entry.name);
    try {
      if (!existsSync(payload) || !statSync(payload).isFile()) continue;

      const aside = join(workspaceDir, `.${entry.name}.nested-${Date.now()}`);
      renameSync(wrapper, aside);                          // frees the canonical name
      renameSync(join(aside, entry.name), join(workspaceDir, entry.name));
      const leftovers = readdirSync(aside);
      if (leftovers.length === 0) {
        rmdirSync(aside);
      } else {
        console.warn(`[workspace] ${entry.name}: kept ${aside} — it also held ${leftovers.join(', ')}`);
      }
      healed.push(entry.name);
    } catch (e) {
      console.error(`[workspace] could not repair nested ${entry.name}:`, e.message);
    }
  }

  if (healed.length) {
    console.warn(`[workspace] repaired KEMU nested write(s): ${healed.join(', ')} ` +
                 `— an agent called WriteFile with named params instead of positional`);
  }
  return healed;
}
