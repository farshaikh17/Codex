// A row written by the daily/watchlist discovery carries only a quick screen (matched skills, no seniority / years / coverage).
// The inspection panel must not show the full assessment's defaults for it ("no skills", "0% primary", "no explicit minimum").
export function isQuickScreen(b: { preliminary?: boolean; experience_assessment?: unknown; seniority_assessment?: unknown; skill_matches_detailed?: unknown[] } | null | undefined): boolean {
  return !!b && !!b.preliminary && !b.experience_assessment && !b.seniority_assessment && !(b.skill_matches_detailed && b.skill_matches_detailed.length > 0);
}
