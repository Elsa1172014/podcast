"""Optional, separately deployed speaker-identity similarity service.
Requires explicit consent for every sample. The returned cosine score is NOT a
calibrated identity probability or a forensic identification result.
"""
import base64
import io
import os
import tempfile
from pathlib import Path
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
import torch
import torchaudio
from speechbrain.inference.speaker import EncoderClassifier

app = FastAPI()
classifier = None

class Comparison(BaseModel):
    originalBase64: str = Field(min_length=1, max_length=16_000_000)
    generatedBase64: str = Field(min_length=1, max_length=16_000_000)

def embedding(payload: str):
    try:
        raw = base64.b64decode(payload, validate=True)
        if len(raw) > 12_000_000:
            raise ValueError("Audio too large")
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp:
            tmp.write(raw)
            filename = tmp.name
        try:
            wav, sr = torchaudio.load(filename)
        finally:
            Path(filename).unlink(missing_ok=True)
        wav = wav.mean(dim=0, keepdim=True)
        if sr != 16000:
            wav = torchaudio.functional.resample(wav, sr, 16000)
        seconds = wav.shape[1] / 16000
        if not 3 <= seconds <= 120:
            raise ValueError("Each audio sample must be between 3 and 120 seconds")
        with torch.inference_mode():
            return classifier.encode_batch(wav).flatten()
    except Exception as exc:
        raise HTTPException(422, detail=f"Invalid or unsupported audio sample: {type(exc).__name__}") from exc

@app.on_event("startup")
def load_model():
    global classifier
    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir="/tmp/speaker-model",
        run_opts={"device": "cpu"},
    )

@app.post("/compare")
def compare(body: Comparison, x_speaker_secret: str | None = Header(default=None)):
    expected = os.environ.get("SPEAKER_SERVICE_SECRET")
    if not expected or x_speaker_secret != expected:
        raise HTTPException(401, detail="Unauthorized")
    a, b = embedding(body.originalBase64), embedding(body.generatedBase64)
    score = torch.nn.functional.cosine_similarity(a.unsqueeze(0), b.unsqueeze(0)).item()
    return {
        "cosine_similarity": round(float(score), 4),
        "model": "speechbrain/spkrec-ecapa-voxceleb",
        "calibrated": False,
        "notice": "Similarity score only; not an identity probability or proof of identity."
    }
