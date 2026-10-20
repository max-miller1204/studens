/** Public/private canaries for portable export contracts and browser downloads. */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { Fixture } from "./helpers.ts";
import { lessonHtml, seedClassroom, termAnswer } from "./helpers.ts";
import * as store from "../src/store.ts";
import { applyGrade } from "../src/quiz-grading.ts";
export const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx1kAAAAASUVORK5CYII=",
  "base64",
);
/** Static SVG labels exercise element/text identity, nested spans and positioned Unicode. */
export const inlineSvgLabel = "Inline label — λ";
export const mediaSvgLabel = "Referenced label — λ";
export const nestedSvgLabel = "日本語 café";
export const exportSvg = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 100"><title>Saved labelled diagram</title><rect x="1" y="1" width="558" height="98" fill="white" stroke="black"/><text x="20" y="35" font-size="22" fill="black">${label}<tspan x="20" y="70"><tspan dx="8" dy="0">${nestedSvgLabel}</tspan></tspan></text><text hidden x="0" y="90">PRIVATE_HIDDEN_SVG</text><g aria-hidden="true"><text>PRIVATE_ARIA_SVG</text></g><script>PRIVATE_SVG_SCRIPT</script><foreignObject><p>PRIVATE_FOREIGN_SVG</p></foreignObject><use href="https://invalid.example/active.svg#x" onload="PRIVATE_SVG_EVENT"/></svg>`;
/** Adjacent public labels lose their control geometry in portable readers. */
export const genericLabels =
  '<label>Size<input class="cl-number" type="text"></label><label>Unit<input class="cl-unit" type="text"></label><label>Count <em>café λ</em><input type="number" value="PRIVATE_NUMBER_VALUE"></label><label for="public-unit">Measure 日本語</label><select id="public-unit"><option>PRIVATE_SELECT_VALUE</option></select><label for="public-note">Reason <strong>why</strong></label><textarea id="public-note">PRIVATE_TEXTAREA_VALUE</textarea>';
