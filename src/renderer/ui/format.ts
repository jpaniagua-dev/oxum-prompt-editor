/**
 * Display formatting shared by the panels.
 *
 * Extracted the moment the notes list needed the same timestamp rendering as the history list:
 * two copies would have drifted the first time one of them gained a seconds field.
 */

/** Short local date and time, e.g. `19.08 14:22`. Falls back to the raw value if unparseable. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('fr-CH', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
