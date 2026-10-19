/** Real learner controls shared by Pi and persistent-host verification. */
export const CLOSED_REVIEW_REPLY =
  "The current owner releases the value when its scope ends. I answered without help.";

export function closedReviewActions(screenshot: string | null): string {
  return `
    await page.locator('form.cl-quiz:visible').waitFor();
    if (await page.locator('form.cl-quiz:visible').count() !== 1) throw new Error('Review shows multiple cards.');
    await page.locator('form.cl-quiz:visible input[value="old"]').check();
    await page.locator('form.cl-quiz:visible [data-cl-assistance]').selectOption('none');
    const response = page.waitForResponse(r => r.url().endsWith('/api/quiz/submit'));
    await page.locator('form.cl-quiz:visible button[type="submit"]').click();
    if ((await response).status() !== 201) throw new Error('Closed review submission failed.');
    await page.waitForFunction(() => document.querySelector('form.cl-quiz:not([hidden])')?.dataset.state === 'graded');
    if (!(await page.locator('form.cl-quiz:visible .cl-q-verdict').innerText()).includes('Incorrect')) throw new Error('Closed miss has no immediate feedback.');
    await page.waitForFunction(() => [...document.querySelectorAll('.cl-teacher-message[data-role="teacher"]')].some(el => el.textContent.includes('?')), null, {timeout:120000});
    if (!await page.locator('form.cl-quiz:visible').evaluate(el => el.nextElementSibling?.id === 'cl-teacher')) throw new Error('Corrective panel left the review card.');
    ${screenshot ? `await page.screenshot({path:${JSON.stringify(screenshot)},fullPage:true});` : ""}
    await page.getByRole('textbox', {name:'Reply to your teacher',exact:true}).fill(${JSON.stringify(CLOSED_REVIEW_REPLY)});
    await page.getByRole('button', {name:'Send reply',exact:true}).click();
    await page.waitForFunction(() => document.querySelectorAll('.cl-teacher-message[data-role="teacher"]').length > 1, null, {timeout:120000});
  `;
}

/** A failed background plan stays failed until the learner presses its retry button. */
export function refillRetryActions(ids: string[], screenshot: string | null): string {
  return `
    ${screenshot ? `await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({path:${JSON.stringify(screenshot)},fullPage:true});` : ""}
    for (const id of ${JSON.stringify(ids)}) {
      await page.locator('.cl-teacher-request').filter({hasText:id}).getByRole('button', {name:'Retry request',exact:true}).click();
    }
  `;
}
