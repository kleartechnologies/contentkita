import { AiContentGenerator } from "./ai-generator.ts";
import type { ContentGenerator } from "./types.ts";

export * from "./types.ts";
export * from "./categories.ts";
export { MockContentGenerator, todayIso, addDays } from "./mock-generator.ts";
export { AiContentGenerator, GenerationError } from "./ai-generator.ts";
export {
  DEMO_RESTAURANT,
  EMPTY_PROFILE,
  TONE_OPTIONS,
  LANGUAGE_OPTIONS,
  VISUAL_STYLE_OPTIONS,
  PLATFORM_OPTIONS,
  COPY_STYLE_OPTIONS,
  labelFor,
} from "./demo.ts";
export { buildSchedule, factsOf } from "./schedule.ts";

let cached: ContentGenerator | null = null;

/**
 * The single place the product decides who writes the content.
 *
 * The shipped product always uses the AI engine: it is the thing an owner is
 * paying for, and a silent fall back to templates when the provider is
 * unavailable would hand somebody a month of generic copy while telling them it
 * was written for their restaurant. When generation cannot run, the route says
 * so and the screen shows it.
 *
 * `MockContentGenerator` stays exported for tests and for the offline
 * verification scripts, which need a deterministic month without a network.
 */
export function getContentGenerator(): ContentGenerator {
  cached ??= new AiContentGenerator({
    // Imported lazily so this module stays importable from Node test runs,
    // where the Firebase SDK has no browser to initialise against.
    getToken: async () => {
      const { getAuthClient } = await import("../auth.ts");
      return getAuthClient().idToken();
    },
  });
  return cached;
}
