/**
 * DST Transitions & America/New_York Boundary Test Suite
 * 
 * Asserts:
 * 1. Sunday-to-Saturday boundary calculation in America/New_York.
 * 2. Summer Daylight Saving Time (EDT, UTC-4).
 * 3. Winter Standard Time (EST, UTC-5).
 * 4. Fall DST transition week (November 1, 2026 - clocks fall back 2:00 AM EDT to 1:00 AM EST).
 * 5. Spring DST transition week (March 8, 2026 - clocks spring forward 2:00 AM EST to 3:00 AM EDT).
 * 6. Normalized UTC timestamps for database range queries.
 */

const assert = require('assert');

function getNyOffsetMs(d) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
    hour12: false
  }).formatToParts(d);
  const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-5';
  const m = tzPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return -5 * 3600000;
  const sign = m[1] === '+' ? 1 : -1;
  const hours = parseInt(m[2], 10);
  const mins = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + mins) * 60000;
}

function getNyWeekBounds(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);
  
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  
  const dayMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
  const dayOfWeek = dayMap[map.weekday] ?? 0;
  
  const nyYear = parseInt(map.year, 10);
  const nyMonth = parseInt(map.month, 10) - 1;
  const nyDay = parseInt(map.day, 10);
  
  const sunCalDate = new Date(Date.UTC(nyYear, nyMonth, nyDay - dayOfWeek));
  const sunY = sunCalDate.getUTCFullYear();
  const sunM = String(sunCalDate.getUTCMonth() + 1).padStart(2, '0');
  const sunD = String(sunCalDate.getUTCDate()).padStart(2, '0');
  const sundayStr = `${sunY}-${sunM}-${sunD}`;
  
  const satCalDate = new Date(Date.UTC(nyYear, nyMonth, nyDay - dayOfWeek + 6));
  const satY = satCalDate.getUTCFullYear();
  const satM = String(satCalDate.getUTCMonth() + 1).padStart(2, '0');
  const satD = String(satCalDate.getUTCDate()).padStart(2, '0');
  const saturdayStr = `${satY}-${satM}-${satD}`;
  
  // Exact UTC for Sunday 00:00:00 in America/New_York (converges across DST transitions)
  let sunUtc = Date.UTC(sunCalDate.getUTCFullYear(), sunCalDate.getUTCMonth(), sunCalDate.getUTCDate(), 5, 0, 0);
  let sunOff = getNyOffsetMs(new Date(sunUtc));
  sunUtc = Date.UTC(sunCalDate.getUTCFullYear(), sunCalDate.getUTCMonth(), sunCalDate.getUTCDate(), 0, 0, 0) - sunOff;
  sunOff = getNyOffsetMs(new Date(sunUtc));
  sunUtc = Date.UTC(sunCalDate.getUTCFullYear(), sunCalDate.getUTCMonth(), sunCalDate.getUTCDate(), 0, 0, 0) - sunOff;

  // Exact UTC for Saturday 23:59:59.999 in America/New_York (converges across DST transitions)
  let satUtc = Date.UTC(satCalDate.getUTCFullYear(), satCalDate.getUTCMonth(), satCalDate.getUTCDate(), 23, 59, 59, 999) + 5 * 3600000;
  let satOff = getNyOffsetMs(new Date(satUtc));
  satUtc = Date.UTC(satCalDate.getUTCFullYear(), satCalDate.getUTCMonth(), satCalDate.getUTCDate(), 23, 59, 59, 999) - satOff;
  satOff = getNyOffsetMs(new Date(satUtc));
  satUtc = Date.UTC(satCalDate.getUTCFullYear(), satCalDate.getUTCMonth(), satCalDate.getUTCDate(), 23, 59, 59, 999) - satOff;

  const sunOffStr = (sunOff >= 0 ? '+' : '-') + String(Math.abs(Math.floor(sunOff / 3600000))).padStart(2, '0') + ':00';
  const satOffStr = (satOff >= 0 ? '+' : '-') + String(Math.abs(Math.floor(satOff / 3600000))).padStart(2, '0') + ':00';

  const tempDate = new Date(Date.UTC(sunCalDate.getUTCFullYear(), sunCalDate.getUTCMonth(), sunCalDate.getUTCDate()));
  const dayNr = (tempDate.getUTCDay() + 6) % 7;
  tempDate.setUTCDate(tempDate.getUTCDate() - dayNr + 3);
  const firstThursday = tempDate.getTime();
  tempDate.setUTCMonth(0, 1);
  if (tempDate.getUTCDay() !== 4) {
    tempDate.setUTCMonth(0, 1 + ((4 - tempDate.getUTCDay()) + 7) % 7);
  }
  const weekNum = 1 + Math.ceil((firstThursday - tempDate.getTime()) / 604800000);
  
  return {
    cohort_id: `cohort-${sunCalDate.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`,
    label: `Week ${weekNum}, ${sunCalDate.getUTCFullYear()}`,
    week_start_ny: sundayStr,
    week_end_ny: saturdayStr,
    week_start_iso: `${sundayStr}T00:00:00${sunOffStr}`,
    week_end_iso: `${saturdayStr}T23:59:59${satOffStr}`,
    week_start_utc: new Date(sunUtc).toISOString(),
    week_end_utc: new Date(satUtc).toISOString(),
    sunday_date: sundayStr,
    timezone: 'America/New_York',
    now_ny: `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`
  };
}

