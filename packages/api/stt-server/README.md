# Taro faster-whisper STT server

A local, free, higher-accuracy replacement for Taro's in-process sherpa-onnx
recognizer. Runs faster-whisper (via RealtimeSTT) with voice-activity detection
so silence and muted mics produce no output. Nothing leaves your machine.

## Setup (one time)

```bash
cd packages/api/stt-server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Run (a dedicated terminal, alongside the API)

```bash
source .venv/bin/activate
python server.py            # model=small.en on ws://localhost:8012
# faster/lighter:  STT_MODEL=base.en python server.py
# most accurate:   STT_MODEL=medium.en python server.py
```

The first run downloads the model (a few hundred MB). Wait for
`[stt] model ready` before starting a meeting.

## Point Taro at it

In the Taro API `.env`:

```
STT_WS_URL=ws://localhost:8012
```

Restart the API. Its boot log will show `Realtime ASR: ready (faster-whisper
server at ws://localhost:8012)`. Unset `STT_WS_URL` to go back to the free
built-in sherpa-onnx model.

## Notes

- Handles one meeting at a time (fine for a single workspace / demo).
- `small.en` is a good CPU balance; drop to `base.en` if it lags, raise to
  `medium.en` for maximum accuracy if your machine keeps up.
