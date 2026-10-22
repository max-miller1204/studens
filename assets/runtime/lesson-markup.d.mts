export interface MarkupElement {
  tag: string;
  attributes: Record<string, string>;
  parent: number | null;
}
export function lessonMarkupErrors(elements: MarkupElement[], requireV2?: boolean): string[];
export function lessonMarkupElements(root: Element): MarkupElement[];
