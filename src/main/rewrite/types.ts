import type { RewritePreset, RewriteProvider } from '@shared/contracts.js';

export interface ParsedDelta {
  readonly kind: 'delta';
  readonly text: string;
}

export interface ParsedResult {
  readonly kind: 'result';
  readonly text: string;
  readonly costUsd: number | null;
  readonly durationMs: number;
  readonly isError: boolean;
}

export type ParsedMessage = ParsedDelta | ParsedResult;

export interface RewriteOutputParser {
  write(chunk: string): ParsedMessage[];
  end(): ParsedMessage[];
}

export interface AdapterOptions {
  readonly preset: RewritePreset;
  readonly model: string;
  readonly maxBudgetUsd: number | null;
}

/** Provider-specific mechanics. Process lifetime and terminal events stay in the coordinator. */
export interface RewriteAdapter {
  readonly provider: RewriteProvider;
  readonly label: string;
  resolvePath(configuredPath: string): Promise<string | null>;
  buildArgs(options: AdapterOptions): string[];
  createParser(): RewriteOutputParser;
  workingDirectory(binary: string): string | undefined;
  resetPathCache(): void;
}
