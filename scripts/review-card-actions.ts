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
    await page.waitForFunction(() => document.querySelectorAll('.cl-teacher-message[data-role="teacher"]').length > 1 || [...document.querySelectorAll('.cl-teacher-request')].some(el => el.textContent.includes('Teacher failed:')), null, {timeout:120000});
    const correctiveFailures = [];
    if (await page.locator('.cl-teacher-request').filter({hasText:'Teacher failed:'}).count()) {
      const failed = page.locator('.cl-teacher-request').filter({hasText:'Teacher failed:'});
      ${screenshot ? `await page.screenshot({path:${JSON.stringify(screenshot + ".reply-failed.png")},fullPage:true});` : ""}
      throw new Error('Original corrective reply failed: ' + (await failed.allTextContents()).join('; '));
    }
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

/** Send a question-quality report through the same durable panel path on each real host. */
export function reportQuestionActions(screenshot: string | null): string {
  return `
    await page.getByRole('button', {name:'Flag bad question',exact:true}).click();
    const reportField = page.getByRole('textbox', {name:'Reply to your teacher',exact:true});
    const report = await reportField.inputValue();
    if (!report.startsWith('Bad question report\\nReview item:')) throw new Error('Flag did not include the original review identity.');
    const gradeCount = await page.locator('.cl-q-verdict').count();
    const teacherCount = await page.locator('.cl-teacher-message[data-role="teacher"]').count();
    await reportField.fill(report + 'The wording could distinguish the old binding from the current owner more clearly. Please acknowledge this question-quality report here. This is not an answer or evidence of learning. Preserve all grades and retrieval evidence.');
    const receipt = page.waitForResponse(response => response.url().endsWith('/api/teacher/chat'));
    await page.getByRole('button', {name:'Send reply',exact:true}).click();
    if ((await receipt).status() !== 201) throw new Error('Teacher rejected the question report.');
    await page.waitForFunction(count => document.querySelectorAll('.cl-teacher-message[data-role="teacher"]').length > count || [...document.querySelectorAll('.cl-teacher-request')].some(el => el.textContent.includes('Teacher failed:')), teacherCount, {timeout:120000});
    const failed = page.locator('.cl-teacher-request').filter({hasText:'Teacher failed:'});
    if (await failed.count()) throw new Error(await failed.allTextContents());
    await page.reload();
    await page.locator('.cl-teacher-message[data-role="learner"]').filter({hasText:'Bad question report'}).waitFor();
    if (await page.locator('.cl-q-verdict').count() !== gradeCount) throw new Error('Reporting changed quiz grades.');
    ${screenshot ? `await page.screenshot({path:${JSON.stringify(screenshot)},fullPage:true});` : ""}
  `;
}

/** Preserve one visible failure, reload it, and make one explicit feedback-based retry. */
export function teacherFailureRetryActions(screenshot: string | null): string {
  return `
    const failedRequests = page.locator('.cl-teacher-request').filter({hasText:'Teacher failed:'});
    if (await failedRequests.count() !== 1) throw new Error('Expected one specific failed teacher request: ' + (await failedRequests.allTextContents()).join('; '));
    const preservedTeacherFailure = await failedRequests.innerText();
    ${screenshot ? `await page.screenshot({path:${JSON.stringify(screenshot)},fullPage:true});` : ""}
    await page.reload();
    await page.locator('.cl-teacher-request').filter({hasText:'Teacher failed:'}).getByRole('button', {name:'Retry request',exact:true}).waitFor();
    await page.locator('.cl-teacher-request').filter({hasText:'Teacher failed:'}).getByRole('button', {name:'Retry request',exact:true}).click();
  `;
}
