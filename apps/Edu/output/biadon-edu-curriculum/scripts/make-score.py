"""Original, deterministic plucked-key score. No recordings or external music."""
from pathlib import Path
import wave
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RATE = 22050
DURATION = 100
rng = np.random.default_rng(26026)
mix = np.zeros((RATE * DURATION, 2), dtype=np.float64)


def note(at, midi, length=1.5, gain=0.12, pan=0.0):
    size = int(length * RATE)
    t = np.arange(size) / RATE
    freq = 440 * 2 ** ((midi - 69) / 12)
    attack = 1 - np.exp(-t * 110)
    tone = (np.sin(2 * np.pi * freq * t) * np.exp(-t * 3.2)
            + .23 * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t * 6)
            + .06 * np.sin(2 * np.pi * freq * 3 * t) * np.exp(-t * 8))
    tone *= attack * gain
    start = round(at * RATE)
    n = min(size, len(mix) - start)
    if n <= 0:
        return
    mix[start:start+n, 0] += tone[:n] * (1 - pan) / 2
    mix[start:start+n, 1] += tone[:n] * (1 + pan) / 2
    # A short dry room reflection gives the paper-and-desk graphics a small space.
    echo = start + int(.115 * RATE)
    ne = min(n, len(mix) - echo)
    if ne > 0:
        mix[echo:echo+ne, 0] += tone[:ne] * .085
        mix[echo:echo+ne, 1] += tone[:ne] * .10


# Sparse original four-bar phrase, 96 BPM. No stock-loop or AI voice.
beat = 60 / 96
chords = [(50, 57, 62, 66), (47, 54, 59, 62), (43, 50, 55, 59), (45, 52, 57, 61)]
for bar in range(40):
    chord = chords[bar % 4]
    at = bar * 4 * beat
    note(at, chord[0], 2.6, .18, -.1)
    for offset, pitch, gain, pan in [(0, chord[2], .16, -.35), (1.5, chord[3], .13, .35),
                                    (2.5, chord[1]+12, .10, -.2), (3.0, chord[2], .09, .2)]:
        note(at + offset * beat, pitch, 1.9, gain, pan)
    # Brushed ticks enter late and remain quiet under the on-screen reading.
    for offset in [1, 3]:
        start = round((at + offset * beat) * RATE)
        n = min(int(.045 * RATE), len(mix) - start)
        if n > 0:
            t = np.arange(n) / RATE
            noise = rng.normal(0, 1, n)
            brush = (noise - np.roll(noise, 1)) * np.exp(-t*110) * .008
            mix[start:start+n] += brush[:, None]

# Quiet paper-like transition cues, deliberately below the musical foreground.
for at in [8, 18, 26, 35, 45, 54, 63, 79, 90]:
    start = round((at + .12) * RATE)
    n = int(.21 * RATE)
    t = np.arange(n) / RATE
    noise = rng.normal(0, 1, n)
    cue = np.convolve(noise, np.ones(8)/8, mode='same') * np.sin(np.pi*t/.21)**2 * .015
    mix[start:start+n, 0] += cue
    mix[start:start+n, 1] += cue * .8

fade_in = np.minimum(np.arange(len(mix)) / (RATE * 1.3), 1)
fade_out = np.clip((len(mix) - 1 - np.arange(len(mix))) / (RATE * 4.2), 0, 1)
mix *= (fade_in * fade_out)[:, None]
peak = np.max(np.abs(mix))
mix *= .55 / max(peak, .001)
pcm = np.clip(mix * 32767, -32768, 32767).astype('<i2')
target = ROOT / 'assets' / 'studio-score.wav'
with wave.open(str(target), 'wb') as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes(pcm.tobytes())
print(f'Original score: {DURATION}s, stereo {RATE}Hz, peak {np.max(np.abs(mix)):.3f}: {target}')
