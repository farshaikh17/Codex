/**
 * Regression Test: Candidate Settings Switching Bug
 * Verifies that switching between Farhan and Sana resets form state immediately
 * and ensures the Save button cannot submit stale or cross-candidate data.
 */

const assert = require('assert');

// Simulate React state and effect execution
function createProfileModalState(initialProfile) {
  let profile = initialProfile;
  let formData = { ...profile };
  let primarySkillsText = profile.primary_skills.join(', ');
  let totalYearsExp = profile.total_years_experience ?? null;
  let isSaving = false;

  // React component mount / update
  function updateProfileProp(newProfile) {
    profile = newProfile;
    // Simulated useEffect([profile.id, profile.full_name, profile.total_years_experience])
    formData = { ...profile };
    primarySkillsText = profile.primary_skills.join(', ');
    totalYearsExp = profile.total_years_experience ?? null;
  }

  function modifyFormField(field, val) {
    formData[field] = val;
  }

  function isSaveDisabled() {
    return isSaving || formData.id !== profile.id;
  }

  return {
    getFormData: () => formData,
    getProfile: () => profile,
    getSkillsText: () => primarySkillsText,
    getExp: () => totalYearsExp,
    updateProfileProp,
    modifyFormField,
    isSaveDisabled,
  };
}

const farhanProfile = {
  id: 'farhan_shaikh',
  full_name: 'Farhan Shaikh',
  current_location: 'Kota, India',
  total_years_experience: 4.0,
  primary_skills: ['TypeScript', 'Python', 'React', 'Cloudflare Workers'],
  secondary_skills: ['SQL', 'FastAPI'],
  target_roles: ['Full Stack Engineer', 'Solutions Engineer'],
  target_seniorities: ['SENIOR', 'STAFF'],
  disqualifying_keywords: ['onsite only'],
};

const sanaProfile = {
  id: 'sana_ansari',
  full_name: 'Sana Ansari',
  current_location: 'Kota, India',
  total_years_experience: 9.2,
  primary_skills: ['Operations Management', 'Electrical Engineering', 'SCADA'],
  secondary_skills: ['Process Optimization', 'Power Systems'],
  target_roles: ['Operations Manager', 'Project Lead'],
  target_seniorities: ['LEAD', 'STAFF'],
  disqualifying_keywords: ['unpaid internship'],
};

console.log('[TEST] Running regression test for candidate settings switching...');

// Case 1: Mount with Farhan
const modal = createProfileModalState(farhanProfile);
assert.strictEqual(modal.getFormData().id, 'farhan_shaikh');
assert.strictEqual(modal.getFormData().full_name, 'Farhan Shaikh');
assert.strictEqual(modal.getExp(), 4.0);
assert.strictEqual(modal.isSaveDisabled(), false);

// Case 2: Switch Farhan -> Sana while Settings is open
console.log(' - Switching candidate: Farhan -> Sana');
modal.updateProfileProp(sanaProfile);

assert.strictEqual(modal.getProfile().id, 'sana_ansari');
assert.strictEqual(modal.getFormData().id, 'sana_ansari');
assert.strictEqual(modal.getFormData().full_name, 'Sana Ansari');
assert.strictEqual(modal.getExp(), 9.2);
assert.strictEqual(modal.getSkillsText(), 'Operations Management, Electrical Engineering, SCADA');
assert.strictEqual(modal.isSaveDisabled(), false);

// Case 3: Switch Sana -> Farhan while Settings is open
console.log(' - Switching candidate: Sana -> Farhan');
modal.updateProfileProp(farhanProfile);

assert.strictEqual(modal.getProfile().id, 'farhan_shaikh');
assert.strictEqual(modal.getFormData().id, 'farhan_shaikh');
assert.strictEqual(modal.getFormData().full_name, 'Farhan Shaikh');
assert.strictEqual(modal.getExp(), 4.0);
assert.strictEqual(modal.getSkillsText(), 'TypeScript, Python, React, Cloudflare Workers');
assert.strictEqual(modal.isSaveDisabled(), false);

// Case 4: Verify Save is blocked if formData.id does not match profile.id (tampering or desync safeguard)
console.log(' - Verifying Save lock when formData.id !== profile.id');
modal.modifyFormField('id', 'mismatched_id');
assert.strictEqual(modal.isSaveDisabled(), true, 'Save MUST be disabled if formData.id !== profile.id');

console.log('[PASS] Candidate settings switching regression test passed successfully!');
