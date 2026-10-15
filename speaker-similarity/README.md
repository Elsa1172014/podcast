# Speaker similarity (optional service)

Deploy this Python FastAPI service to a CPU host with sufficient memory (Render paid instance, VM, etc.). It downloads the SpeechBrain ECAPA-TDNN model at startup. Install ffmpeg for decoding MP3/WebM and run `uvicorn app:app --host 0.0.0.0 --port $PORT`.

Set `SPEAKER_SERVICE_SECRET` on this service. On the Vercel podcast project set:
- `SPEAKER_SIMILARITY_URL=https://your-speaker-service.example`
- `SPEAKER_SERVICE_SECRET` to the same secret.

The Vercel Next.js API route authenticates the signed-in user and forwards the two audio samples securely to this service; no service secret is exposed to the browser. If the service is not configured, the UI explicitly shows "غير مفعّل" and preserves the current acoustic comparison.

The cosine similarity is a **raw model score**, not a percentage probability of the same speaker. Validate and calibrate thresholds against consented Arabic speech recordings and multiple speakers before making identity claims. Do not store raw audio in logs. Never use for automated high-stakes decisions.
