import type { PracticeKey } from "./practice.mjs";
export interface FadedConfig {
  version: 1;
  title: string;
  steps: { title: string; principle: string }[];
  rounds: {
    situation: string;
    steps: {
      prompt: string;
      solution: string;
      response: ({ type: "term" | "numeric" } & PracticeKey) | { type: "compare" };
    }[];
  }[];
}
export declare function validateFaded(value: unknown): FadedConfig;
export declare function initFaded(root: ParentNode): void;
