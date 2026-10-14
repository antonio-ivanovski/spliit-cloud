"""Offline Kokoro inference. Dependencies and model files are prepared separately."""
import json
import os
import sys
from pathlib import Path

# Opt out before importing ORT: its initialization can otherwise emit telemetry.
os.environ["ORT_DISABLE_TELEMETRY"] = "1"

import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

ort.disable_telemetry_events()

request = json.loads(Path(sys.argv[1]).read_text())
model = Kokoro(request["model"], request["voices"])
for clip in request["clips"]:
    print(f"Speaking {clip['id']} with {request['voice']}…", flush=True)
    samples, sample_rate = model.create(
        clip["text"], voice=request["voice"], speed=request["speed"], lang="en-us"
    )
    if len(samples) == 0:
        raise RuntimeError(f"Empty speech for {clip['id']}")
    sf.write(clip["file"], samples, sample_rate, subtype="PCM_16")
