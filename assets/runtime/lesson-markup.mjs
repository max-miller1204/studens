/** V2 is an authored promise. Unmarked saved documents keep their existing hooks. */
export function lessonMarkupErrors(elements, requireV2 = false) {
  const has = (element, name) => (element.attributes.class ?? "").split(/\s+/).includes(name);
  const marked = elements.filter((element) => "data-cl-ui" in element.attributes);
  if (!marked.length)
    return requireV2 ? ['New lessons need data-cl-ui="2" on the lesson root.'] : [];
  const errors = [];
  if (marked.length !== 1) errors.push("Use exactly one lesson UI contract marker.");
  const root = marked[0];
  if (elements.filter((element) => "data-cl-content" in element.attributes).length !== 1)
    errors.push("V2 needs exactly one data-cl-content root.");
  if (root.attributes["data-cl-ui"] !== "2") errors.push("Unsupported lesson UI contract version.");
  if (
    root.tag !== "main" ||
    !("data-cl-content" in root.attributes) ||
    !has(root, "cl-lesson-shell")
  )
    errors.push('Contract v2 needs <main class="cl-lesson-shell" data-cl-content data-cl-ui="2">.');
  const inside = (element, ancestor) => {
    for (let index = element.parent; index !== null; index = elements[index].parent)
      if (elements[index] === ancestor) return true;
    return false;
  };
  for (const [index, element] of elements.entries()) {
    if (element !== root && !inside(element, root)) {
      if (has(element, "cl-quiz") || has(element, "cl-practice") || has(element, "cl-q"))
        errors.push("Assessment hooks must be inside the v2 lesson root.");
      continue;
    }
    if (has(element, "cl-quiz") || has(element, "cl-practice")) {
      if (element.tag !== "form" || !has(element, "cl-card-box"))
        errors.push("V2 quiz and practice forms need cl-card-box.");
      if (
        !elements.some(
          (child) => child.parent === index && child.tag === "ol" && has(child, "cl-questions"),
        )
      )
        errors.push("V2 quiz and practice forms need a direct ol.cl-questions.");
    }
    if (
      element.tag === "li" &&
      element.parent !== null &&
      has(elements[element.parent], "cl-questions") &&
      !has(element, "cl-q")
    )
      errors.push("V2 question list items need cl-q.");
    if (has(element, "cl-q")) {
      const list = elements[element.parent];
      if (element.tag !== "li" || !list || !has(list, "cl-questions"))
        errors.push("V2 questions need li.cl-q inside ol.cl-questions.");
      if (!elements.some((child) => inside(child, element) && has(child, "cl-q-prompt")))
        errors.push(
          `V2 question ${element.attributes["data-question-id"] ?? "(missing id)"} needs .cl-q-prompt.`,
        );
    }
    if (["input", "textarea", "select"].includes(element.tag)) {
      const type = (element.attributes.type ?? "text").toLowerCase();
      if (
        element.tag === "input" &&
        ![
          "text",
          "search",
          "email",
          "url",
          "tel",
          "password",
          "number",
          "date",
          "datetime-local",
          "month",
          "week",
          "time",
          "radio",
          "checkbox",
        ].includes(type)
      )
        continue;
      const name =
        element.tag === "input" && ["radio", "checkbox"].includes(type) ? "cl-check" : "cl-input";
      if (!has(element, name)) errors.push(`V2 ${element.tag} controls need ${name}.`);
    }
    if (element.tag === "details" && !has(element, "cl-disclosure"))
      errors.push("V2 details need cl-disclosure.");
    if (
      ["cl-stepper", "cl-faded"].some((name) => has(element, name)) &&
      !has(element, "cl-card-box")
    )
      errors.push("V2 local teaching widgets need cl-card-box.");
  }
  return [...new Set(errors)];
}

/** Include inert gates so missing hooks fail before a learner releases teaching. */
export function lessonMarkupElements(root) {
  const elements = [];
  const walk = (node, parent = null) => {
    if (node.nodeType !== 1) return;
    const index = elements.length;
    elements.push({
      tag: node.localName,
      attributes: Object.fromEntries([...node.attributes].map((a) => [a.name, a.value])),
      parent,
    });
    for (const child of (node.localName === "template" ? node.content : node).children)
      walk(child, index);
  };
  walk(root);
  return elements;
}
