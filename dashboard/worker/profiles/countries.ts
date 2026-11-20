// Home countries a profile's place policies can name (dashboard/docs/MULTI_CANDIDATE.md section 4.2). India keeps the Worker's own
// readings (Indian places, plant towns, Indiana) in place.ts; every other country is read from these names, its ISO code at the end of a
// place ('Leeds, GB') and the config's own place_words. Plain names only.
export const COUNTRY_NAMES: Record<string, { name: string; words: string[] }> = {
  IN: { name: 'India', words: ['india', 'bharat'] },
  GB: { name: 'the United Kingdom', words: ['united kingdom', 'uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland', 'london', 'manchester', 'birmingham', 'leeds', 'glasgow', 'edinburgh', 'bristol', 'liverpool', 'cardiff', 'belfast', 'sheffield', 'nottingham', 'newcastle'] },
  IE: { name: 'Ireland', words: ['ireland', 'dublin', 'cork', 'galway', 'limerick'] },
  US: { name: 'the United States', words: ['united states', 'usa', 'u.s.', 'u.s.a.', 'new york', 'san francisco', 'seattle', 'austin', 'boston', 'chicago', 'texas', 'california'] },
  CA: { name: 'Canada', words: ['canada', 'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa', 'ontario', 'quebec', 'british columbia', 'alberta'] },
  DE: { name: 'Germany', words: ['germany', 'deutschland', 'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'cologne', 'köln', 'stuttgart', 'düsseldorf'] },
  NL: { name: 'the Netherlands', words: ['netherlands', 'nederland', 'holland', 'amsterdam', 'rotterdam', 'utrecht', 'the hague', 'eindhoven'] },
  FR: { name: 'France', words: ['france', 'paris', 'lyon', 'marseille', 'toulouse', 'lille'] },
  ES: { name: 'Spain', words: ['spain', 'españa', 'madrid', 'barcelona', 'valencia', 'seville'] },
  PT: { name: 'Portugal', words: ['portugal', 'lisbon', 'lisboa', 'porto'] },
  PL: { name: 'Poland', words: ['poland', 'polska', 'warsaw', 'krakow', 'kraków', 'wroclaw', 'gdansk'] },
  SE: { name: 'Sweden', words: ['sweden', 'stockholm', 'gothenburg', 'malmo'] },
  AE: { name: 'the United Arab Emirates', words: ['united arab emirates', 'uae', 'dubai', 'abu dhabi', 'sharjah'] },
  SA: { name: 'Saudi Arabia', words: ['saudi arabia', 'ksa', 'riyadh', 'jeddah', 'dammam'] },
  QA: { name: 'Qatar', words: ['qatar', 'doha'] },
  SG: { name: 'Singapore', words: ['singapore'] },
  AU: { name: 'Australia', words: ['australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide'] },
};
/** The EU and EEA codes: a posting that says "EU only" is open to someone living in one of them. */
export const EU_CODES = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO']);
export const GULF_CODES = new Set(['AE', 'SA', 'QA', 'OM', 'KW', 'BH']);
export const countryName = (code: string) => COUNTRY_NAMES[code]?.name || code;
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A whole-word, case-insensitive regex for a list of plain place names (null when empty). */
export function placeRegex(words: string[]): RegExp | null {
  const parts = words.map((w) => String(w || '').trim().toLowerCase()).filter((w) => w.length >= 2).map((w) => esc(w).replace(/\s+/g, '\\s+'));
  return parts.length ? new RegExp(`(?:^|[^a-z0-9])(?:${parts.join('|')})(?![a-z0-9])`, 'i') : null;
}
