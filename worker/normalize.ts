// Text normalization and fuzzy comparison for player names.

const SPECIAL: Record<string, string> = {
  ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', ł: 'l', đ: 'd', ð: 'd', ı: 'i', þ: 'th', ħ: 'h',
};

/** Lowercase, strip accents and punctuation, collapse spaces. "Mesut Özil" → "mesut ozil". */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[øßæœłđðıþħ]/g, (c) => SPECIAL[c] ?? c)
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Comparison key: normalized without spaces, so "van persie" = "vanpersie". */
export const compact = (s: string) => normalize(s).replace(/ /g, '');

const PARTICLES = new Set([
  'van', 'von', 'de', 'di', 'da', 'del', 'della', 'dos', 'das', 'do', 'le', 'la', 'ben', 'el', 'al', 'ter', 'ten', 'der', 'den', 'du', 'mac', 'st', 'dal', 'degli', 'y',
]);

/**
 * Surname-style keys derived from a full name: "Robin van Persie" → ["vanpersie", "persie"].
 * Mononyms ("Kaká") produce nothing: the full key already covers them.
 */
export function surnameKeys(fullName: string): string[] {
  const tokens = normalize(fullName.replace(/\(.*?\)/g, '')).split(' ').filter(Boolean);
  if (tokens.length < 2) return [];
  const out = new Set<string>();
  const last = tokens[tokens.length - 1];
  out.add(last);
  // Include preceding particles: "de bruyne", "van der sar", "di maria".
  let i = tokens.length - 2;
  let acc = last;
  while (i >= 1 && PARTICLES.has(tokens[i])) {
    acc = tokens[i] + acc;
    out.add(acc);
    i--;
  }
  // Compound surnames: last two tokens ("Alexander-Arnold", "Hernández Balcázar" style names).
  if (tokens.length >= 3) out.add(tokens[tokens.length - 2] + last);
  return [...out].filter((k) => k.length >= 3);
}

/** Levenshtein distance with transpositions, giving up early once above `max`. Returns max+1 if exceeded. */
export function boundedDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prevPrev = new Array<number>(lb + 1).fill(0);
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  let cur = new Array<number>(lb + 1).fill(0);
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === cb ? 0 : 1));
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) v = Math.min(v, prevPrev[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prevPrev, prev, cur] = [prev, cur, prevPrev];
  }
  return prev[lb];
}

/** Typos tolerated for a key of this length. */
export function tolerance(len: number, surname: boolean): number {
  if (surname) return len >= 10 ? 2 : len >= 5 ? 1 : 0; // surname typos must also keep the first letter
  if (len <= 4) return 0;
  if (len <= 8) return 1;
  return 2;
}
