"""Offline, sample-accurate mix: existing voice + ducked music + sparse cues."""
import json
import sys
import subprocess
from pathlib import Path
import numpy as np
import soundfile as sf

request = json.loads(Path(sys.argv[1]).read_text())
plan, narration = request['plan'], request['narration']
out = Path(request['directory'])
sr = 44100
count = round(plan['durationInFrames'] / plan['fps'] * sr)

def db(value):
    return 10 ** (value / 20)

def load(name):
    data, rate = sf.read(name, always_2d=True)
    if rate != sr:
        raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(name), '-ar', str(sr), '-ac', '2', '-f', 'f32le', '-'])
        return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    return data[:, :2]

def normalized(data):
    peak = np.max(np.abs(data))
    if not np.isfinite(data).all() or peak < 1e-6:
        raise ValueError('Empty or invalid audio')
    return data / peak

def place(target, data, frame, gain=1):
    start = round(frame / plan['fps'] * sr)
    length = min(len(data), len(target) - start)
    if start < 0 or length <= 0:
        raise ValueError('Cue is outside the composition')
    target[start:start + length] += data[:length] * gain

voice = np.zeros((count, 2))
# Smooth ducking around measured speech windows, including brief internal pauses.
duck = np.ones(count)
previous_end = 0
for beat, clip in zip(request['beats'], narration['clips'], strict=True):
    if beat['id'] != clip['id']:
        raise ValueError('Narration clip and scene IDs disagree')
    data = load(Path(request['voiceDirectory']) / clip['file'])
    start = round((beat['from'] + request['leadFrames']) / plan['fps'] * sr)
    scene_end = round((beat['from'] + beat['durationInFrames'] - request['resultHoldFrames']) / plan['fps'] * sr)
    if start < previous_end or start + len(data) > scene_end:
        raise ValueError(f"Narration overlaps another scene or its reading hold: {clip['id']}")
    previous_end = start + len(data)
    place(voice, data, beat['from'] + request['leadFrames'])
    start = round((beat['from'] + request['leadFrames']) / plan['fps'] * sr)
    end = min(count, start + round(clip['duration'] * sr))
    attack, release = round(.18 * sr), round(.45 * sr)
    left, right = max(0, start - attack), min(count, end + release)
    envelope = np.ones(right - left)
    envelope[:start-left] = np.linspace(1, db(plan['mix']['speechDuckDb']), start-left)
    envelope[start-left:end-left] = db(plan['mix']['speechDuckDb'])
    envelope[end-left:] = np.linspace(db(plan['mix']['speechDuckDb']), 1, right-end)
    duck[left:right] = np.minimum(duck[left:right], envelope)

music = load(out / 'music.wav')
music_rms = np.sqrt(np.mean(music ** 2))
if not np.isfinite(music).all() or music_rms < 1e-6:
    raise ValueError('Empty or invalid music')
# Set a consistent bed RMS; isolated transients must not make the whole bed inaudible.
music = music / music_rms
if len(music) < count:
    raise ValueError('Music must cover the whole composition; regenerate at the correct duration')
fade = np.ones(count)
intro = min(count, round(plan['mix']['fadeInSeconds'] * sr))
outro = min(count, round(plan['mix']['fadeOutSeconds'] * sr))
fade[:intro] *= np.linspace(0, 1, intro)
fade[-outro:] *= np.linspace(1, 0, outro)
background = music[:count] * (duck * fade * db(plan['mix']['musicDb']))[:, None]

def tap():
    t = np.arange(round(.12 * sr)) / sr
    signal = np.sin(2*np.pi*660*t) * np.exp(-t*55) + .25*np.sin(2*np.pi*990*t)*np.exp(-t*70)
    signal *= np.minimum(1, t/.004)
    return normalized(np.column_stack([signal, signal]))

def chime():
    length = round(1.1 * sr)
    signal = np.zeros(length)
    for frequency, offset in [(523.25, 0), (783.99, .14)]:
        begin = round(offset * sr)
        t = np.arange(length-begin) / sr
        tone = (np.sin(2*np.pi*frequency*t) + .18*np.sin(2*np.pi*2*frequency*t)) * np.exp(-t*6)
        tone *= np.minimum(1, t/.008)
        signal[begin:] += tone
    return normalized(np.column_stack([signal, signal]))

sounds = {'tap': tap(), 'chime': chime(), 'transition': normalized(load(out/'transition-source.wav'))}
# Trim the generated whoosh to a restrained half second with click-free edges.
window = min(round(.6*sr), len(sounds['transition']))
energy = np.mean(sounds['transition'] ** 2, axis=1)
rolling = np.convolve(energy, np.ones(window)/window, mode='valid') if window < 100 else (np.cumsum(np.r_[0, energy])[window:] - np.cumsum(np.r_[0, energy])[:-window])/window
start = int(np.argmax(rolling))
sounds['transition'] = sounds['transition'][start:start+window].copy()
sounds['transition'] *= np.sin(np.linspace(0, np.pi, len(sounds['transition'])))[:, None]
for kind, data in sounds.items():
    sf.write(out/f'{kind}.wav', data, sr, subtype='PCM_16')
for cue in plan['cues']:
    place(background, sounds[cue['kind']], cue['frame'], db(plan['mix']['effectDb']))
combined = voice + background
peak = np.max(np.abs(combined))
if peak > db(plan['mix']['peakCeilingDb']):
    combined *= db(plan['mix']['peakCeilingDb']) / peak
sf.write(out/'mix.wav', combined, sr, subtype='PCM_16')
sf.write(out/'background.wav', background, sr, subtype='PCM_16')
print(f'Mixed {count/sr:.2f}s; peak {20*np.log10(np.max(np.abs(combined))):.2f} dBFS', flush=True)
