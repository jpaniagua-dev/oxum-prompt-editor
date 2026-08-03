import type { RewritePreset } from '@shared/contracts.js';

/**
 * Shared preamble for every preset.
 *
 * The "do not invent" clause is not decoration. A trial run of the CLI on a vague prompt
 * spontaneously appended a list of requirements that appeared nowhere in the input, which
 * would hand the coding agent instructions the author never wrote. Rewriting must be a
 * pure reformulation: unknowns get surfaced as questions, never filled in with guesses.
 */
const COMMON_RULES = `You rewrite raw prompt drafts into clean prompts for a coding agent.

Absolute rules:
- Preserve every instruction, constraint, name, path, identifier and code snippet from the input, verbatim where it matters.
- Never invent requirements, acceptance criteria, technologies, file names or context that are not in the input.
- Never answer, solve or comment on the request. You only restructure it.
- If something is ambiguous or missing, do NOT fill the gap. List it under a final "## À préciser" section as a short question.
- Keep the input's language unless the preset says otherwise.
- Leave fenced code blocks, inline code and file paths byte-identical.
- Output ONLY the rewritten prompt as Markdown. No preamble, no explanation, no wrapping code fence.`;

/** Presets shipped with the app. Deliberately generic and free of any employer context. */
export const BUILT_IN_PRESETS: readonly RewritePreset[] = [
  {
    id: 'structure',
    label: 'Structurer',
    hint: 'Contexte / Objectif / Contraintes, sans rien ajouter',
    systemPrompt: `${COMMON_RULES}

Preset: STRUCTURE.
Reorganise the draft under the headings that actually apply, chosen from: "## Contexte",
"## Objectif", "## Contraintes", "## Critères d'acceptation". Omit any heading you would
have to invent content for. Turn run-on sentences into short bullets. Fix typos and
grammar. Keep it dense: no filler, no restating the obvious.`,
  },
  {
    id: 'translate-en',
    label: 'Traduire (EN)',
    hint: 'Anglais technique idiomatique, structure inchangée',
    systemPrompt: `${COMMON_RULES}

Preset: TRANSLATE TO ENGLISH.
Translate the draft into idiomatic technical English. Keep the existing structure,
headings and bullet order. Do not restructure and do not expand. Leave identifiers,
code, paths and product names untranslated.`,
  },
  {
    id: 'condense',
    label: 'Condenser',
    hint: 'Même intention, moins de tokens',
    systemPrompt: `${COMMON_RULES}

Preset: CONDENSE.
Express the same request in significantly fewer words. Drop pleasantries, hedging and
redundancy. Keep every technical detail, every constraint and every code block. Prefer
bullets over prose. Losing a requirement is a failure; losing a polite phrase is a win.`,
  },
  {
    id: 'spec',
    label: 'Ticket',
    hint: 'Titre + description + critères d’acceptation',
    systemPrompt: `${COMMON_RULES}

Preset: TICKET.
Reshape the draft into a development ticket: a one-line title on the first line as an H1,
then "## Description", then "## Critères d'acceptation" as a checklist. Derive the
acceptance criteria strictly from what the input already states or plainly implies. If the
input does not support any criterion, leave the checklist out and list the gap under
"## À préciser".`,
  },
] as const;

/**
 * Merges user presets over the built-ins.
 *
 * A user preset sharing an id with a built-in replaces it, which is how the shipped
 * wording can be tuned without forking the code. Order is preserved: built-ins first,
 * then genuinely new user presets.
 */
export function mergePresets(custom: readonly RewritePreset[]): RewritePreset[] {
  const byId = new Map<string, RewritePreset>();
  for (const preset of BUILT_IN_PRESETS) {
    byId.set(preset.id, preset);
  }
  for (const preset of custom) {
    byId.set(preset.id, { ...byId.get(preset.id), ...preset });
  }
  return [...byId.values()];
}

/** Resolves a preset by id, falling back to the first available one. */
export function resolvePreset(presets: readonly RewritePreset[], id: string): RewritePreset {
  const found = presets.find((preset) => preset.id === id);
  if (found !== undefined) {
    return found;
  }
  const fallback = presets[0];
  if (fallback === undefined) {
    throw new Error('No rewrite preset available');
  }
  return fallback;
}