export function seedExport(f: Fixture): store.QuizSubmission {
  seedClassroom(f, { title: "Café — λ classroom" });
  f.write("empty/classroom.json", JSON.stringify({ title: "Empty classroom" }));
  f.write(
    "rust/MISSION.md",
    '# Mission\n\n## Why\n\nLearn café, λ and $x^2$.\n\n- Read **saved** source\n- Keep `code`\n\n```studens-course-map\n{"version":1,"upcoming":[],"connections":[]}\n```',
  );
  f.write("rust/NOTES.md", "# Notes\n\n[My notes](notes/ownership.md)\n");
  f.write(
    "rust/notes/ownership.md",
    "# My notes\n\nSaved learner note with Unicode 日本語.\n\n```js\nconst sum = 2;\nconsole.log(sum);\n```\n",
  );
  f.write("rust/GLOSSARY.md", "# Glossary\n\n**Owner**:\nThe binding responsible for release.\n");
  f.write(
    "rust/learning-records/0001-learning.md",
    "# Learning record\n\nActual saved evidence: identified an owner.\n",
  );
  f.write(
    "rust/reference/reference.html",
    lessonHtml("Reference", "<h1>Reference</h1><p>Saved reference prose.</p>"),
  );
  const body = String.raw`<h1>Ownership café λ</h1><h2>Move and release</h2><p>Saved public prose with \(x^2\) and $y+1$.</p><ul><li>First saved item<li>Second saved item</ul><pre><code class="language-js">const text = &quot;café&quot;;
console.log(text &lt; &quot;z&quot;);</code></pre><pre class="mermaid">flowchart LR
 A[Owner] --> B[Release]</pre><img src="media/pixel.png" alt="Public pixel"><h2>Saved labelled diagrams</h2>${exportSvg(inlineSvgLabel)}<img src="media/labelled.svg" alt="Referenced labelled diagram"><p><a href="../assets/pixel.png">Public media</a> <a href="/c/rust/001-ownership/quiz/key.json">Private key link</a></p><script>PRIVATE_SCRIPT_CANARY</script><style>PRIVATE_STYLE_CANARY</style><iframe srcdoc="PRIVATE_IFRAME_CANARY"></iframe><template>PRIVATE_TEMPLATE_CANARY</template><div data-cl-stepper>PRIVATE_WIDGET_CONFIG</div><h2>Public quantity controls</h2><ol><li><p>Describe the sample quantity?</p>${genericLabels}</li><li><p>Keep the next quantity separate?</p></li></ol><form class="cl-quiz" data-quiz-id="check" data-kind="check"><ol class="cl-questions"><li class="cl-q" data-question-id="q1" data-type="term"><p class="cl-q-prompt">Who releases the value?</p><input type="text"></li><li class="cl-q" data-question-id="q2" data-type="term"><p class="cl-q-prompt">A second question</p><input type="text"></li></ol></form>`;
  f.write("rust/001-ownership/lesson.html", lessonHtml("Ownership café λ", body));
  const key = {
    check: {
      q1: {
        expected: "UNLOCKED_EXPECTED — new owner",
        points: 1,
        full: "The current owner releases the value.",
        partial: "Name the owner.",
        privateFuture: "PRIVATE_KEY_EXTRA",
      },
      q2: {
        expected: "PRIVATE_LOCKED_EXPECTED",
        points: 1,
        full: "Private missed reasoning",
        partial: "Private partial",
        variants: [{ html: "PRIVATE_VARIANT" }],
      },
    },
    secret: "PRIVATE_KEY_CANARY",
  };
  f.write("rust/001-ownership/quiz/key.json", JSON.stringify(key));
  f.write("rust/001-ownership/quiz/plan.json", "{PRIVATE_PLAN_CANARY");
  f.write("rust/.teacher.json", "{PRIVATE_TEACHER_CANARY");
  f.write("rust/001-ownership/drafts.json", '{"private":"PRIVATE_DRAFT_CANARY"}');
  f.write("rust/001-ownership/teacher-messages.json", '{"private":"PRIVATE_SESSION_CANARY"}');
  f.write("rust/001-ownership/quiz/key.png", "PRIVATE_IMAGE_CANARY");
  f.write("rust/001-ownership/media/labelled.svg", exportSvg(mediaSvgLabel));
  f.write("rust/001-ownership/media/pixel.png", "");
  fs.writeFileSync(path.join(f.root, "rust/001-ownership/media/pixel.png"), pixel);
  f.write("rust/assets/pixel.png", "");
  fs.writeFileSync(path.join(f.root, "rust/assets/pixel.png"), pixel);
  const a = {
    id: randomUUID(),
    classroom: "rust",
    lesson: "001-ownership",
    status: "answered",
    question: "Why does the owner matter?",
    selection: "Saved public prose",
    anchor: { exact: "Saved public prose", prefix: "", suffix: "", occurrence: 0 },
    answerMarkdown: "A saved **public reply**.\n\nSecond reply paragraph.",
    answerHtml: "PRIVATE_IGNORED_HTML",
    createdAt: 1,
    answeredAt: 2,
    followUps: [
      {
        id: randomUUID(),
        status: "answered",
        question: "What about moves?",
        answerMarkdown: "A move transfers ownership.",
        answerHtml: "PRIVATE_IGNORED_FOLLOWUP_HTML",
        askedAt: 3,
        answeredAt: 4,
      },
    ],
  };
  f.write("rust/001-ownership/annotations.json", JSON.stringify([a]));
  f.write(
    "rust/002-gated/lesson.html",
    lessonHtml(
      "Gated lesson",
      '<h1>Diagnostic</h1><form class="cl-quiz" data-quiz-id="pretest" data-kind="pretest"><li class="cl-q" data-question-id="q" data-type="short"><p class="cl-q-prompt">Make a prediction.</p><textarea></textarea></li></form><template data-cl-after-pretest="pretest"><h2>GATED_TEACHING_CANARY</h2><img src="media/gated.png" alt="GATED_MEDIA_CANARY"></template>',
    ),
  );
  f.write("rust/002-gated/lesson.json", JSON.stringify({ title: "Gated lesson" }));
  f.write(
    "rust/002-gated/annotations.json",
    JSON.stringify([{ ...a, lesson: "002-gated", question: "GATED_THREAD_CANARY" }]),
  );
  const request = {
    id: randomUUID(),
    classroom: "rust",
    lesson: "003-pending",
    topic: "PRIVATE_TOPIC",
    owner: "codex",
    ownerPid: process.pid,
    at: 1,
    status: "queued",
    document: { private: "PRIVATE_REQUEST_DOCUMENT" },
  };
  f.write("rust/.lesson-requests.json", JSON.stringify({ version: 1, requests: [request] }));
  f.write(
    "rust/003-pending/lesson.html",
    lessonHtml("PRIVATE_PENDING_TITLE", "<p>PRIVATE_PENDING_TEACHING</p>"),
  );
  const submission = store.createSubmission({
    classroom: "rust",
    lesson: "001-ownership",
    quizId: "check",
    quizTitle: "Saved check",
    kind: "check",
    answers: [termAnswer("q1", "new owner"), termAnswer("q2", "wrong")],
  });
  applyGrade(submission, {
    score: 50,
    feedbackMarkdown: "Saved feedback",
    questions: [
      {
        questionId: "q1",
        correct: true,
        pointsEarned: 1,
        pointsPossible: 1,
        feedback: "Saved feedback",
      },
      {
        questionId: "q2",
        correct: false,
        pointsEarned: 0,
        pointsPossible: 1,
        feedback: "Saved feedback",
      },
    ],
  });
  // Invalid private teacher state is intentional. Correct answer should not need it;
  // missed answer needs a valid teacher state to establish that no corrective task exists.
  f.write(
    "rust/.teacher.json",
    JSON.stringify({
      version: 1,
      identity: { backend: "codex", classroom: "rust", sessionId: "fixture-export", createdAt: 1 },
      messages: [],
      requests: [],
      updatedAt: 1,
      private: "PRIVATE_TEACHER_CANARY",
    }),
  );
  return submission;
}
