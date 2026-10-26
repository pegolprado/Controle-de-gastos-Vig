import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const SpeechCtor = (): (new () => SpeechRecognitionLike) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
};

export const speechSupported = () => SpeechCtor() !== null;

/** Reconhecimento de voz do próprio navegador (pt-BR). `onFinal` recebe a frase completa. */
export function useSpeech(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const cb = useRef(onFinal);
  useEffect(() => {
    cb.current = onFinal;
  });
  useEffect(() => () => rec.current?.stop(), []);

  const stop = useCallback(() => rec.current?.stop(), []);
  const start = useCallback(() => {
    const Ctor = SpeechCtor();
    if (!Ctor) return;
    rec.current?.stop();
    const r = new Ctor();
    r.lang = 'pt-BR';
    r.interimResults = true;
    r.continuous = false;
    let finalText = '';
    setTranscript('');
    r.onresult = (e) => {
      const parts = Array.from(e.results);
      const said = parts.map((p) => p[0]!.transcript).join(' ');
      setTranscript(said);
      if (parts.every((p) => p.isFinal)) finalText = said;
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast.error('Permita o uso do microfone para lançar por voz.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast.error('Não consegui ouvir. Tente de novo.');
    };
    r.onend = () => {
      setListening(false);
      if (finalText.trim()) cb.current(finalText.trim());
    };
    rec.current = r;
    setListening(true);
    r.start();
  }, []);

  return { supported: speechSupported(), listening, transcript, setTranscript, start, stop };
}
