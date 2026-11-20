// The two built-in people expressed as profile configs (dashboard/docs/MULTI_CANDIDATE.md section 5). Packs and parameters only: no personal
// data (skills, target roles, years and the threshold still come from the candidate row). test/profiles_equivalence.test.mjs checks that
// evaluateWithProfile() with these reproduces evaluate() exactly, and scripts/quality/equivalence.mjs does the same on a hand-judged set.
// They are used for scoring only when a person's stored config says {"extends": "legacy:<id>", "engine": "profile"}: production is unchanged
// until that row is written.
import type { ProfileConfig } from './schema.ts';

export const LEGACY_CONFIGS: Record<string, ProfileConfig> = {
  'legacy:farhan_shaikh': {
    schema: 1, engine: 'legacy',
    field: { packs: ['revops_automation'] },
    // director / principal / VP / head-of titles stay below the Worth-a-try floor (FARHAN_FAR_ABOVE); executive titles below the threshold
    level: { max: 'manager' },
    place: [{ policy: 'remote_from_country', country: 'IN', remote_only: true, worldwide_ok: true, apac_ok: true, legacy_skip: true, skip_employers: [],
      global_hirer_bonus: true, timezone_penalty: true, foreign_penalty: true, unconfirmed_penalty: true, place_words: [] }],
    employment_types: ['FULL_TIME', 'CONTRACT'],
    type: { no_va_placements: true },
    language: { spoken: ['English'] },
    salary: { default_floor_inr_monthly: 120000, preferred_inr_monthly: 2500000 / 12 },
    thresholds: { default: 70 },
    shortlist: { band_minimums: { READY: { remote_global: 3 } }, stretch_needs_home_place: true },
  },
  'legacy:sana_ansari': {
    schema: 1, engine: 'legacy',
    field: { packs: ['plant_maintenance'] },
    level: { max: 'director' },
    place: [{ policy: 'onsite_in', countries: ['IN'], place_words: [] }, { policy: 'abroad_with_visa', gulf_relocation_counts: true, uk_sponsor_route: true, cap_unworkable: true }],
    employment_types: ['FULL_TIME', 'CONTRACT'],
    language: { spoken: ['English'] },
    thresholds: { default: 60 },
    shortlist: { band_minimums: { READY: { remote: 2 }, STRETCH_READY: { gulf: 5, remote: 2 } } },
  },
};
/** The ids whose old evaluate() has its own branch: they move to the packs only with an explicit engine "profile". */
export const LEGACY_IDS = new Set(['farhan_shaikh', 'sana_ansari']);
