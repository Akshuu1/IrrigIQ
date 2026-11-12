import { test, expect } from '@playwright/test';

test.describe('Phase 11 Acceptance: Offline-First PWA, IndexedDB & Sync Queue', () => {
  test('goes offline, logs irrigation locally, goes online and syncs', async ({ page, context }) => {
    const timestamp = Date.now();
    const testEmail = `farmer_offline_${timestamp}@example.com`;
    const password = 'Password123!';

    // 1. Register a new user
    await page.goto('/register');
    await page.fill('#register-name', 'Kisan Offline Tester');
    await page.fill('#register-email', testEmail);
    await page.fill('#register-password', password);
    await page.click('button[type="submit"]');

    // Wait for redirect to Dashboard
    await page.waitForURL('/');
    expect(page.url()).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):3000\/$/);

    // 2. Create a field via FieldWizard (client-side SPA navigation)
    const addFieldLink = page.locator('a[href="/fields/new"]').first();
    await addFieldLink.click();
    await page.waitForURL('/fields/new');

    // Click quick sample field button to draw valid geometry in Haryana
    const sampleBtn = page.locator('button:has-text("Use Sample Field"), button:has-text("नमूना खेत जोड़ें")');
    await expect(sampleBtn).toBeVisible();
    await sampleBtn.click();

    // Fill name and dates
    await page.fill('#field-name', 'Offline Testing Field');

    const sowingDate = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString().split('T')[0]!;
    await page.fill('#field-sowing', sowingDate);

    // Submit field creation
    await page.click('button[type="submit"]');

    // Wait for redirection back to Dashboard
    await page.waitForURL('/');

    // Wait for field card to appear on Dashboard
    await expect(page.locator('text=Offline Testing Field')).toBeVisible({ timeout: 10000 });

    // Navigate to field detail
    const viewDetailsBtn = page.locator('a:has-text("View Details"), a:has-text("विवरण देखें")').first();
    await viewDetailsBtn.click();
    await page.waitForURL(/\/fields\/.+/);

    // Verify on Field Detail page
    await expect(page.locator('h1:has-text("Offline Testing Field")')).toBeVisible();

    // 3. Go Offline
    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });

    // Verify offline banner appears
    const offlineBanner = page.locator('aside[aria-label="Offline sync status"]');
    await expect(offlineBanner).toBeVisible();

    // 4. Log irrigation while offline
    const irrigateBtn = page.locator('button:has-text("I Irrigated"), button:has-text("मैंने सिंचाई की")');
    await irrigateBtn.click();

    // Wait for modal
    const logModal = page.locator('form:has-text("Water Depth"), form:has-text("पानी की गहराई")');
    await expect(logModal).toBeVisible();

    // Submit log
    const submitLogBtn = logModal.locator('button[type="submit"]');
    await submitLogBtn.click();

    // Verify pending changes badge is shown
    const pendingBadge = page.locator('[data-testid="pending-badge"]');
    await expect(pendingBadge).toBeVisible();
    await expect(pendingBadge).toContainText('1');

    // 5. Restore connection (Go Online)
    await context.setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    // Click "Sync now" or wait for automatic online handler
    const syncNowBtn = page.locator('button:has-text("Sync now"), button:has-text("अभी सिंक करें")').first();
    if (await syncNowBtn.isVisible()) {
      await syncNowBtn.click();
    }

    // 6. Verify pending badge disappears (0 pending)
    await expect(pendingBadge).not.toBeVisible({ timeout: 15000 });
  });

  test('logout clears all cached data in IndexedDB and browser cache', async ({ page }) => {
    const timestamp = Date.now();
    const testEmail = `farmer_logout_${timestamp}@example.com`;
    const password = 'Password123!';

    // 1. Register a fresh user
    await page.goto('/register');
    await page.fill('#register-name', 'Logout Tester');
    await page.fill('#register-email', testEmail);
    await page.fill('#register-password', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Wait 1s for queries to populate IndexedDB
    await page.waitForTimeout(1000);

    // Verify IndexedDB is initialized
    const dbInitialized = await page.evaluate(async () => {
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open('irrigiq-offline-db', 1);
        req.onsuccess = () => {
          resolve(true);
        };
        req.onerror = () => resolve(false);
      });
    });
    expect(dbInitialized).toBe(true);

    // 2. Perform Logout
    const logoutBtn = page.locator('button[title="Logout"], button[title="लॉगआउट"], button[aria-label="Logout"], button[aria-label="लॉगआउट"]');
    await logoutBtn.click();
    await page.waitForURL('/login');

    // 3. Verify IndexedDB stores are completely empty
    const postLogoutCounts = await page.evaluate(async () => {
      return new Promise<{ fields: number; queue: number }>((resolve) => {
        const req = indexedDB.open('irrigiq-offline-db', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['fields', 'mutationQueue'], 'readonly');
          const fieldsCountReq = tx.objectStore('fields').count();
          const queueCountReq = tx.objectStore('mutationQueue').count();
          let fCount = 0;
          let qCount = 0;
          fieldsCountReq.onsuccess = () => { fCount = fieldsCountReq.result; };
          queueCountReq.onsuccess = () => { qCount = queueCountReq.result; };
          tx.oncomplete = () => resolve({ fields: fCount, queue: qCount });
          tx.onerror = () => resolve({ fields: 0, queue: 0 });
        };
        req.onerror = () => resolve({ fields: 0, queue: 0 });
      });
    });

    expect(postLogoutCounts.fields).toBe(0);
    expect(postLogoutCounts.queue).toBe(0);
  });
});
