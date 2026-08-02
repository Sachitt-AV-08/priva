import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../engine/apiClient";

export interface SpeechResult {
  transcript: string;
  error?: string;
}

export interface UseSpeechReturn {
  listening: boolean;
  busy: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<SpeechResult | null>;
  cancel: () => void;
  toggle: () => void;
}

const TARGET_RATE = 16000;
const MAX_SAMPLES = TARGET_RATE * 15; // 15s cap
const MAX_SECONDS = 30; // auto-stop recording

/**
 * Captures microphone audio (16 kHz mono int16 PCM) and sends it to PRIVA's
 * local faster-whisper endpoint — the same STT pipeline as the KARNA voice
 * agent, minus the unreliable CUDA/float16 path (CPU int8 here).
 *
 * Capture uses MediaRecorder (opus/webm) + decodeAudioData instead of a live
 * WebAudio graph. A live graph (getUserMedia -> AudioContext ->
 * ScriptProcessorNode) caused native renderer crashes on some Windows audio
 * stacks, which blanked the whole window. MediaRecorder keeps no audio graph
 * alive, and the renderer auto-reloads if it ever dies anyway.
 */
export function useSpeech(onResult?: (text: string) => void): UseSpeechReturn {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  // Never setState after unmount (React 18 would drop the tree silently).
  const safeSet = (setter: React.Dispatch<React.SetStateAction<any>>, value: unknown) => {
    if (mountedRef.current) setter(value);
  };

  const transcribeBlob = useCallback(async (blob: Blob): Promise<SpeechResult | null> => {
    let samples: Float32Array;
    let srcRate: number;
    try {
      const ctx = new AudioContext();
      try {
        const audioBuf = await ctx.decodeAudioData(await blob.arrayBuffer());
        samples = audioBuf.getChannelData(0);
        srcRate = audioBuf.sampleRate || ctx.sampleRate;
      } finally {
        await ctx.close().catch(() => undefined);
      }
    } catch {
      safeSet(setError, "Could not decode the recording");
      return { transcript: "", error: "decode failed" };
    }
    if (!samples || samples.length < TARGET_RATE * 0.1) return null; // < 100ms

    safeSet(setBusy, true);
    try {
      // Manual downsample device rate -> 16 kHz (linear interpolation per block).
      const ratio = srcRate / TARGET_RATE;
      const outputLength = Math.min(MAX_SAMPLES, Math.floor(samples.length / ratio));
      const out = new Float32Array(outputLength);
      for (let written = 0; written < outputLength; written++) {
        const sourcePosition = written * ratio;
        const left = Math.floor(sourcePosition);
        const right = Math.min(left + 1, samples.length - 1);
        const mix = sourcePosition - left;
        out[written] = samples[left] * (1 - mix) + samples[right] * mix;
      }
      if (outputLength < TARGET_RATE * 0.1) return null;
      const pcm = new Int16Array(outputLength);
      for (let i = 0; i < outputLength; i++) {
        const s = Math.max(-1, Math.min(1, out[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      // Hard timeout so a stuck backend can never leave the UI in "busy".
      const ctrl = new AbortController();
      requestControllerRef.current = ctrl;
      const timer = setTimeout(() => ctrl.abort(), 60000);
      try {
        const data = await api.speechToText(pcm.buffer as ArrayBuffer, ctrl.signal);
        const text: string = data.text ?? "";
        if (text.trim() && onResultRef.current) onResultRef.current(text);
        return { transcript: text };
      } finally {
        clearTimeout(timer);
        if (requestControllerRef.current === ctrl) requestControllerRef.current = null;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        safeSet(setError, "STT timed out — is the PRIVA backend running?");
      } else {
        safeSet(setError, "STT request failed — is the PRIVA backend running?");
      }
      return { transcript: "", error: String(e) };
    } finally {
      safeSet(setBusy, false);
    }
  }, []);

  const stop = useCallback(async (): Promise<SpeechResult | null> => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const chunks = chunksRef.current;
    if (!recorder || recorder.state === "inactive") {
      chunksRef.current = [];
      safeSet(setListening, false);
      return null;
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 10000);
      recorder.onstop = () => {
        clearTimeout(timeout);
        resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
      };
      try {
        recorder.stop();
      } catch {
        clearTimeout(timeout);
        resolve(null);
      }
    });
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    safeSet(setListening, false);
    if (!blob || blob.size === 0) return null;
    return transcribeBlob(blob);
  }, [transcribeBlob]);

  const start = useCallback(async () => {
    if (busy) return;
    safeSet(setError, null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      recorder.start();
      safeSet(setListening, true);
      stopTimerRef.current = setTimeout(() => {
        void stop().catch(() => undefined);
      }, MAX_SECONDS * 1000);
    } catch {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      safeSet(setError, "Microphone access denied — check mic permissions");
    }
  }, [busy, stop]);

  const toggle = useCallback(() => {
    if (listening) void stop().catch(() => undefined);
    else void start().catch(() => undefined);
  }, [listening, start, stop]);

  const cancel = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try { recorder.stop(); } catch { /* noop */ }
    }
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    safeSet(setListening, false);
    safeSet(setBusy, false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestControllerRef.current?.abort();
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch { /* noop */ }
      }
      recorderRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return { listening, busy, error, start, stop, cancel, toggle };
}
