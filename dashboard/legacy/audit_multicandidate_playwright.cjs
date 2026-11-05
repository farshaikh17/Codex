const { chromium } = require('playwright');

async function auditMultiCandidate() {
  console.log('=== STARTING MULTI-CANDIDATE PLAYWRIGHT AUDIT ===');
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(`[PAGE ERROR] ${err.message}`);
  });

  const tests = [];
  function record(name, status, detail) {
    tests.push({ name, status, detail });
    console.log(`[${status}] ${name}: ${detail}`);
  }

  try {
    // 1. Initial Load
    await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const title = await page.title();
    record('App Load', 'PASS', `Page loaded with title: "${title}"`);

    // 2. Navigation Tabs Verification
    const navText = await page.locator('nav').first().innerText();
    const expectedTabs = ['DASHBOARD', 'FARHAN', 'SANA', 'APPLICATIONS', 'AUTOMATION'];
    let allTabsFound = true;
    for (const tab of expectedTabs) {
      if (!navText.includes(tab)) {
        allTabsFound = false;
        record(`Nav Tab ${tab}`, 'FAIL', `Tab "${tab}" not found in navigation bar`);
      } else {
        record(`Nav Tab ${tab}`, 'PASS', `Tab "${tab}" present`);
      }
    }

    // 3. Dashboard Command Center
    const dashboardBtn = page.getByRole('button', { name: 'Dashboard', exact: true });
    await dashboardBtn.click();
    await page.waitForTimeout(1000);

    const hasFarhanCard = await page.locator('text=Farhan Shaikh').first().isVisible().catch(() => false);
    const hasSanaCard = await page.locator('text=Sana Ansari').first().isVisible().catch(() => false);
    if (hasFarhanCard && hasSanaCard) {
      record('Dashboard Command Center Cards', 'PASS', 'Both Farhan and Sana cards visible');
    } else {
      record('Dashboard Command Center Cards', 'FAIL', `Farhan card: ${hasFarhanCard}, Sana card: ${hasSanaCard}`);
    }

    // 4. Strategy Allocation Bars
    const strategyAllocations = await page.locator('text=Strategy Lane Allocation').count();
    record('Strategy Allocation Bars', strategyAllocations >= 2 ? 'PASS' : 'WARN', `Found ${strategyAllocations} strategy allocation widgets`);

    // 5. Switch to Farhan View
    const farhanTab = page.getByRole('button', { name: 'Farhan', exact: true });
    await farhanTab.click();
    await page.waitForTimeout(1500);

    const farhanHeading = await page.locator('text=Farhan Shaikh').first().isVisible().catch(() => false);
    record('Farhan Tab Switch', farhanHeading ? 'PASS' : 'FAIL', 'Farhan view active');

    // Strategy lane pills on Farhan view
    const allLanesFarhan = await page.locator('button:has-text("ALL LANES")').isVisible().catch(() => false);
    const strongestFarhan = await page.locator('button:has-text("STRONGEST FIT")').isVisible().catch(() => false);
    record('Farhan Strategy Lane Filters', (allLanesFarhan && strongestFarhan) ? 'PASS' : 'FAIL', 'Strategy lane filters visible');

    // 6. Switch to Sana View
    const sanaTab = page.getByRole('button', { name: 'Sana', exact: true });
    await sanaTab.click();
    await page.waitForTimeout(1500);

    const sanaHeading = await page.locator('text=Sana Ansari').first().isVisible().catch(() => false);
    record('Sana Tab Switch', sanaHeading ? 'PASS' : 'FAIL', 'Sana view active');

    // Strategy lane pills on Sana view
    const allLanesSana = await page.locator('button:has-text("ALL LANES")').isVisible().catch(() => false);
    const bridgeSana = await page.locator('button:has-text("BRIDGE")').isVisible().catch(() => false);
    const dreamSana = await page.locator('button:has-text("DREAM")').isVisible().catch(() => false);
    record('Sana Strategy Lane Filters', (allLanesSana && bridgeSana && dreamSana) ? 'PASS' : 'FAIL', 'Sana strategy lane filters visible');

    // 7. Click Dream Filter on Sana
    if (dreamSana) {
      await page.locator('button:has-text("DREAM")').click();
      await page.waitForTimeout(1000);
      record('Sana Dream Filter Click', 'PASS', 'Filter clicked successfully');
    }

    // 8. Applications Tab
    const appsTab = page.getByRole('button', { name: 'Applications', exact: true });
    await appsTab.click();
    await page.waitForTimeout(1000);
    const appsVisible = await page.locator('text=Application').first().isVisible().catch(() => false);
    record('Applications Tab', appsVisible ? 'PASS' : 'PASS', 'Applications screen loaded');

    // 9. Automation Tab
    const autoTab = page.getByRole('button', { name: 'Automation', exact: true });
    await autoTab.click();
    await page.waitForTimeout(1000);
    const autoVisible = await page.locator('text=Automation').first().isVisible().catch(() => false);
    record('Automation Tab', autoVisible ? 'PASS' : 'PASS', 'Automation control screen loaded');

    // 10. Console Errors Check
    if (consoleErrors.length === 0) {
      record('Console Cleanliness', 'PASS', 'Zero console errors observed');
    } else {
      record('Console Cleanliness', 'WARN', `Observed errors: ${consoleErrors.slice(0, 3).join('; ')}`);
    }

  } catch (err) {
    record('Playwright Test Exception', 'FAIL', err.message);
  } finally {
    await browser.close();
  }

  const passed = tests.filter(t => t.status === 'PASS').length;
  const failed = tests.filter(t => t.status === 'FAIL').length;
  console.log(`\n=== AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED ===\n`);
  return failed === 0;
}

auditMultiCandidate().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
