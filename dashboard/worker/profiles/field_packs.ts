// FIELD packs (dashboard/docs/MULTI_CANDIDATE.md section 4.1): what counts as the person's field. Two packs carry the hand-tuned rules of the
// built-in people's fields (any person may choose them); `keyword` builds a field from the profile's own plain phrases and the role family
// catalogue, for a field nobody has written rules for.
import {
  FARHAN_ROLE, SANA_ROLE, avoidedTitle, farhanTargetFit, targetFit, DUTY_PHRASES, farhanOffField, sanaOffField, sanaTradeTitle, targetSkills,
  sanaTitleSkills, TARGET_SKILL_MAX, DUTY_NONE_TEXT, RULE_PARTS, farhanEngineeringField, farhanBelowLevel, farhanStretchOnly, sanaOtherProfession, sanaStretchOnly,
  sanaRoleTitle, sanaPowerFieldService, sanaCommissioningSkills,
} from '../discovery.ts';
import type { Signals } from './signals.ts';
import type { Profile } from './resolve.ts';
import { phraseRe, familyTitles, familyDuties, familyEntries } from './families.ts';

export type FieldPack = {
  key: string;
  role(title: string, prof: Profile, s?: Signals): boolean;
  avoided(s: Signals, prof: Profile): boolean;
  fit(title: string, prof: Profile): 'exact' | 'word' | null;
  /** skills beyond the profile's own list that the posting names (appended after them) */
  extraSkills(s: Signals, prof: Profile, have: string[], role: boolean): string[];
  duties(description: string, prof: Profile): number | null;
  offField(s: Signals): string | null;
  /** trade or operator titles below an experienced person (only at 5+ years) */
  belowLevelTitle(title: string): boolean;
  /** jobs QA 7: another profession read from the text (capped like an avoid-list title; two reason slots, as evaluate() writes them) */
  engField(s: Signals): string | null;
  otherProfession(s: Signals): string | null;
  /** jobs QA 7: a post below the person's level read from the text (capped at 40) */
  belowLevelPost(s: Signals, need: number): string | null;
  supervisorLow(s: Signals, have: number, need: number): boolean;
  /** jobs QA 7: a stretch (a confirmed row is capped just below the threshold) */
  stretchOnly(s: Signals, have: number): string | null;
  ycBonus: boolean;
  /** plant_maintenance: core-plant bonus, electrical-only and design-only penalties */
  plant: boolean;
  families(prof: Profile): [string, RegExp][];
};

const productReliability = (s: Signals) => /reliability/i.test(s.p.title || '') && !/\b(plant|maintenance|equipment|asset|rotating|pump|compressor|turbine|boiler)\b/i.test(s.desc)
  && /\b(hardware|product|silicon|semiconductor|software|linux|kubernetes|cloud|devops|trading|low[- ]latency|production systems|infrastructure|battery|batteries|vehicles?|automotive|dfmea|pcb|electronics)\b/i.test(s.desc);
const count = (res: RegExp[], d: string) => res.filter((re) => re.test(d)).length;

export const FIELD_PACKS: Record<string, FieldPack> = {
  revops_automation: {
    key: 'revops_automation',
    role: (title) => FARHAN_ROLE.test(title || ''),
    avoided: (s) => avoidedTitle('farhan_shaikh', s.p.title),
    fit: (title, prof) => farhanTargetFit(title || '', prof.targets),
    extraSkills: () => [],
    duties: (d) => count(DUTY_PHRASES.farhan_shaikh, String(d || '')),
    offField: (s) => farhanOffField(s.p.title, s.p.description),
    belowLevelTitle: () => false,
    engField: (s) => farhanEngineeringField(s.p.title, s.p.description), otherProfession: () => null,
    belowLevelPost: (s, need) => farhanBelowLevel(s.p.title, s.p.description, need), supervisorLow: () => false,
    stretchOnly: (s) => farhanStretchOnly(s.p.title, s.p.description),
    ycBonus: true, plant: false,
    families: () => RULE_PARTS.FAMILIES.farhan_shaikh,
  },
  plant_maintenance: {
    key: 'plant_maintenance',
    // jobs QA 8: the plant-discipline branch minus sales / design / procurement titles, or a power-equipment field service engineer
    role: (title, _prof, s) => sanaRoleTitle(title) || (!!s && sanaPowerFieldService(title, s.p.company, s.p.description)),
    avoided: (s) => avoidedTitle('sana_ansari', s.p.title) || productReliability(s),
    fit: (title, prof) => targetFit(title || '', prof.targets),
    extraSkills: (s, prof, have, role) => {
      const out = targetSkills(prof.targets, have, s.lower).slice(0, TARGET_SKILL_MAX);
      if (String(s.p.description || '').trim().length <= DUTY_NONE_TEXT) out.push(...sanaTitleSkills(s.p.title || '', [...have, ...out]).slice(0, TARGET_SKILL_MAX));
      if (role) out.push(...sanaCommissioningSkills(s.p.title, s.p.description, [...have, ...out]));   // jobs QA 8
      if (role && !sanaRoleTitle(s.p.title) && sanaPowerFieldService(s.p.title, s.p.company, s.p.description)) out.push('Power Equipment Field Service');
      return out;
    },
    duties: (d) => count(DUTY_PHRASES.sana_ansari, String(d || '')),
    offField: (s) => sanaOffField(s.p.title, s.p.description),
    belowLevelTitle: (title) => RULE_PARTS.SANA_BELOW_LEVEL.test(title || '') || sanaTradeTitle(title),
    engField: () => null, otherProfession: (s) => sanaOtherProfession(s.p.title, s.p.description),
    belowLevelPost: () => null,
    supervisorLow: (s, have, need) => have >= 7 && /\bsupervisors?\b/i.test(s.p.title || '') && !/\b(?:engineer|manager)\b/i.test(s.p.title || '') && need > 0 && need <= 4,
    stretchOnly: (s, have) => sanaStretchOnly(s.p.title, s.p.description, s.p.company, have),
    ycBonus: false, plant: true,
    families: () => RULE_PARTS.FAMILIES.sana_ansari,
  },
  keyword: {
    key: 'keyword',
    role: (title, prof) => {
      const f = prof.field, must = [...familyTitles(f.role_families), ...f.title.must];
      const re = phraseRe(must.length ? must : prof.targetList);
      return !!re && re.test(title || '');
    },
    avoided: (s, prof) => { const re = phraseRe([...prof.field.title.avoid, ...familyTitles(prof.field.excluded_families)]); return !!re && re.test(s.p.title || ''); },
    fit: (title, prof) => targetFit(title || '', [...prof.targetList, ...prof.field.title.should]),
    extraSkills: () => [],
    duties: (d, prof) => {
      const list = prof.field.duties.length ? prof.field.duties : familyDuties(prof.field.role_families);
      if (!list.length) return null;
      const text = String(d || '');
      return list.filter((w) => phraseRe([w])!.test(text)).length;
    },
    offField: () => null,
    belowLevelTitle: () => false,
    engField: () => null, otherProfession: () => null, belowLevelPost: () => null, supervisorLow: () => false, stretchOnly: () => null,
    ycBonus: false, plant: false,
    families: (prof) => familyEntries(prof.field.role_families),
  },
};
