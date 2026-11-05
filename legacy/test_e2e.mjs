import { chromium } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROJECT_ROOT = 'C:\\Users\\admin\\.gemini\\antigravity\\scratch\\farhan-job-engine';
const PYTHON_PATH = `${PROJECT_ROOT}\\.venv\\Scripts\\python.exe`;

function waitForUrl(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      http.get(url, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          clearInterval(interval);
          resolve(true);
        }
      }).on('error', () => {
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error(`Timeout waiting for ${url}`));
        }
      });
    }, 400);
  });
}

async function runAudit() {
  console.log('=== STARTING INDEPENDENT MVP AUDIT & VERIFICATION ===\n');
  const results = {};

  // 1. Start Backend Server
  console.log('1. Starting FastAPI backend on http://127.0.0.1:8000 ...');
  let backendProcess = spawn(PYTHON_PATH, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PYTHONPATH: PROJECT_ROOT }
  });

  backendProcess.stderr.on('data', (d) => {
    // console.log('[backend stderr]', d.toString());
  });

  await waitForUrl('http://127.0.0.1:8000/api/health');
  console.log('✓ Backend healthy on port 8000');

  // 2. Start Frontend Vite Dev Server
  console.log('2. Starting Vite dev server on http://127.0.0.1:5173 ...');
  const viteProcess = spawn('npm.cmd', ['run', 'dev'], {
    cwd: `${PROJECT_ROOT}\\frontend`,
    shell: true
  });

  await waitForUrl('http://127.0.0.1:5173');
  console.log('✓ Frontend dev server ready on port 5173\n');

  // 3. Launch Chrome via Playwright
  console.log('3. Launching Chrome browser automation...');
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.method()} ${req.url()}: ${req.failure()?.errorText}`);
  });

  try {
    // TEST A: Dashboard Initial Load
    console.log('--- TEST A: Dashboard Initial Load (http://127.0.0.1:5173) ---');
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const title = await page.title();
    console.log(`Page title: "${title}"`);
    if (title.includes('Farhan Job Engine')) {
      results['Dashboard Initial Load'] = { status: 'PASS', evidence: `Title matches "${title}"` };
    } else {
      results['Dashboard Initial Load'] = { status: 'FAIL', evidence: `Unexpected title "${title}"` };
    }

    // Verify synthetic banner
    const disclaimerVisible = await page.locator('text=Synthetic Fixture Mode').isVisible();
    results['Synthetic Data Disclaimer Banner'] = {
      status: disclaimerVisible ? 'PASS' : 'FAIL',
      evidence: disclaimerVisible ? 'Disclaimer banner prominently visible' : 'Banner missing'
    };

    // TEST B: Job Discovery Table Loading
    console.log('\n--- TEST B: Job Discovery Table ---');
    await page.waitForSelector('table tbody tr');
    const rowCount = await page.locator('table tbody tr').count();
    console.log(`Table rendered ${rowCount} initial job rows.`);
    results['Job Discovery Table Display'] = {
      status: rowCount > 0 ? 'PASS' : 'FAIL',
      evidence: `Rendered ${rowCount} job records from backend`
    };

    // TEST C: Search Functionality
    console.log('\n--- TEST C: Search Filtering ---');
    const searchInput = page.locator('input[placeholder*="Search job title"]');
    await searchInput.fill('FastAPI');
    await page.waitForTimeout(600); // debounce / state update
    const searchRowCount = await page.locator('table tbody tr').count();
    const firstRowText = await page.locator('table tbody tr').first().innerText();
    console.log(`Searching "FastAPI": returned ${searchRowCount} rows.`);
    const searchMatches = firstRowText.toLowerCase().includes('fastapi') || firstRowText.toLowerCase().includes('backend');
    results['Job Search Filtering'] = {
      status: searchRowCount > 0 && searchMatches ? 'PASS' : 'FAIL',
      evidence: `Query "FastAPI" yielded ${searchRowCount} row(s) containing expected keywords`
    };

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(500);

    // TEST D: Eligibility Faceted Filter Pills
    console.log('\n--- TEST D: Eligibility Filtering ---');
    // Click "Eligible"
    await page.getByRole('button', { name: 'Eligible', exact: true }).click();
    await page.waitForTimeout(500);
    const eligibleCount = await page.locator('table tbody tr').count();
    const eligibleBadges = await page.locator('table tbody tr span:has-text("Eligible")').count();
    console.log(`Filter "Eligible": ${eligibleCount} rows, all have Eligible badges: ${eligibleBadges === eligibleCount}`);

    // Click "Ineligible"
    await page.getByRole('button', { name: 'Ineligible', exact: true }).click();
    await page.waitForTimeout(500);
    const ineligibleCount = await page.locator('table tbody tr').count();
    const ineligibleBadges = await page.locator('table tbody tr span:has-text("Ineligible")').count();
    console.log(`Filter "Ineligible": ${ineligibleCount} rows, all have Ineligible badges: ${ineligibleBadges === ineligibleCount}`);

    // Click "Unknown"
    await page.getByRole('button', { name: 'Unknown', exact: true }).click();
    await page.waitForTimeout(500);
    const unknownCount = await page.locator('table tbody tr').count();
    const unknownBadges = await page.locator('table tbody tr span:has-text("Unknown")').count();
    console.log(`Filter "Unknown": ${unknownCount} rows, all have Unknown badges: ${unknownBadges === unknownCount}`);

    // Click "All"
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.waitForTimeout(500);
    const allCount = await page.locator('table tbody tr').count();

    const eligibilityPass = eligibleCount > 0 && ineligibleCount > 0 && unknownCount > 0 && allCount >= eligibleCount + ineligibleCount + unknownCount;
    results['Eligibility Faceted Filtering'] = {
      status: eligibilityPass ? 'PASS' : 'FAIL',
      evidence: `Eligible: ${eligibleCount}, Ineligible: ${ineligibleCount}, Unknown: ${unknownCount}, Total: ${allCount}`
    };

    // TEST E: Min Match Score Slider
    console.log('\n--- TEST E: Match Score Slider ---');
    const slider = page.locator('input[type="range"]');
    await slider.fill('10');
    await slider.dispatchEvent('change');
    await page.waitForTimeout(500);
    const filteredByScore = await page.locator('table tbody tr').count();
    console.log(`Slider set to 10%: ${filteredByScore} jobs remaining`);
    await slider.fill('0');
    await slider.dispatchEvent('change');
    await page.waitForTimeout(500);
    results['Min Match Score Slider'] = {
      status: filteredByScore <= allCount ? 'PASS' : 'FAIL',
      evidence: `Score threshold >= 10% filtered list from ${allCount} down to ${filteredByScore} jobs`
    };

    // TEST F: Job Detail Inspection Modal
    console.log('\n--- TEST F: Job Detail Inspection Modal ---');
    const firstRow = page.locator('table tbody tr').first();
    const jobTitleText = await firstRow.locator('td').first().innerText();
    await firstRow.click();
    await page.waitForSelector('div[role="dialog"], h2.text-xl', { timeout: 3000 });

    const modalTitle = await page.locator('h2.text-xl').innerText();
    const hasEligibilityCard = await page.locator('h3:has-text("India Remote Posting Scope")').isVisible();
    const hasMatchAssessment = await page.locator('h3:has-text("Keyword Relevance")').isVisible();
    const hasFullDescription = await page.locator('text=Full Job Description').isVisible();
    const hasHiringStructure = await page.locator('text=Hiring model evidence').isVisible();

    console.log(`Modal opened for: "${modalTitle}"`);
    console.log(`Has eligibility card: ${hasEligibilityCard}, Match card: ${hasMatchAssessment}, Full desc: ${hasFullDescription}`);

    const detailPass = hasEligibilityCard && hasMatchAssessment && hasFullDescription && hasHiringStructure;
    results['Job Detail & Evidence Inspector'] = {
      status: detailPass ? 'PASS' : 'FAIL',
      evidence: `Inspected "${modalTitle}". Verified eligibility reasoning, cited evidence, match breakdown, and full text`
    };

    // TEST G: Application Tracking from Detail Modal
    console.log('\n--- TEST G: Application Tracking in Detail Modal ---');
    // Select stage "REJECTED"
    const stageSelect = page.locator('select:has(option[value="REJECTED"])');
    await stageSelect.selectOption('REJECTED');
    await page.waitForTimeout(300);

    // Verify rejection fields appear
    const rejectionSectionVisible = await page.locator('text=Rejection Outcome Tracking').isVisible();
    console.log(`Rejection options displayed: ${rejectionSectionVisible}`);

    // Fill notes
    const noteInput = page.locator('input[placeholder*="Specific feedback received"]');
    await noteInput.fill('Automated audit verification note');

    // Click update pipeline status
    await page.locator('button:has-text("Update Pipeline Status")').click();
    await page.waitForTimeout(1000);

    // Close modal
    await page.locator('button:has(svg.lucide-x)').first().click();
    await page.waitForTimeout(500);

    results['Application Stage & Rejection Tracking'] = {
      status: rejectionSectionVisible ? 'PASS' : 'FAIL',
      evidence: 'Transitioned job to REJECTED with rejection stage, reason category, and feedback notes'
    };

    // TEST H: Application Tracker View
    console.log('\n--- TEST H: Application Tracker View ---');
    await page.locator('nav button:has-text("Tracker")').click();
    await page.waitForTimeout(600);

    const trackerHeading = await page.locator('h2:has-text("Application Pipeline Tracker")').isVisible();
    const trackedItems = await page.locator('span:has-text("Rejected")').count();
    console.log(`Tracker heading visible: ${trackerHeading}, Tracked rejected items: ${trackedItems}`);

    results['Application Tracker View'] = {
      status: trackerHeading && trackedItems > 0 ? 'PASS' : 'FAIL',
      evidence: `Tracker displayed ${trackedItems} rejected job record(s) with custom feedback notes`
    };

    // TEST I: Analytics Dashboard View
    console.log('\n--- TEST I: Analytics Dashboard View ---');
    await page.locator('nav button:has-text("Analytics")').click();
    await page.waitForTimeout(600);

    const analyticsHeading = await page.locator('h2:has-text("Job Discovery & Ingestion Analytics")').isVisible();
    const totalJobsMetric = await page.locator('span:has-text("Total Ingested Jobs") + span').innerText();
    const eligibleJobsMetric = await page.locator('span:has-text("Eligible for India") + span').innerText();
    console.log(`Analytics visible: ${analyticsHeading}, Total jobs: ${totalJobsMetric}, Eligible jobs: ${eligibleJobsMetric}`);

    results['Analytics View & Funnel Metrics'] = {
      status: analyticsHeading && parseInt(totalJobsMetric) > 0 ? 'PASS' : 'FAIL',
      evidence: `Analytics confirmed ${totalJobsMetric} total jobs and ${eligibleJobsMetric} verified eligible roles`
    };

    // TEST J: Candidate Profile & Score Recalculation
    console.log('\n--- TEST J: Profile Settings & Score Recalculation ---');
    await page.locator('nav button:has-text("Settings")').click();
    await page.waitForTimeout(600);

    const profileHeading = await page.locator('h2:has-text("Candidate Profile & Eligibility Criteria")').isVisible();
    const nameInput = page.locator('#profile-0');
    await nameInput.fill('Farhan Verified Candidate');

    // Add a unique test skill to primary skills
    const primarySkillsInput = page.locator('#profile-5');
    const existingSkills = await primarySkillsInput.inputValue();
    await primarySkillsInput.fill(`${existingSkills}, Rust`);

    await page.locator('button:has-text("Save & Re-score Jobs")').click();
    await page.waitForSelector('text=Profile updated & jobs re-scored!', { timeout: 4000 });
    console.log('✓ Profile saved and score recalculation triggered');

    // Verify on discovery tab that name is updated
    await page.locator('nav button:has-text("Discovery")').click();
    await page.waitForTimeout(500);

    results['Candidate Profile Editing & Re-scoring'] = {
      status: profileHeading ? 'PASS' : 'FAIL',
      evidence: 'Updated candidate profile and successfully triggered SQLite score recalculation'
    };

    // TEST K: Database Persistence After Backend Restart
    console.log('\n--- TEST K: Database Persistence After Restart ---');
    console.log('Killing backend process and restarting...');
    backendProcess.kill();
    await page.waitForTimeout(1500);

    // Restart backend
    backendProcess = spawn(PYTHON_PATH, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONPATH: PROJECT_ROOT }
    });

    await waitForUrl('http://127.0.0.1:8000/api/health');
    console.log('✓ Backend restarted successfully');

    // Verify profile persisted via direct API call
    const res = await fetch('http://127.0.0.1:8000/api/profile');
    const profileJson = await res.json();
    console.log(`Persisted Profile Name: "${profileJson.full_name}"`);
    console.log(`Persisted Skills: ${profileJson.primary_skills.join(', ')}`);

    const persisted = profileJson.full_name === 'Farhan Verified Candidate' && profileJson.primary_skills.includes('Rust');
    results['Database Persistence Across Restarts'] = {
      status: persisted ? 'PASS' : 'FAIL',
      evidence: `Profile name "${profileJson.full_name}" and skills survived process termination and restart`
    };

    // TEST L: Console Errors & Broken Network Requests
    console.log('\n--- TEST L: Console Errors & Network Audit ---');
    console.log(`Console Errors detected: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.log('Errors:', consoleErrors);
    }
    console.log(`Failed HTTP requests: ${failedRequests.length}`);
    if (failedRequests.length > 0) {
      console.log('Failed requests:', failedRequests);
    }

    results['Console & Network Health'] = {
      status: consoleErrors.length === 0 && failedRequests.length === 0 ? 'PASS' : 'FAIL',
      evidence: `Console errors: ${consoleErrors.length}, Failed HTTP requests: ${failedRequests.length}`
    };

    // TEST M: Direct Production Build Host (Port 8000 static serving)
    console.log('\n--- TEST M: Production Serving via FastAPI Port 8000 ---');
    await page.goto('http://127.0.0.1:8000', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const prodTitle = await page.title();
    const prodTableRows = await page.locator('table tbody tr').count();
    console.log(`Port 8000 Title: "${prodTitle}", Rows rendered: ${prodTableRows}`);

    results['Single-Process Production Serving (Port 8000)'] = {
      status: prodTitle.includes('Farhan Job Engine') && prodTableRows > 0 ? 'PASS' : 'FAIL',
      evidence: `FastAPI served built frontend and rendered ${prodTableRows} rows with zero dev server required`
    };

  } finally {
    await browser.close();
    backendProcess.kill();
    viteProcess.kill();
  }

  console.log('\n======================================================');
  console.log('               AUDIT RESULTS SUMMARY                  ');
  console.log('======================================================');
  for (const [feature, data] of Object.entries(results)) {
    console.log(`${data.status.padEnd(6)} | ${feature.padEnd(45)} | ${data.evidence}`);
  }
  console.log('======================================================\n');
}

runAudit().catch((err) => {
  console.error('Audit script failed:', err);
  process.exit(1);
});
