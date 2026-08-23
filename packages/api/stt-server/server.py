#!/usr/bin/env python3
"""
Local faster-whisper STT server for Taro's realtime pipeline.

Taro's API forwards the meeting's raw audio here over a websocket; this server
runs voice-activity detection + faster-whisper (via RealtimeSTT) locally and
sends finalized utterances back as JSON. 100% local, 100% free, no API keys.

Protocol:
  client -> server : binary frames of s16le 16 kHz mono PCM
  server -> client : {"text": "<finalized utterance>"}

Run:
  pip install -r requirements.txt
  python server.py                 # defaults: model=small.en, port=8012
  STT_MODEL=base.en STT_PORT=8012 python server.py
Then in the Taro API .env:  STT_WS_URL=ws://localhost:8012
"""

import asyncio
import json
import os
import threading

import websockets
from RealtimeSTT import AudioToTextRecorder

MODEL = os.getenv("STT_MODEL", "small.en")
PORT = int(os.getenv("STT_PORT", "8012"))


def build_recorder() -> AudioToTextRecorder:
    # use_microphone=False: we feed audio in ourselves via feed_audio().
    # No realtime partials, we only want clean finalized utterances for the
    # wake-word / command logic. VAD handles silence, so muted mics produce
    # nothing (no "and and and" hallucinations).
    return AudioToTextRecorder(
        model=MODEL,
        language="en",
        use_microphone=False,
        spinner=False,
        enable_realtime_transcription=False,
        post_speech_silence_duration=0.6,
        min_length_of_recording=0.3,
        print_transcription_time=False,
        level=0,
    )


def main() -> None:
    print(f"[stt] loading faster-whisper model '{MODEL}' (first run downloads it)...")
    recorder = build_recorder()
    print(f"[stt] model ready. listening on ws://0.0.0.0:{PORT}")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    transcripts: "asyncio.Queue[str]" = asyncio.Queue()
    clients = set()

    def transcription_loop() -> None:
        # recorder.text() blocks until VAD marks the end of an utterance and
        # faster-whisper transcribes it. Feed happens from the ws handler.
        while True:
            text = recorder.text()
            if text and text.strip():
                loop.call_soon_threadsafe(transcripts.put_nowait, text.strip())

    threading.Thread(target=transcription_loop, daemon=True).start()

    async def broadcaster() -> None:
        while True:
            text = await transcripts.get()
            print(f"[stt] -> {text!r}")
            payload = json.dumps({"text": text})
            for ws in list(clients):
                try:
                    await ws.send(payload)
                except Exception:
                    pass

    async def handler(ws) -> None:
        clients.add(ws)
        print("[stt] client connected")
        try:
            async for msg in ws:
                if isinstance(msg, (bytes, bytearray)):
                    recorder.feed_audio(bytes(msg))
        except Exception as e:
            print(f"[stt] client error: {e}")
        finally:
            clients.discard(ws)
            print("[stt] client disconnected")

    async def run() -> None:
        async with websockets.serve(handler, "0.0.0.0", PORT, max_size=None):
            await broadcaster()

    try:
        loop.run_until_complete(run())
    except KeyboardInterrupt:
        print("\n[stt] shutting down")


if __name__ == "__main__":
    main()
