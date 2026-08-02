"""Local voice endpoints — faster-whisper STT (CPU only, KARNA reliability lesson)
and edge-tts TTS (SAPI fallback). No cloud speech services, no Web Speech API.
"""

import io
import os
import tempfile
import threading

import numpy as np

_whisper = None
_whisper_lock = threading.Lock()


def _load_whisper():
    global _whisper
    if _whisper is not None:
        return _whisper
    with _whisper_lock:
        if _whisper is not None:
            return _whisper
        from faster_whisper import WhisperModel

        # device="cpu" on purpose: CTranslate2 CUDA is unreliable on this
        # machine (RTX 5070/Blackwell) — base.en int8 is ~1s for short commands.
        _whisper = WhisperModel("base.en", device="cpu", compute_type="int8")
        return _whisper


def transcribe_pcm16(data: bytes) -> str:
    """Transcribe 16 kHz mono int16 PCM bytes to text. Empty for silence/noise."""
    if not data or len(data) < 3200:  # < 100 ms
        return ""
    audio = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
    model = _load_whisper()
    segments, _ = model.transcribe(
        audio,
        language="en",
        vad_filter=True,
        condition_on_previous_text=False,
    )
    return "".join(s.text for s in segments).strip()


async def synthesize(text: str) -> bytes:
    """edge-tts neural voice -> MP3 bytes; pyttsx3/SAPI WAV fallback if offline."""
    try:
        import edge_tts

        tts = edge_tts.Communicate(text, "en-IN-NeerjaNeural", rate="+5%")
        buf = io.BytesIO()
        async for chunk in tts.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        if buf.getvalue():
            return buf.getvalue()
    except Exception:
        pass
    try:
        import pyttsx3

        engine = pyttsx3.init()
        fd, name = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        engine.save_to_file(text, name)
        engine.runAndWait()
        with open(name, "rb") as fh:
            data = fh.read()
        os.unlink(name)
        return data
    except Exception:
        return b""
