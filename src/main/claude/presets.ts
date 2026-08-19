import type { RewritePreset } from '@shared/contracts.js';

/**
 * Preamble shared by every preset, whatever it produces.
 *
 * The "do not invent" clause is not decoration. A trial run of the CLI on a vague prompt
 * spontaneously appended a list of requirements that appeared nowhere in the input, which
 * would hand the coding agent instructions the author never wrote. Rewriting must be a
 * pure reformulation: unknowns are surfaced or left alone, never filled in with guesses.
 */
const CORE_RULES = `You transform a raw text draft. You never author content of your own.

Absolute rules:
- Preserve every instruction, constraint, name, path, identifier and code snippet from the input, verbatim where it matters.
- Never invent requirements, acceptance criteria, technologies, file names or context that are not in the input.
- Never answer, solve or comment on the request. You only transform it.
- Keep the input's language unless the preset says otherwise.
- Leave fenced code blocks, inline code and file paths byte-identical.
- Output ONLY the transformed text. No preamble, no explanation, no wrapping code fence.`;

/**
 * Addendum for the presets whose output is handed to a coding agent.
 *
 * This family used to collect whatever the draft left ambiguous under a final "## À préciser"
 * section. It was dropped because the section showed up on every run, including on drafts that
 * were not ambiguous at all, and the author then had to delete it before using the prompt.
 *
 * The interdiction that replaced it is not decorative. Simply *removing* the instruction leaves
 * the model free to editorialise, and it does: it appends a "Note: the following points remain
 * unclear" of its own accord. Saying nothing is a behaviour that has to be asked for explicitly.
 */
const AGENT_PROMPT_RULES = `The result is a prompt for a coding agent, written in Markdown.
- Use headings, bullets and code fences wherever they carry structure.
- Never append a section of questions, remarks, notes, caveats or open points, under any heading. A gap in the input stays a gap in the output: leave it exactly as the author wrote it and say nothing about it.`;

/**
 * Shared by the two presets that deliberately change the register.
 *
 * Register is a matter of style. "tu" versus "vous" is a fact about the relationship between the
 * author and the reader, which the draft alone does not reveal: asked for a formal tone, a model
 * switches a French text to "vous" unless told not to, and that silently changes who the author
 * appears to be addressing. Same reasoning for greetings and sign-offs.
 */
const REGISTER_RULES = `Never change how the reader is addressed: keep "tu" as "tu" and "vous" as "vous", along with the agreement and possessives that follow. Never add or remove a greeting or a sign-off. Never append a section of any kind.`;

/** Presets shipped with the app. Deliberately generic and free of any employer context. */
export const BUILT_IN_PRESETS: readonly RewritePreset[] = [
  {
    id: 'structure',
    label: 'Structurer',
    hint: 'Contexte / Objectif / Contraintes, sans rien ajouter',
    kind: 'agent-prompt',
    systemPrompt: `${CORE_RULES}

${AGENT_PROMPT_RULES}

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
    kind: 'agent-prompt',
    systemPrompt: `${CORE_RULES}

${AGENT_PROMPT_RULES}

Preset: TRANSLATE TO ENGLISH.
Translate the draft into idiomatic technical English. Keep the existing structure,
headings and bullet order. Do not restructure and do not expand. Leave identifiers,
code, paths and product names untranslated.`,
  },
  {
    id: 'condense',
    label: 'Condenser',
    hint: 'Même intention, moins de tokens',
    kind: 'agent-prompt',
    systemPrompt: `${CORE_RULES}

${AGENT_PROMPT_RULES}

Preset: CONDENSE.
Express the same request in significantly fewer words. Drop pleasantries, hedging and
redundancy. Keep every technical detail, every constraint and every code block. Prefer
bullets over prose. Losing a requirement is a failure; losing a polite phrase is a win.`,
  },
  {
    id: 'spec',
    label: 'Ticket',
    hint: 'Titre + description + critères d’acceptation',
    kind: 'agent-prompt',
    systemPrompt: `${CORE_RULES}

${AGENT_PROMPT_RULES}

Preset: TICKET.
Reshape the draft into a development ticket: a one-line title on the first line as an H1,
then "## Description", then "## Critères d'acceptation" as a checklist. Derive the
acceptance criteria strictly from what the input already states or plainly implies. If the
input does not support any criterion, leave the checklist out entirely and say nothing about
why.`,
  },
  {
    id: 'fix',
    label: 'Corriger',
    hint: 'Orthographe, grammaire, typographie. Rien d’autre ne bouge.',
    kind: 'text',
    // The most conservative preset in the app, and the system prompt has to say so explicitly:
    // asked to "improve" a text, a model rephrases by default, and a rephrased draft is no
    // longer the author's. Here the diff must be limited to actual mistakes.
    systemPrompt: `${CORE_RULES}

Preset: PROOFREAD.
Fix spelling, grammar, agreement, conjugation, punctuation and typography. In French, that
includes the typographic apostrophe and the non-breaking space before ":", ";", "!" and "?".
Do NOT rephrase, reorder, restructure, summarise, expand, add or remove a sentence. Keep every
line break, blank line and indentation exactly as they are. Leave code blocks, inline code,
file paths, identifiers and URLs byte-identical, including any mistake inside them. If nothing
needs correcting, return the input unchanged. Never append a section of any kind.`,
  },
  {
    id: 'formal',
    label: 'Formel',
    hint: 'Registre soutenu, sans raideur',
    kind: 'text',
    systemPrompt: `${CORE_RULES}

Preset: FORMAL REGISTER.
Raise the register of the draft while keeping it the same text. Prefer precise vocabulary over
vague or familiar wording, write complete sentences, drop elisions, abbreviations, slang and
filler interjections. Keep it the same length or shorter: formality is precision, not padding,
so do not add courtesy formulas, administrative phrasing or throat-clearing that the input does
not already contain. Stay readable rather than pompous.
${REGISTER_RULES}`,
  },
  {
    id: 'chat',
    label: 'Chat',
    hint: 'Message court et décontracté pour un chat d’équipe',
    kind: 'text',
    // Chat clients apply their Markdown shortcuts as you *type*, not on paste. A pasted
    // "**important**" therefore shows its asterisks, so the output has to read correctly with
    // no rendering at all.
    systemPrompt: `${CORE_RULES}

Preset: CHAT MESSAGE.
Turn the draft into a short message a colleague can read in a team chat client. The message is
pasted as plain text and will NOT be rendered, so it must read well unformatted: no headings,
no tables, no bold or italic markers, no horizontal rules. Use short paragraphs and "- " bullets
for enumerations. Inline code backticks may be dropped since nothing renders them, but the
identifier they wrapped is kept character for character. Keep fenced code blocks whole: a reader
needs them to stay recognisable as code, and they carry information the message cannot lose.
The register is deliberately informal: spoken rhythm, contractions, short sentences, no corporate
or administrative phrasing, no hedging, no throat-clearing. Keep every technical fact and every
question the draft contains.
${REGISTER_RULES}`,
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
