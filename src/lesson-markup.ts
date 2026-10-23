/** Validate authored promises without changing saved HTML or executing its scripts. */
import { parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { lessonMarkupErrors } from "../assets/runtime/lesson-markup.mjs";
import type { MarkupElement } from "../assets/runtime/lesson-markup.mjs";

export function validateLessonMarkup(html: string, requireV2 = false): void {
  const elements: MarkupElement[] = [];
  const walk = (node: DefaultTreeAdapterTypes.Node, parent: number | null = null): void => {
    if ("tagName" in node) {
      const index = elements.length;
      elements.push({
        tag: node.tagName,
        attributes: Object.fromEntries(node.attrs.map((a) => [a.name, a.value])),
        parent,
      });
      parent = index;
      if ("content" in node) walk(node.content as DefaultTreeAdapterTypes.DocumentFragment, parent);
    }
    if ("childNodes" in node) for (const child of node.childNodes) walk(child, parent);
  };
  walk(parse(html));
  const errors = lessonMarkupErrors(elements, requireV2);
  if (errors.length) throw new Error(`Lesson markup: ${errors.join(" ")}`);
}
