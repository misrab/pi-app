import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the Web Speech API (not in the standard DOM lib).
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResultItem {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResultItem;
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface Options {
  // Called as speech is recognized. `isFinal` marks a settled utterance.
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

interface SpeechRecognition {
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => void;
}

/**
 * Thin wrapper over the browser's Web Speech API. Uses the device's native
 * recognition engine — no third-party service, no cost. `continuous: false`
 * keeps behavior consistent across iOS/Android (auto-stops on silence).
 */
export function useSpeechRecognition({ onTranscript, onError }: Options): SpeechRecognition {
  const [supported] = useState(() => getCtor() !== null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // Keep callbacks fresh without re-creating the recognition instance.
  const cbRef = useRef({ onTranscript, onError });
  cbRef.current = { onTranscript, onError };

  useEffect(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let text = "";
      let isFinal = false;
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        text += r[0].transcript;
        if (r.isFinal) isFinal = true;
      }
      cbRef.current.onTranscript(text.trim(), isFinal);
    };
    rec.onerror = (e) => {
      setListening(false);
      // "aborted"/"no-speech" are benign (user stopped or stayed silent).
      if (e.error !== "aborted" && e.error !== "no-speech") {
        cbRef.current.onError?.(e.error);
      }
    };
    rec.onend = () => setListening(false);

    recRef.current = rec;
    return () => {
      rec.onresult = rec.onerror = rec.onend = null;
      rec.abort();
      recRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    const rec = recRef.current;
    if (!rec || listening) return;
    try {
      rec.start();
      setListening(true);
    } catch {
      // start() throws if already started; ignore.
    }
  }, [listening]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  return { supported, listening, start, stop };
}
