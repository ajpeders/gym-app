import { ApiError } from './client';

// Turn a thrown error from an AI parse call into a message that names the
// actual failure instead of blaming the user's text. A network error
// (status 0) means the request never reached the server — the most common
// cause of a mysterious "try rephrasing" when the AI itself was never asked.
export function aiParseErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) {
      return "Can't reach the server — check your connection and that the app is pointed at the right API.";
    }
    if (e.status === 401) {
      return 'Your session expired — log in again.';
    }
    if (e.status === 502 || e.status === 503) {
      // The backend sends a specific reason ("Local AI isn't set up yet…",
      // "Ollama request failed…") — prefer it over the generic fallback. The
      // generic client placeholder is "Request failed (NNN)".
      if (e.message && !e.message.startsWith('Request failed')) return e.message;
      return 'AI provider unavailable — set up or check your AI provider in Settings.';
    }
    if (e.status === 504 || e.status === 408) {
      return 'The AI took too long to respond — try again, or a shorter input.';
    }
    // 400/422/500 and anything else: surface the server's own detail so the
    // real reason is visible rather than a blanket "try rephrasing".
    return e.message || "Couldn't parse that — try rephrasing.";
  }
  return "Couldn't parse that — try rephrasing.";
}
