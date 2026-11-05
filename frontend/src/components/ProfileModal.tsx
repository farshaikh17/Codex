import React, { useState, useEffect } from 'react';
import { CandidateProfile, ResumeImportResult } from '../types';
import { importResume } from '../api';
import { Sliders, Check, UserCheck, FileText, Sparkles, AlertCircle, ArrowDown } from 'lucide-react';

interface ProfileModalProps {
  profile: CandidateProfile;
  onUpdate: (profile: CandidateProfile) => Promise<void>;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ profile, onUpdate }) => {
  const [formData, setFormData] = useState<CandidateProfile>({ ...profile });
  const [primarySkillsText, setPrimarySkillsText] = useState(profile.primary_skills.join(', '));
  const [secondarySkillsText, setSecondarySkillsText] = useState(profile.secondary_skills.join(', '));
  const [targetRolesText, setTargetRolesText] = useState(profile.target_roles.join(', '));
  const [targetSenioritiesText, setTargetSenioritiesText] = useState((profile.target_seniorities || ['SENIOR', 'STAFF', 'LEAD']).join(', '));
  const [disqualifiersText, setDisqualifiersText] = useState(profile.disqualifying_keywords.join(', '));
  const [totalYearsExp, setTotalYearsExp] = useState<number | null>(profile.total_years_experience ?? null);

  // Synchronize internal state immediately whenever profile changes/loads
  useEffect(() => {
    setFormData({ ...profile });
    setPrimarySkillsText(profile.primary_skills.join(', '));
    setSecondarySkillsText(profile.secondary_skills.join(', '));
    setTargetRolesText(profile.target_roles.join(', '));
    setTargetSenioritiesText((profile.target_seniorities || ['SENIOR', 'STAFF', 'LEAD']).join(', '));
    setDisqualifiersText(profile.disqualifying_keywords.join(', '));
    setTotalYearsExp(profile.total_years_experience ?? null);
    setResumeText(profile.raw_resume_text || '');
  }, [profile.id, profile.full_name, profile.total_years_experience]);

  // Resume Import State
  const [showResumeImport, setShowResumeImport] = useState(false);
  const [resumeText, setResumeText] = useState(profile.raw_resume_text || '');
  const [isParsingResume, setIsParsingResume] = useState(false);
  const [resumeParseResult, setResumeParseResult] = useState<ResumeImportResult | null>(null);
  const [resumeError, setResumeError] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleParseResume = async () => {
    if (!resumeText.trim()) return;
    setIsParsingResume(true);
    setResumeError('');
    try {
      const result = await importResume(resumeText, false);
      setResumeParseResult(result);
    } catch {
      setResumeError('Could not parse resume text. Please ensure it contains relevant details.');
    } finally {
      setIsParsingResume(false);
    }
  };

  const handleApplyResume = () => {
    if (!resumeParseResult) return;
    const sug = resumeParseResult.suggested_profile;
    if (sug?.full_name) setFormData((prev) => ({ ...prev, full_name: sug.full_name! }));
    if (sug?.total_years_experience) setTotalYearsExp(sug.total_years_experience);
    if (sug?.primary_skills) setPrimarySkillsText(sug.primary_skills.join(', '));
    if (sug?.secondary_skills) setSecondarySkillsText(sug.secondary_skills.join(', '));
    if (sug?.target_roles) setTargetRolesText(sug.target_roles.join(', '));
    if (sug?.target_seniorities) setTargetSenioritiesText(sug.target_seniorities.join(', '));
    setResumeParseResult(null);
    setShowResumeImport(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError('');
    setIsSaving(true);
    setSavedSuccess(false);
    try {
      const updated: CandidateProfile = {
        ...formData,
        total_years_experience: Number(totalYearsExp),
        target_seniorities: targetSenioritiesText.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
        primary_skills: primarySkillsText.split(',').map((s) => s.trim()).filter(Boolean),
        secondary_skills: secondarySkillsText.split(',').map((s) => s.trim()).filter(Boolean),
        target_roles: targetRolesText.split(',').map((s) => s.trim()).filter(Boolean),
        disqualifying_keywords: disqualifiersText.split(',').map((s) => s.trim()).filter(Boolean),
        raw_resume_text: resumeText || null,
      };
      await onUpdate(updated);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch {
      setSaveError('Unable to save preferences. Please retry.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Resume Import Card */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">Candidate Resume / CV Quick Import</h3>
              <p className="text-xs text-slate-500">Paste your resume in plain text or markdown to auto-detect skills, seniority, and experience.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowResumeImport(!showResumeImport)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors"
          >
            {showResumeImport ? 'Hide Resume Importer' : 'Import from Resume'}
          </button>
        </div>

        {showResumeImport && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            <textarea
              aria-label="Paste resume text or markdown"
              rows={6}
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              placeholder="Paste full resume text or markdown here (e.g. including Work Experience, Skills, Education)..."
              className="w-full border border-slate-300 rounded-lg p-3 text-xs font-mono focus:ring-2 focus:ring-emerald-500 outline-none leading-relaxed"
            />

            {resumeError && (
              <div className="p-2 bg-rose-50 text-rose-700 text-xs rounded border border-rose-200 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{resumeError}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Deterministic local parser • No cloud uploads</span>
              <button
                type="button"
                onClick={handleParseResume}
                disabled={isParsingResume || !resumeText.trim()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isParsingResume ? 'Parsing...' : 'Analyze Resume'}</span>
              </button>
            </div>

            {/* Parse Preview Card */}
            {resumeParseResult && (
              <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-lg space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-900 flex items-center gap-1">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    Resume Analysis Results:
                  </span>
                  <button
                    type="button"
                    onClick={handleApplyResume}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs px-3 py-1 rounded shadow-sm flex items-center gap-1"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                    <span>Apply to Profile Fields</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                  <div className="bg-white p-2 rounded border border-emerald-100">
                    <span className="text-slate-400 block text-[10px]">CANDIDATE:</span>
                    <span className="font-bold text-slate-800">{resumeParseResult.parsed.full_name}</span>
                  </div>
                  <div className="bg-white p-2 rounded border border-emerald-100">
                    <span className="text-slate-400 block text-[10px]">EXPERIENCE:</span>
                    <span className="font-bold text-slate-800">{resumeParseResult.parsed.total_years_experience} Years</span>
                  </div>
                  <div className="bg-white p-2 rounded border border-emerald-100">
                    <span className="text-slate-400 block text-[10px]">SENIORITY:</span>
                    <span className="font-bold text-slate-800">{resumeParseResult.parsed.seniority}</span>
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 font-semibold block mb-1">Detected Technical Skills ({resumeParseResult.parsed.detected_skills.length}):</span>
                  <div className="flex flex-wrap gap-1">
                    {resumeParseResult.parsed.detected_skills.map((s) => (
                      <span key={s} className="bg-white px-2 py-0.5 rounded text-[11px] font-mono border border-emerald-200 text-emerald-800 font-medium">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Profile Form */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sliders className="w-5 h-5 text-emerald-600" />
              Candidate Profile & Relevance Preferences
            </h2>
            <p className="text-xs text-slate-500">
              Changes made here are persisted in Cloudflare D1 and scoped strictly to this candidate.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
            <UserCheck className="w-3.5 h-3.5" />
            <span>Local User: {profile.id}</span>
          </div>
        </div>

        <p className="text-xs text-slate-500 mb-4">Basis: {profile.profile_basis}. Relevance is a keyword aid, not verified skill or pay qualification.</p>
        {saveError && <p role="alert" className="text-xs text-rose-700 mb-2">{saveError}</p>}
        
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="profile-0" className="font-semibold text-slate-700 block mb-1">Full Name:</label>
              <input id="profile-0"
                type="text"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Education & Technical Background:</label>
              <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-slate-700 font-medium">
                <span>{formData.education || (profile.id === "sana_ansari" ? "B.Tech in Electrical Engineering" : "Relevant Technical Degree")}</span>
                <span className="ml-2 text-[11px] text-slate-400 font-normal">(Authoritative profile)</span>
              </div>
            </div>

            <div>
              <label htmlFor="profile-1" className="font-semibold text-slate-700 block mb-1">Current Residence / Legal Base:</label>
              <input id="profile-1"
                type="text"
                value={formData.current_location}
                onChange={(e) => setFormData({ ...formData, current_location: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            <div>
              <label htmlFor="profile-2" className="font-semibold text-slate-700 block mb-1">Citizenship:</label>
              <input id="profile-2"
                type="text"
                value={formData.citizenship}
                onChange={(e) => setFormData({ ...formData, citizenship: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Work Authorization / Legal Status:</label>
              <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-slate-700">
                <span>{(profile.work_authorization || ['India Citizen']).join(', ')}</span>
                <span className="ml-2 text-[11px] text-slate-400 font-normal">(Authoritative brief: strictly India Citizen)</span>
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Relocation & Geographic Mobility:</label>
              <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-slate-700">
                <span>{profile.id === 'sana_ansari' ? 'Confirmed Preference: Middle East & Europe (Mobility interest only; work authorization unconfirmed / visa required)' : '100% Remote from India'}</span>
              </div>
            </div>

            <div>
              <label htmlFor="profile-3" className="font-semibold text-slate-700 block mb-1">Primary Timezone:</label>
              <input id="profile-3"
                type="text"
                value={formData.primary_timezone}
                onChange={(e) => setFormData({ ...formData, primary_timezone: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>

          {/* Experience & Seniority Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div>
              <label htmlFor="profile-exp" className="font-semibold text-slate-700 block mb-1">Total Professional Experience (Years):</label>
              <input id="profile-exp"
                type="number"
                step="0.5"
                min="0"
                max="40"
                value={totalYearsExp ?? ''}
                onChange={(e) => setTotalYearsExp(parseFloat(e.target.value) || 0)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <p className="mt-1 text-slate-400 text-[11px]">
                {profile.id === 'sana_ansari'
                  ? 'Continuous RRVUNL employment since September 2017 (~9.2 years) & Kota operations role since February 2025.'
                  : 'Used for deterministic comparison against minimum required years.'}
              </p>
            </div>

            <div>
              <label htmlFor="profile-sen" className="font-semibold text-slate-700 block mb-1">Target Seniority Levels (comma-separated):</label>
              <input id="profile-sen"
                type="text"
                value={targetSenioritiesText}
                onChange={(e) => setTargetSenioritiesText(e.target.value)}
                placeholder="SENIOR, STAFF, LEAD, DIRECTOR"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <p className="mt-1 text-slate-400 text-[11px]">e.g. SENIOR, STAFF, LEAD</p>
            </div>
          </div>

          <div>
            <label htmlFor="profile-4" className="font-semibold text-slate-700 block mb-1">Target Job Roles (comma-separated):</label>
            <input id="profile-4"
              type="text"
              value={targetRolesText}
              onChange={(e) => setTargetRolesText(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div>
            <label htmlFor="profile-5" className="font-semibold text-slate-700 block mb-1">Primary Technical Skills (weighted 45% in matching):</label>
            <input id="profile-5"
              type="text"
              value={primarySkillsText}
              onChange={(e) => setPrimarySkillsText(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div>
            <label htmlFor="profile-6" className="font-semibold text-slate-700 block mb-1">Secondary Technical Skills (weighted 20% in matching):</label>
            <input id="profile-6"
              type="text"
              value={secondarySkillsText}
              onChange={(e) => setSecondarySkillsText(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div>
            <label htmlFor="profile-7" className="font-semibold text-slate-700 block mb-1">Disqualifying Review Keywords (Caps Match at 10%):</label>
            <input id="profile-7"
              type="text"
              value={disqualifiersText}
              onChange={(e) => setDisqualifiersText(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="min-pay-inr" className="font-semibold text-slate-700 block mb-1">Minimum Fixed Monthly Pay (INR ₹):</label>
              <input id="min-pay-inr" type="number" min="0" value={formData.min_fixed_monthly_inr ?? ''}
                onChange={(e) => setFormData({...formData, min_fixed_monthly_inr: e.target.value ? Number(e.target.value) : null})}
                placeholder="e.g. 120000"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none" />
              <p className="mt-1 text-slate-400 text-[11px]">{profile.id === 'sana_ansari' ? (profile.min_fixed_monthly_inr ? `Hard monthly floor: ₹${profile.min_fixed_monthly_inr.toLocaleString('en-IN')}` : 'Verified monthly floor: Unknown (Not specified in brief)') : 'Hard monthly floor: ₹1,20,000'}</p>
            </div>

            <div>
              <label htmlFor="min-pay-usd" className="font-semibold text-slate-700 block mb-1">Contractor Floor ($/hr USD):</label>
              <input id="min-pay-usd" type="number" min="0" value={formData.min_acceptable_salary_usd ?? ''}
                onChange={(e) => setFormData({...formData, min_acceptable_salary_usd: e.target.value ? Number(e.target.value) : null})}
                placeholder="e.g. 25"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none" />
              <p className="mt-1 text-slate-400 text-[11px]">{profile.id === 'sana_ansari' ? (profile.min_acceptable_salary_usd ? `Hourly contractor rate: ${profile.min_acceptable_salary_usd}/hr` : 'Verified contractor rate: Unknown (Not specified in brief)') : 'Hourly contractor rate: $25/hr'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pref-inr" className="font-semibold text-slate-700 block mb-1">Preferred Annual Target (INR):</label>
              <input id="pref-inr" type="text" value={formData.preferred_inr_range ?? (profile.id === 'sana_ansari' ? '' : '₹25–30 LPA+')}
                placeholder={profile.id === 'sana_ansari' ? 'Unknown (Not specified in brief)' : '₹25–30 LPA+'}
                onChange={(e) => setFormData({...formData, preferred_inr_range: e.target.value})}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>

            <div>
              <label htmlFor="notice-period" className="font-semibold text-slate-700 block mb-1">Notice Period (Days):</label>
              <input id="notice-period" type="number" min="0" max="90" value={formData.notice_period_days ?? (profile.id === 'sana_ansari' ? '' : 30)}
                placeholder={profile.id === 'sana_ansari' ? 'Unknown' : '30'}
                onChange={(e) => setFormData({...formData, notice_period_days: e.target.value ? Number(e.target.value) : null})}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            {savedSuccess ? (
              <span className="text-emerald-600 font-semibold flex items-center gap-1">
                <Check className="w-4 h-4" />
                Profile updated & jobs re-scored!
              </span>
            ) : <span />}

            <button
              type="submit"
              disabled={isSaving || formData.id !== profile.id}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-5 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save & Re-score Jobs'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