console.log('=== Running DST Transitions & NY Week Boundary Test Suite ===\n');

// Test 1: Summer DST (July 15, 2026 - EDT is UTC-4)
const summer = getNyWeekBounds(new Date('2026-07-15T12:00:00Z'));
console.log('1. Summer EDT (July 15, 2026):', summer);
assert.strictEqual(summer.week_start_ny, '2026-07-12');
assert.strictEqual(summer.week_end_ny, '2026-07-18');
assert.strictEqual(summer.week_start_iso, '2026-07-12T00:00:00-04:00');
assert.strictEqual(summer.week_end_iso, '2026-07-18T23:59:59-04:00');
assert.strictEqual(summer.week_start_utc, '2026-07-12T04:00:00.000Z');
assert.strictEqual(summer.week_end_utc, '2026-07-19T03:59:59.999Z');
console.log('   [PASS] Summer EDT offsets and UTC bounds verified (-04:00, 04:00Z to 03:59:59Z).');

// Test 2: Winter Standard Time (January 15, 2026 - EST is UTC-5)
const winter = getNyWeekBounds(new Date('2026-01-15T12:00:00Z'));
console.log('\n2. Winter EST (January 15, 2026):', winter);
assert.strictEqual(winter.week_start_ny, '2026-01-11');
assert.strictEqual(winter.week_end_ny, '2026-01-17');
assert.strictEqual(winter.week_start_iso, '2026-01-11T00:00:00-05:00');
assert.strictEqual(winter.week_end_iso, '2026-01-17T23:59:59-05:00');
assert.strictEqual(winter.week_start_utc, '2026-01-11T05:00:00.000Z');
assert.strictEqual(winter.week_end_utc, '2026-01-18T04:59:59.999Z');
console.log('   [PASS] Winter EST offsets and UTC bounds verified (-05:00, 05:00Z to 04:59:59Z).');

// Test 3: Fall DST Transition (November 1, 2026 - Sunday begins EDT UTC-4, falls back to EST UTC-5)
const fallTrans = getNyWeekBounds(new Date('2026-11-01T15:00:00Z'));
console.log('\n3. Fall DST Transition Week (Nov 1, 2026):', fallTrans);
assert.strictEqual(fallTrans.week_start_ny, '2026-11-01');
assert.strictEqual(fallTrans.week_end_ny, '2026-11-07');
assert.strictEqual(fallTrans.week_start_iso, '2026-11-01T00:00:00-04:00');
assert.strictEqual(fallTrans.week_end_iso, '2026-11-07T23:59:59-05:00');
assert.strictEqual(fallTrans.week_start_utc, '2026-11-01T04:00:00.000Z');
assert.strictEqual(fallTrans.week_end_utc, '2026-11-08T04:59:59.999Z');
console.log('   [PASS] Fall DST transition correctly handles Sunday at EDT (-04:00) and Saturday at EST (-05:00).');

// Test 4: Spring DST Transition (March 8, 2026 - Sunday begins EST UTC-5, springs forward to EDT UTC-4)
const springTrans = getNyWeekBounds(new Date('2026-03-08T15:00:00Z'));
console.log('\n4. Spring DST Transition Week (March 8, 2026):', springTrans);
assert.strictEqual(springTrans.week_start_ny, '2026-03-08');
assert.strictEqual(springTrans.week_end_ny, '2026-03-14');
assert.strictEqual(springTrans.week_start_iso, '2026-03-08T00:00:00-05:00');
assert.strictEqual(springTrans.week_end_iso, '2026-03-14T23:59:59-04:00');
assert.strictEqual(springTrans.week_start_utc, '2026-03-08T05:00:00.000Z');
assert.strictEqual(springTrans.week_end_utc, '2026-03-15T03:59:59.999Z');
console.log('   [PASS] Spring DST transition correctly handles Sunday at EST (-05:00) and Saturday at EDT (-04:00).');

console.log('\n>>> All DST transition and timezone assertions PASSED! <<<\n');
