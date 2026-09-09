import "server-only";

import { ITEMS_SCHEMA } from "./prompt.ts";

/**
 * The OpenAI transport. Server-only, by construction.
 *
 * `server-only` makes an accidental import from a client component a build
 * error rather than a leaked key, and the key itself is read from a plain
 * `OPENAI_API_KEY` — never a `NEXT_PUBLIC_` variable, which Next would inline
 * into the browser bundle.
 *
 * Deliberately plain `fetch` rather than a provider SDK: one request shape is
 * all this product makes, and a dependency-free transport is easier to audit
 * for exactly the thing that matters here — that the secret never leaves the
 * server and the raw provider error never reaches a user.
 */

const DEFAULT_BASE = "https://api.openai.com/v1";

/**
 * Where requests go.
 *
 * Overridable so the end-to-end flow can be exercised against a local stub
 * during development without anyone holding the production key. In production
 * this is unset and the real API is used; nothing about the key handling
 * changes either way.
 */
function endpoint(): string {
  const base = process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, "");
  return `${base || DEFAULT_BASE}/chat/completions`;
}

/** Overridable so a model can be swapped without a code change. */
const DEFAULT_MODEL = "gpt-4.1";

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function aiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * A failure that has already been decided to be safe to surface.
 *
 * `code` is what the browser receives; the route maps it to Malay wording. The
 * provider's own message is logged server-side and never travels.
 */
export class AiError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.retryable = retryable;
  }
}

interface CompletionInput {
  system: string;
  user: string;
  /** Upper bound on the response. Sized by how many days were asked for. */
  maxTokens: number;
  signal?: AbortSignal;
}

/** How long a single attempt may take before it is abandoned. */
const ATTEMPT_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function once(
  input: CompletionInput,
  key: string,
): Promise<string> {
  const timeout = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      signal,
      body: JSON.stringify({
        model: aiModel(),
        // Enough variation to keep thirty hooks from rhyming, low enough that
        // the truth rules are still followed closely.
        temperature: 0.8,
        max_tokens: input.maxTokens,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "content_plan",
            strict: true,
            schema: ITEMS_SCHEMA,
          },
        },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    });
  } catch (error) {
    if (input.signal?.aborted) throw new AiError("cancelled", "Request cancelled");
    // A DNS failure, a dropped socket or our own timeout all land here.
    throw new AiError(
      "unavailable",
      `Provider unreachable: ${error instanceof Error ? error.name : "unknown"}`,
      true,
    );
  }

  if (!response.ok) {
    // Read the body for the server log only. It can contain provider detail and
    // must never be forwarded to the browser.
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new AiError("misconfigured", `Provider rejected the key (${response.status})`);
    }
    if (response.status === 400) {
      throw new AiError("bad_request", `Provider rejected the request: ${body.slice(0, 500)}`);
    }
    throw new AiError(
      isRetryableStatus(response.status) ? "unavailable" : "provider_error",
      `Provider returned ${response.status}: ${body.slice(0, 500)}`,
      isRetryableStatus(response.status),
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;

  if (choice?.finish_reason === "length") {
    // A truncated response is malformed JSON. Say so precisely rather than
    // letting the parser report a syntax error twenty lines later.
    throw new AiError("truncated", "Model response hit the token ceiling", true);
  }
  if (typeof content !== "string" || !content.trim()) {
    throw new AiError("empty", "Model returned no content", true);
  }

  return content;
}

/**
 * One completion, with bounded retries for transient failures only.
 *
 * A rejected key or a malformed request is never retried — retrying a 401 just
 * burns time and tells us nothing new.
 */
export async function complete(input: CompletionInput): Promise<unknown> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new AiError("misconfigured", "OPENAI_API_KEY is not set");

  let last: AiError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await once(input, key);
      try {
        return JSON.parse(raw);
      } catch {
        throw new AiError("malformed", "Model returned content that is not JSON", true);
      }
    } catch (error) {
      const failure =
        error instanceof AiError
          ? error
          : new AiError("unknown", error instanceof Error ? error.message : "unknown");

      if (!failure.retryable || attempt === MAX_ATTEMPTS) throw failure;
      last = failure;
      // Plain exponential backoff. No jitter: this is one user's single
      // generation, not a fleet stampeding a shared endpoint.
      await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** (attempt - 1)));
    }
  }

  throw last ?? new AiError("unknown", "Generation failed");
}
