const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  // Navigate to the app
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(2000);

  // Screenshot 1: Initial login page with favicon check
  await page.screenshot({ path: 'D:/krushnasindhu/spill2source/test-results/01-login-page.png', fullPage: true });
  console.log('Screenshot 1: Login page captured');

  // Check globe cursor (crosshair)
  const globe = await page.locator('.space-3d-canvas-container');
  const cursor = await globe.evaluate(el => getComputedStyle(el).cursor);
  console.log('Globe cursor:', cursor);

  // Screenshot 2: Click "Request Demo Access"
  await page.click('.demo-request-btn');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/krushnasindhu/spill2source/test-results/02-demo-modal.png', fullPage: true });
  console.log('Screenshot 2: Demo modal captured');

  // Close modal
  await page.click('.demo-modal-close');
  await page.waitForTimeout(300);

  // Screenshot 3: Submit with empty fields to trigger error bar
  await page.click('.primary-submit-btn');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/krushnasindhu/spill2source/test-results/03-auth-failed-bar.png', fullPage: true });
  console.log('Screenshot 3: Auth failed bar captured');

  // Screenshot 4: Fill credentials and submit to show loading state
  await page.fill('#login-email', 'test@example.com');
  await page.fill('#login-password', 'password123');
  await page.screenshot({ path: 'D:/krushnasindhu/spill2source/test-results/04-filled-form.png', fullPage: true });
  console.log('Screenshot 4: Filled form captured');

  // Click submit and capture loading state
  await page.click('.primary-submit-btn');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'D:/krushnasindhu/spill2source/test-results/05-loading-state.png', fullPage: true });
  console.log('Screenshot 5: Loading state captured');

  await browser.close();
  console.log('All tests completed!');
})();
