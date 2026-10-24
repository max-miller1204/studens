/** Actual host daily path; fixture material, real ownership and corrective teacher. */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  seedPreparedReviewSource,
  closeReviewVariants,
  writeGradedAttempt,
  termAnswer,
} from "../test/helpers.ts";
import { notesStub } from "../src/prompts.ts";

export function seedDailyCompanion(root: string): void {
  const classroom = "z-biology";
  const dir = path.join(root, classroom);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "classroom.json"),
    JSON.stringify({ title: "Biology", emoji: "🧬", createdAt: Date.now() }),
  );
  fs.writeFileSync(
    path.join(dir, "MISSION.md"),
    "# Mission: Biology\n\n## Why\n\nExplain cell transport.\n",
  );
  fs.writeFileSync(path.join(dir, "NOTES.md"), notesStub());
  seedPreparedReviewSource(root, classroom);
  closeReviewVariants(root, classroom);
  for (const file of ["lesson.html", "quiz/key.json", "quiz/plan.json"]) {
    const target = path.join(dir, "001-ownership", file);
    fs.writeFileSync(
      target,
      fs
        .readFileSync(target, "utf8")
        .replaceAll("Explain ownership.", "Explain cells.")
        .replaceAll(
          "A value moves into a new scope. Who releases it?",
          "Which structure controls what enters and leaves a cell?",
        )
        .replaceAll("The new owner", "The cell membrane")
        .replaceAll("The old binding", "The nucleus")
        .replaceAll("The current owner releases the value.", "The membrane controls transport.")
        .replaceAll("The old binding no longer owns it.", "The nucleus contains genetic material."),
    );
  }
  writeGradedAttempt({
    classroom,
    at: Date.now() - 2 * 86400000,
    answers: [
      termAnswer("q1", "membrane", {
        learning: {
          objectiveId: "membrane",
          objective: { statement: "Explain cells.", application: false },
          task: "retrieval",
          support: "independent",
          assistance: "none",
        },
      }),
    ],
    correct: { q1: true },
  });
}
export function startDailyActions(base: string): string {
  return `
    await page.goto(${JSON.stringify(base)});
    await page.getByRole('button', {name:'Start daily review',exact:true}).click();
    await page.getByRole('button', {name:'Continue Rust review',exact:true}).waitFor();
    if(await page.locator('.cl-daily-group').count()!==2) throw new Error('Actual host daily batch lost a classroom.');
    await page.reload();
    await page.getByRole('button', {name:'Continue Rust review',exact:true}).click();
  `;
}
export function finishDailyActions(screenshot: string | null): string {
  return `
    await page.getByRole('link', {name:'Continue daily review',exact:true}).click();
    await page.getByRole('button', {name:'Start Biology review',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-review-active="true"]')?.dataset.state==='fresh');
    if(!(await page.locator('form.cl-quiz:visible').innerText()).includes('cell')) throw new Error('Daily group mixed unrelated subjects.');
    await page.locator('form.cl-quiz:visible input[value="owner"]').check();
    await page.locator('form.cl-quiz:visible button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-review-active="true"]')?.dataset.state==='graded');
    await page.getByRole('link', {name:'Continue daily review',exact:true}).click();
    await page.getByText('Daily review complete. Each classroom keeps its review history.',{exact:true}).waitFor();
    await page.reload();
    await page.getByText('Daily review complete. Each classroom keeps its review history.',{exact:true}).waitFor();
    ${screenshot ? `await page.screenshot({path:${JSON.stringify(screenshot)},fullPage:true});` : ""}
  `;
}
