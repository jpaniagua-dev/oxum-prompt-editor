/**
 * One distinct letter per action of the menu.
 *
 * Kept free of any DOM access so the assignment can be tested in plain Node.
 */

export interface AccessKeyCandidate {
  readonly id: string;
  readonly label: string;
  readonly accessKey?: string;
}

/**
 * Assigns a letter to each preset, in menu order, and returns them by preset id.
 *
 * Two passes, so a declared letter always wins over a derived one whatever the order: a custom
 * preset listed first must not take the `c` that "Corriger" declares, or the letter a user has
 * learnt would move the day they add a preset. A preset whose letter is missing or already taken
 * gets the first free letter of its label, accents stripped; one with none left gets no letter at
 * all rather than a meaningless one, and stays reachable with the arrows.
 */
export function assignAccessKeys(
  presets: readonly AccessKeyCandidate[],
): ReadonlyMap<string, string> {
  const assigned = new Map<string, string>();
  const taken = new Set<string>();

  for (const preset of presets) {
    const declared = preset.accessKey?.toLowerCase();
    if (declared !== undefined && /^[a-z0-9]$/.test(declared) && !taken.has(declared)) {
      assigned.set(preset.id, declared);
      taken.add(declared);
    }
  }

  for (const preset of presets) {
    if (assigned.has(preset.id)) {
      continue;
    }
    const letters = preset.label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const free = [...letters].find((letter) => !taken.has(letter));
    if (free !== undefined) {
      assigned.set(preset.id, free);
      taken.add(free);
    }
  }

  return assigned;
}
