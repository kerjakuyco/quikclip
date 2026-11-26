import type { Page } from '@playwright/test';

export function clipTools(page: Page, section: string) {
  return page
    .getByRole('tabpanel', { name: 'Clips' })
    .locator('summary')
    .filter({ has: page.getByText(section, { exact: true }) });
}

export async function openClipTools(page: Page, section: string) {
  const summary = clipTools(page, section);
  if (!(await summary.evaluate((el) => el.closest('details')?.open))) await summary.click();
}
