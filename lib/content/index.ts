import { MockContentGenerator } from "./mock-generator.ts";
import type { ContentGenerator } from "./types.ts";

export * from "./types.ts";
export * from "./categories.ts";
export { MockContentGenerator, todayIso, addDays } from "./mock-generator.ts";
export { DEMO_RESTAURANT, EMPTY_PROFILE, TONE_OPTIONS } from "./demo.ts";

let cached: ContentGenerator | null = null;

/**
 * The single place the product decides who writes the content.
 *
 * Milestone 1 always returns the deterministic mock engine. When a real model
 * is wired up, this is the only function that changes: add an
 * `AiContentGenerator` implementing the same interface and pick between them
 * here (env flag, feature switch, per-account setting). No screen, hook or
 * component references a concrete generator, so nothing above this line moves.
 */
export function getContentGenerator(): ContentGenerator {
  cached ??= new MockContentGenerator();
  return cached;
}
