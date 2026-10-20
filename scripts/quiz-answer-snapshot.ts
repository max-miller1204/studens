/** Browser-serializable answer snapshot shared by authoring submit/reload checks. */
export function quizAnswerSnapshot(form: Element) {
  const own = (selector: string) =>
    [
      ...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        selector,
      ),
    ].filter(
      (el) =>
        el.closest(".cl-q") &&
        !el.closest(".cl-q-verdict, .cl-card-panel, .cl-expected, .cl-learner-marks"),
    );
  return {
    checked: own("input:checked").map((el) => el.value),
    text: own("input[type=text], input:not([type]), textarea").map((el) => el.value),
    selects: own("select").map((el) => el.value),
  };
}
