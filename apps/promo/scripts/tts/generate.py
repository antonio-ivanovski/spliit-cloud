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
import math
import subprocess
import numpy as np

for clip in request["clips"]:
    print(f"Speaking {clip['id']} with {request['voice']}…", flush=True)
    if not clip.get("segments"):
        samples, sample_rate = model.create(
            clip["text"], voice=request["voice"], speed=request["speed"], lang="en-us"
        )
        if len(samples) == 0:
            raise RuntimeError(f"Empty speech for {clip['id']}")
        sf.write(clip["file"], samples, sample_rate, subtype="PCM_16")
        continue
    parts = []
    timings = []
    frame = 0
    for index, segment in enumerate(clip["segments"]):
        rate = segment["rate"]
        if not math.isfinite(rate) or rate < 1:
            raise ValueError("Segment rate must be finite and at least one")
        samples, sample_rate = model.create(segment["text"], voice=request["voice"], speed=1, lang="en-us")
        active = np.flatnonzero(np.abs(samples) > 0.003)
        if not len(active):
            raise RuntimeError("Empty segment speech")
        margin = int(sample_rate * 0.02)
        samples = samples[max(0, active[0] - margin):min(len(samples), active[-1] + margin + 1)]
        source = Path(clip["file"]).with_name(f"{clip['id']}-{index}-source.wav")
        target = source.with_name(f"{clip['id']}-{index}-fast.wav")
        sf.write(source, samples, sample_rate, subtype="PCM_16")
        filters = []
        remaining = rate
        while remaining > 2:
            filters.extend(["apad=pad_dur=0.25", "atempo=2"])
            remaining /= 2
        filters.extend(["apad=pad_dur=0.25", f"atempo={remaining:.12f}", f"atrim=duration={len(samples) / sample_rate / rate:.12f}"])
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-af", ",".join(filters), str(target)], check=True)
        accelerated, sample_rate = sf.read(target, dtype="float32")
        # Frame-aligned segments keep audio and the deterministic wall on one clock.
        frames = max(1, math.ceil(len(accelerated) / sample_rate * request["fps"]))
        length = round(frames * sample_rate / request["fps"])
        accelerated = np.pad(accelerated, (0, max(0, length - len(accelerated))))[:length]
        parts.append(accelerated)
        timings.append({**segment, "startFrame": frame, "endFrame": frame + frames})
        frame += frames
    sf.write(clip["file"], np.concatenate(parts), sample_rate, subtype="PCM_16")
    Path(clip["file"]).with_suffix(".segments.json").write_text(json.dumps(timings, indent=2))
