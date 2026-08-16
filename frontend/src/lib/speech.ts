/**
 * Speaking instead of typing.
 *
 * Logging a set with chalky hands and a phone on the floor is the case this is
 * for, and the app already has the hard half — a parser that turns "bench
 * three by eight at sixty" into sets. All that's missing is the words.
 *
 * Web Speech is used where the browser has it (Chrome, Edge, Android Chrome,
 * Safari 16+): recognition runs on the platform, nothing is recorded by us, and
 * the transcript goes straight into the existing parse pipeline. Where it isn't
 * available — Firefox, and Expo Go, which has no speech module — `isAvailable`
 * is false and the button simply doesn't appear, rather than a mic that does
 * nothing.
 *
 * On-device recognition in a native build is the same seam with a different
 * backend, which is why the callers only ever see start/stop/transcript.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isAvailable(): boolean {
  return recognitionClass() !== null;
}

export interface Listener {
  stop: () => void;
}

/**
 * Listen once and hand back what was said.
 *
 * `onTranscript` fires with the final transcript; `onError` with a short
 * reason. Both are optional — a caller that only wants the words shouldn't
 * have to handle a state machine.
 */
export function listen(handlers: {
  onTranscript: (text: string) => void;
  onError?: (reason: string) => void;
  onEnd?: () => void;
}): Listener | null {
  const Recognition = recognitionClass();
  if (!Recognition) {
    handlers.onError?.("This browser can't do speech recognition.");
    return null;
  }

  const recognition = new Recognition();
  recognition.lang = 'en-GB';
  // One utterance: "bench three by eight at sixty" and stop. Continuous
  // listening in a gym picks up everyone else's conversation.
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (event: unknown) => {
    const results = (event as { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }).results;
    const text = results?.[0]?.[0]?.transcript?.trim();
    if (text) handlers.onTranscript(text);
  };
  recognition.onerror = (event: unknown) => {
    const code = (event as { error?: string }).error ?? 'unknown';
    handlers.onError?.(
      code === 'not-allowed'
        ? 'Microphone access was refused.'
        : `Speech recognition failed (${code}).`,
    );
  };
  recognition.onend = () => handlers.onEnd?.();

  recognition.start();
  return { stop: () => recognition.stop() };
}
