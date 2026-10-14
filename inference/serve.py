"""Thin adapter for the user's unmodified SenseVoice model.py.

The website, audio capture, API orchestration and visual effects are TypeScript.
Only the existing PyTorch model runs in this inference sidecar. WAV decoding uses
the standard library, avoiding torchaudio's optional FFmpeg/TorchCodec backend.
"""
import io
import json
import os
import re
import sys
import threading
import time
import wave
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

sys.path.insert(0, os.environ.get("SENSEVOICE_SOURCE", "/opt/SenseVoice"))
from model import SenseVoiceSmall  # noqa: E402 — original local SenseVoice source

lock = threading.Lock()
model = None
model_kwargs = {}
log_transcripts = os.environ.get("LOG_TRANSCRIPTS", "false") == "true"


def emit(event, level="info", **fields):
    print(json.dumps({"time": datetime.now(timezone.utc).isoformat(), "level": level,
                      "service": "sensevoice", "event": event, **fields}, ensure_ascii=False), flush=True)


@asynccontextmanager
async def lifespan(_app):
    global model, model_kwargs
    started = time.perf_counter()
    emit("model.loading", device="cpu", threads=int(os.environ.get("INFERENCE_THREADS", "4")))
    torch.set_num_threads(int(os.environ.get("INFERENCE_THREADS", "4")))
    model, model_kwargs = SenseVoiceSmall.from_pretrained(
        model=os.environ.get("SENSEVOICE_MODEL", "/models"),
        device="cpu",
        disable_update=True,
    )
    model.eval()
    emit("model.ready", loadMs=round((time.perf_counter() - started) * 1000))
    yield
    emit("model.shutdown")


app = FastAPI(title="Aura · local SenseVoice inference", lifespan=lifespan)


@app.get("/health")
def health():
    return {"ready": model is not None, "model": "SenseVoiceSmall", "device": "cpu"}


def infer(samples, lang, use_itn, trace):
    queued_at = time.perf_counter()
    try:
        with lock, torch.inference_mode():
            started = time.perf_counter()
            queue_ms = round((started - queued_at) * 1000)
            emit("inference.started", **trace, queueMs=queue_ms, samples=len(samples), language=lang)
            result, _metadata = model.inference(
                data_in=[samples], key=["microphone"], language=lang,
                use_itn=use_itn, ban_emo_unk=False, fs=16000, **model_kwargs,
            )
            inference_ms = round((time.perf_counter() - started) * 1000)
        raw = "".join(item["text"] for item in result)
        tags = re.findall(r"<\|([^|]+)\|>", raw)
        text = re.sub(r"<\|[^|]*\|>", "", raw).strip()
        emit("inference.completed", **trace, tags=tags, textLength=len(text),
             inferenceMs=inference_ms, queueMs=queue_ms, **({"text": text} if log_transcripts else {}))
        return {"result": [{"raw_text": item["text"]} for item in result],
                "timings": {"inferenceMs": inference_ms, "queueMs": queue_ms}}
    except Exception as exc:
        emit("inference.failed", level="error", **trace, errorType=type(exc).__name__, reason=str(exc))
        raise


@app.post("/api/v1/asr")
async def recognize(
    request: Request, files: UploadFile = File(...), lang: str = Form("auto"),
    use_itn: bool = Form(True),
):
    trace = {"requestId": request.headers.get("x-request-id", "untracked")[:64],
             "sessionId": request.headers.get("x-aura-session", "untracked")[:64],
             "sequence": request.headers.get("x-aura-sequence", "0")[:7]}
    if lang not in {"auto", "zh", "en", "yue", "ja", "ko"}:
        raise HTTPException(400, "Unsupported language")
    raw = await files.read(160_045)
    await files.close()
    if len(raw) > 160_044:
        raise HTTPException(413, "Audio must be at most five seconds")
    try:
        with wave.open(io.BytesIO(raw), "rb") as audio:
            if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (16000, 1, 2):
                raise ValueError("Expected PCM16 mono 16 kHz WAV")
            samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768
        if not 1600 <= len(samples) <= 80000:
            raise ValueError("Audio must be 0.1–5 seconds")
    except (wave.Error, EOFError, ValueError) as exc:
        emit("audio.rejected", level="warn", **trace, reason=str(exc), audioBytes=len(raw))
        raise HTTPException(400, "Invalid PCM16 mono 16 kHz WAV") from exc
    rms = float(np.sqrt(np.mean(samples ** 2)))
    emit("audio.decoded", **trace, audioBytes=len(raw), sampleRate=16000, durationMs=len(samples) / 16,
         rms=round(rms, 6), peak=round(float(np.max(np.abs(samples))), 6),
         dbfs=round(20 * float(np.log10(max(rms, 0.000001))), 1))
    return await run_in_threadpool(infer, samples, lang, use_itn, trace)
