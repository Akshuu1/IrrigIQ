import { test, expect } from '@playwright/test';

test.describe('Phase 13 Acceptance: Comprehensive End-to-End Quality Gate', () => {
  test('register -> draw a field -> see recommendation -> switch to Hindi -> log irrigation -> see savings -> run offline flow -> generate report', async ({
    page,
    context,
  }) => {
    const timestamp = Date.now();
    const testEmail = `kisan_quality_${timestamp}@example.com`;
    const password = 'Password123!';

    // 1. Register a fresh farmer
    await page.goto('/register');
    await page.fill('#register-name', 'Kisan Quality Gate');
    await page.fill('#register-email', testEmail);
    await page.fill('#register-password', password);
    await page.click('button[type="submit"]');

    // Wait for Dashboard
    await page.waitForURL('/');
    expect(page.url()).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):3000\/$/);

    // 2. Draw a field via FieldWizard
    const addFieldLink = page.locator('a[href="/fields/new"]').first();
    await addFieldLink.click();
    await page.waitForURL('/fields/new');

    // Click sample field polygon button
    const sampleBtn = page.getByRole('button', { name: /Use Sample Field|नमूना खेत जोड़ें/i });
    await expect(sampleBtn).toBeVisible();
    await sampleBtn.click();

    // Fill field details
    await page.fill('#field-name', 'Quality Gate Wheat Field');
    const sowingDate = new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString().split('T')[0]!;
    await page.fill('#field-sowing', sowingDate);

    // Submit field creation
    await page.click('button[type="submit"]');

    // Redirected to Dashboard
    await page.waitForURL('/');
    await expect(page.locator('text=Quality Gate Wheat Field')).toBeVisible({ timeout: 10000 });

    // 3. See a recommendation on Field Detail
    const viewDetailsBtn = page.getByRole('link', { name: /View Details|विवरण देखें/i }).first();
    await viewDetailsBtn.click();
    await page.waitForURL(/\/fields\/.+/);

    await expect(page.getByRole('heading', { level: 1, name: 'Quality Gate Wheat Field' })).toBeVisible();

    // Verify Today's Advisory Action sentence and 'I Irrigated' button are visible
    const iIrrigatedBtn = page.getByRole('button', { name: /I Irrigated|मैंने सिंचाई की/i }).first();
    await expect(iIrrigatedBtn).toBeVisible();

    // 4. Switch to Hindi
    const langSelect = page.locator('#header-language-select');
    if (await langSelect.isVisible()) {
      await langSelect.selectOption('hi');
    } else {
      const langBtn = page.locator('button[aria-label*="भाषा"], button[title*="Language"]').first();
      await langBtn.click();
    }

    // Verify UI switches to Hindi ('मैंने सिंचाई की' visible on button)
    const hindiIrrigatedBtn = page.getByRole('button', { name: 'मैंने सिंचाई की' }).first();
    await expect(hindiIrrigatedBtn).toBeVisible({ timeout: 5000 });

    // 5. Log irrigation in Hindi UI
    await hindiIrrigatedBtn.click();

    // Irrigation modal opens; submit log
    const modalSubmitBtn = page.locator('form button[type="submit"]').last();
    await expect(modalSubmitBtn).toBeVisible();
    await modalSubmitBtn.click();

    // 6. See savings card
    await expect(page.getByRole('heading', { level: 2, name: /जल बचत सारांश|Water Savings Summary/i })).toBeVisible();

    // 7. Run the offline flow
    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });

    // Offline banner appears
    const offlineBanner = page.locator('aside[aria-label="Offline sync status"]');
    await expect(offlineBanner).toBeVisible({ timeout: 5000 });

    // Log another irrigation while offline
    await hindiIrrigatedBtn.click();
    await modalSubmitBtn.click();

    // Verify pending changes badge shows at least 1 change
    const pendingBadge = page.locator('[data-testid="pending-badge"]');
    await expect(pendingBadge).toBeVisible();

    // Restore online connectivity
    await context.setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    // Click "Sync now" or wait for sync
    const syncNowBtn = page.getByRole('button', { name: /Sync now|अभी सिंक करें/i });
    if (await syncNowBtn.isVisible()) {
      await syncNowBtn.click();
    }

    // Pending badge clears once synced
    await expect(pendingBadge).not.toBeVisible({ timeout: 10000 });

    // 8. Generate a report
    const createReportBtn = page.getByRole('button', { name: /PDF रिपोर्ट बनाएं|Create PDF Report/i });
    await expect(createReportBtn).toBeVisible();
    await createReportBtn.click();

    // Verify Report Modal is open
    const reportModal = page.locator('div[role="dialog"]');
    await expect(reportModal).toBeVisible();

    // Click "Generate PDF Report"
    const generateBtn = reportModal.locator('button[type="submit"]').first();
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // Wait for report completion and download button
    const downloadBtn = reportModal.getByRole('button', { name: /डाउनलोड|Download PDF/i });
    await expect(downloadBtn).toBeVisible({ timeout: 45000 });
  });
});
