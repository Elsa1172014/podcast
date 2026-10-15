# Speaker similarity (optional service)

Deploy this Python FastAPI service to a CPU host with sufficient memory (Render paid instance, VM, etc.). It downloads the SpeechBrain ECAPA-TDNN model at startup. Install ffmpeg for decoding MP3/WebM and run `uvicorn app:app --host 0.0.0.0 --port $PORT`.

Set `SPEAKER_SERVICE_SECRET` on this service. On the existing Node worker set:
- `SPEAKER_SIMILARITY_URL=https://your-speaker-service.example`
- `SPEAKER_SERVICE_SECRET` to the same secret.

The existing Vercel app proxies authenticated requests to its existing worker; no new public key is needed in Vercel. If the service is not configured, the UI explicitly shows "غير مفعّل" and preserves the current acoustic comparison.

The cosine similarity is a **raw model score**, not a percentage probability of the same speaker. Validate and calibrate thresholds against consented Arabic speech recordings and multiple speakers before making identity claims. Do not store raw audio in logs. Never use for automated high-stakes decisions.
