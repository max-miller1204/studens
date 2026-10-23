/** Prove the typed service producer reaches the real four-file checker/publication boundary. */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { makeFixture, seedClassroom, seedPreparedReviewSource } from "../test/helpers.ts";
import { nextLessonDocument } from "../test/next-lesson-fixture.ts";
import { lessonOutput } from "../test/lesson-output-fixture.ts";
import { lessonModelPlan } from "../src/lesson-output.ts";
import {
  completeLessonRequest,
  lessonPublicationFiles,
  lessonRequests,
  saveLessonDocument,
  startLessonRequest,
} from "../src/next-lesson.ts";
import * as store from "../src/store.ts";

export async function verifyStepperPublication(artifacts: string | null): Promise<void> {
  const f = makeFixture();
  seedClassroom(f);
  seedPreparedReviewSource(f.root);
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  try {
    const template = fs.readFileSync(
      new URL("../assets/templates/stepper.html", import.meta.url),
      "utf8",
    );
    const widget = template.slice(template.indexOf('<section class="cl-stepper cl-card-box"'));
    const source = nextLessonDocument(f.root);
    source.lesson_html = source.lesson_html.replace("</template>", `${widget}</template>`);
    const typed = lessonOutput(source);
    const plan = lessonModelPlan(typed);
    const document = JSON.parse(plan.calls[0].arguments_json);
    const records = JSON.stringify(store.readLearningRecords("rust"));
    const grades = JSON.stringify(store.listGrades("rust", "001-ownership"));
    let request = startLessonRequest(
      "rust",
      randomUUID(),
      "Stepper publication contract",
      "codex",
      "service",
    );
    request = saveLessonDocument(request, document);
    // This is the production checker and serializer, not a synthetic page-check receipt.
    await completeLessonRequest(request);
    const saved = lessonRequests("rust").find((r) => r.id === request.id)!;
    assert.equal(saved.status, "done");
    assert.ok(saved.pageCheck);
    const receipt = JSON.parse(saved.pageCheck.report);
    assert.equal(receipt.initial.steppers, 0);
    assert.equal(receipt.released.steppers, 4);
    assert.equal(receipt.learnerStateChanged, false);
    for (const [name, bytes] of Object.entries(lessonPublicationFiles(saved, document))) {
      assert.equal(fs.readFileSync(path.join(f.root, "rust", saved.lesson, name), "utf8"), bytes);
      assert.equal(
        receipt.preflight.inputHashes[name],
        createHash("sha256").update(bytes).digest("hex"),
      );
    }
    assert.deepEqual(store.listSubmissions("rust", saved.lesson), []);
    assert.deepEqual(store.listGrades("rust", saved.lesson), []);
    assert.equal(JSON.stringify(store.readLearningRecords("rust")), records);
    assert.equal(JSON.stringify(store.listGrades("rust", "001-ownership")), grades);
    const invalid = {
      ...document,
      lesson_html: document.lesson_html.replace('"version": 1', '"version": 99'),
    };
    let rejected = startLessonRequest(
      "rust",
      randomUUID(),
      "Malformed public widget",
      "codex",
      "service",
    );
    rejected = saveLessonDocument(rejected, invalid);
    let refusal = "";
    try {
      await completeLessonRequest(rejected);
    } catch (error) {
      refusal = String(error);
    }
    assert.match(refusal, /Stepper version must be 1/);
    const failed = lessonRequests("rust").find((r) => r.id === rejected.id)!;
    assert.equal(failed.pageCheckFailed, true);
    assert.ok(failed.pageCheckFailures?.length);
    assert.equal(fs.existsSync(path.join(f.root, "rust", rejected.lesson, "lesson.html")), false);
    assert.deepEqual(store.listSubmissions("rust", rejected.lesson), []);
    assert.deepEqual(store.listGrades("rust", rejected.lesson), []);
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "publication.json"),
        JSON.stringify(
          {
            kind: "typed-producer-and-real-page-check-fixture",
            inference: false,
            plan,
            request: saved,
            receipt,
            refusal,
            rejected: failed,
            noLearnerSubmissionsOrGrades: true,
            originalRecordsAndGradesUnchanged: true,
          },
          null,
          2,
        ),
      );
    console.log(
      "PASS: typed stepper HTML, canonical private serialization, real initial/released checker, four-file hashes, publication without learner state, malformed widget refused before publication",
    );
  } finally {
    f.cleanup();
  }
}
