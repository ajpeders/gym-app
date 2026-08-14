/**
 * Turn a raw provider error into something you can act on.
 *
 * The coach is a tool-calling agent, and Ollama rejects a tool request outright
 * for any model that doesn't support tools — Gemma being the common case on a
 * homelab box. All that reaches the app is "ollama returned HTTP 400", which
 * says nothing about the one thing you'd need to change.
 */

// Families that cannot do tool calling, so the coach can never work on them —
// even though they parse workout notes perfectly well.
const NO_TOOL_SUPPORT = [/^gemma/i, /^llava/i, /^phi3/i, /embed/i];

export function modelSupportsTools(model: string | null | undefined): boolean {
  const name = (model ?? '').split('/').pop() ?? '';
  return !NO_TOOL_SUPPORT.some((re) => re.test(name));
}

export function explainCoachError(raw: string, model: string | null | undefined): string {
  const isBadRequest = /HTTP 400|status 400/i.test(raw);
  if (isBadRequest && model && !modelSupportsTools(model)) {
    return (
      `"${model}" can't be used for the spotter — it doesn't support tool calling, ` +
      `which it needs to read and log your training. ` +
      `Pick a model that does (Qwen or Llama) in Settings → AI Provider. ` +
      `It still works fine for parsing workout notes.`
    );
  }
  if (isBadRequest) {
    return (
      `Your Ollama server rejected the request${model ? ` for "${model}"` : ''}. ` +
      `The usual cause is a model that doesn't support tool calling — try a Qwen ` +
      `or Llama model in Settings → AI Provider.`
    );
  }
  return raw;
}
