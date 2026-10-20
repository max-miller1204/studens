export interface TraceStep {
  title: string;
  state: string;
  transition: string;
  explanation: string;
  mermaid?: string;
}
export type StepperConfig = { version: 1; title: string } & (
  | {
      domain: "process" | "state-machine" | "pipeline" | "algorithm";
      mode: "trace";
      steps: TraceStep[];
    }
  | { domain: "algorithm"; mode: "prefix-sum"; values: number[] }
);
export declare function validateStepper(config: unknown): StepperConfig;
export declare function parseStepperInput(input: string): number[];
export declare function prefixSumSteps(values: number[]): TraceStep[];
export declare function initSteppers(root: ParentNode): void;
