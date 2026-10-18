import { describe, expect, it } from "vitest";
import { authoredVariants, validateVariant } from "../src/review-variants.ts";

const objective = { statement: "Explain ownership.", application: false, retentionDays: 30 };
const mapping = { objective: "original", task: "retrieval", support: "independent" };
const variant = (id: string) => ({
  id,
  html: `<li class="cl-q" data-question-id="${id}" data-type="short"><p class="cl-q-prompt">Explain a fresh ownership case.</p><textarea></textarea></li>`,
  rubric: {
    expected: "The owner releases the value.",
    points: 1,
    full: "Identify the owner.",
    partial: "Zero without the owner.",
  },
});
const html =
  '<form class="cl-quiz" data-quiz-id="check" data-kind="check"><li class="cl-q" data-question-id="q1" data-type="short"><textarea></textarea></li></form>';
function documents() {
  return {
    key: { check: { q1: { ...variant("v1").rubric, variants: [variant("v1"), variant("v2")] } } },
    plan: {
      version: 1,
      objectives: { o: objective },
      quizzes: {
        check: {
          purpose: "assessment",
          questions: { q1: { ...mapping, objective: "o", variants: { v1: mapping, v2: mapping } } },
        },
      },
    },
  };
}

describe("private variant contracts", () => {
  it("pairs controls, answer keys and independent plans with the source objective", () => {
    const { key, plan } = documents();
    const pool = authoredVariants(JSON.stringify(key), JSON.stringify(plan), html, true).get(
      "check/q1",
    )!;
    expect(pool.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(pool[0].objective).toEqual(objective);
    expect(pool[0].rubric.expected).toBe("The owner releases the value.");
  });
  it("allows legacy absence but refuses incomplete, duplicate or mismatched pools", () => {
    const { key, plan } = documents();
    delete (key.check.q1 as { variants?: unknown }).variants;
    delete (plan.quizzes.check.questions.q1 as { variants?: unknown }).variants;
    expect(authoredVariants(JSON.stringify(key), JSON.stringify(plan), html).size).toBe(0);
    expect(() => authoredVariants(JSON.stringify(key), JSON.stringify(plan), html, true)).toThrow(
      "two or three",
    );
    const bad = documents();
    bad.key.check.q1.variants[1].id = "v1";
    expect(() => authoredVariants(JSON.stringify(bad.key), JSON.stringify(bad.plan), html)).toThrow(
      "duplicate",
    );
    bad.key.check.q1.variants[1].id = "other";
    expect(() => authoredVariants(JSON.stringify(bad.key), JSON.stringify(bad.plan), html)).toThrow(
      "mismatched",
    );
  });
  it("rejects malformed controls, closed keys, active content and assisted retrieval", () => {
    for (const fragment of [
      variant("v1").html.replace("<textarea></textarea>", ""),
      variant("v1").html.replace("<textarea>", '<textarea onfocus="alert(1)">'),
      variant("v1").html + "<script>alert(1)</script>",
      variant("v1").html.replace("<textarea>", "<textarea onfocus=alert(1)>"),
      variant("v1").html.replace("<textarea>", "<a href=javascript:alert(1)>Link</a><textarea>"),
      variant("v1").html.replace("<textarea>", '<img src="../secret"><textarea>'),
    ])
      expect(() =>
        validateVariant({ ...variant("v1"), html: fragment }, mapping, objective),
      ).toThrow();
    expect(() =>
      validateVariant(variant("v1"), { ...mapping, support: "assisted" }, objective),
    ).toThrow("independent");
    expect(() =>
      validateVariant(
        {
          ...variant("v1"),
          html: variant("v1")
            .html.replace('data-type="short"', 'data-type="numeric"')
            .replace("<textarea></textarea>", '<input class="cl-number" type="number">'),
        },
        mapping,
        objective,
      ),
    ).toThrow();
  });
});
