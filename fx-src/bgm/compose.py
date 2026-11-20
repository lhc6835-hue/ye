#!/usr/bin/env python3
"""Attract-mode BGM for the arcade hub: an original synthwave chiptune loop, synthesized from code.

Run:  python3 fx-src/bgm/compose.py out.wav   (then: ffmpeg -i out.wav -b:a 128k assets/bgm/attract.mp3)
Needs numpy. Everything is generated here, so the track is free of third-party rights.
The loop is seamless: echo tails past the end are wrapped back onto the start.
"""
import sys, wave
import numpy as np

SR = 44100
BPM = 112
STEP = 60 / BPM / 4                     # one 16th note in seconds
BAR = 16
rng = np.random.default_rng(7)

NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
def midi(n):  # "A4" -> 69
    name, octv = n[:-1], int(n[-1])
    return 12 * (octv + 1) + NOTE[name]
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

# ---------------------------------------------------------------- score
CHORDS = {  # root midi + chord tones (semitones)
    "Am": (57, [0, 3, 7]), "F": (53, [0, 4, 7]), "C": (48, [0, 4, 7]), "G": (55, [0, 4, 7]),
    "E": (52, [0, 4, 7]), "Em": (52, [0, 3, 7]),
}
PROG_A = ["Am", "F", "C", "G", "Am", "F", "C", "E"]
PROG_B = ["F", "G", "Em", "Am", "F", "G", "E", "E"]
MEL_A = [
    "A4 - - - C5 - E5 - D5 - C5 - A4 - - -",
    "F4 - - - A4 - C5 - - - A4 - G4 - - -",
    "E4 - - - G4 - C5 - E5 - D5 - C5 - - -",
    "D5 - - - B4 - G4 - - - - - . . . .",
    "A4 - C5 - E5 - A5 - G5 - E5 - D5 - C5 -",
    "F5 - - - E5 - C5 - A4 - - - C5 - - -",
    "E5 - - - D5 - C5 - G4 - - - E5 - D5 -",
    "B4 - - - - - - - G#4 - - - B4 - - -",
]
MEL_B = [
    "A5 - - - - - G5 - F5 - - - E5 - - -",
    "D5 - - - - - E5 - G5 - - - - - - -",
    "B5 - - - - - A5 - G5 - - - E5 - - -",
    "A5 - - - - - - - - - - - . . . .",
    "C6 - - - - - A5 - F5 - - - C6 - - -",
    "B5 - - - - - G5 - D5 - - - G5 - - -",
    "G#5 - - - - - E5 - B4 - - - E5 - - -",
    "G#5 - - - B5 - - - E6 - - - . . . .",
]
# song form: intro (no lead), A, B, A with the lead an octave up for a lift
FORM = [("A", None, 0.55), ("A", MEL_A, 1.0), ("B", MEL_B, 1.0), ("A", MEL_A, 1.0)]

def parse(bar):
    toks = bar.split()
    assert len(toks) == 16, bar
    notes, cur = [], None
    for i, t in enumerate(toks):
        if t == "-":
            if cur: cur[2] += 1
        elif t == ".":
            cur = None
        else:
            cur = [i, midi(t), 1]
            notes.append(cur)
    return notes  # [step, midi, length_in_steps]

# ---------------------------------------------------------------- voices
def env(n, a=0.004, d=0.08, s=0.6, r=0.04):
    t = np.arange(n) / SR
    e = np.where(t < a, t / a, s + (1 - s) * np.exp(-(t - a) / d))
    rel = int(r * SR)
    if rel and n > rel: e[-rel:] *= np.linspace(1, 0, rel)
    return e

def pulse(f, n, duty=0.5, vib=0.0, t0=0.0):
    t = np.arange(n) / SR
    ph = np.cumsum(np.full(n, f) * (1 + vib * np.sin(2 * np.pi * 5.2 * (t + t0)) * np.clip((t - 0.18) * 4, 0, 1))) / SR
    return np.where((ph % 1) < duty, 1.0, -1.0)

def tri(f, n):
    ph = (np.arange(n) * f / SR) % 1
    return 4 * np.abs(ph - 0.5) - 1

def lowpass(x, cut):
    # one-pole low-pass, vectorised enough for a few million samples
    a = np.exp(-2 * np.pi * cut / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y

def place(buf, start, sig):
    end = min(len(buf), start + len(sig))
    buf[start:end] += sig[: end - start]
    if start + len(sig) > len(buf):  # wrap the tail onto the start: seamless loop
        rest = sig[end - start:]
        buf[: len(rest)] += rest

def kick(n):
    t = np.arange(n) / SR
    f = 50 + 110 * np.exp(-t * 32)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)

def snare(n):
    t = np.arange(n) / SR
    noise = rng.uniform(-1, 1, n)
    return (0.75 * noise * np.exp(-t * 18) + 0.4 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25))

def hat(n, open_=False):
    t = np.arange(n) / SR
    noise = rng.uniform(-1, 1, n)
    hp = noise - np.concatenate([[0], noise[:-1]])  # crude high-pass
    return hp * np.exp(-t * (14 if open_ else 60))

# ---------------------------------------------------------------- render
def render():
    bars = sum(8 for _ in FORM)
    total = int(round(bars * BAR * STEP * SR))
    bass = np.zeros(total); arp = np.zeros(total); lead = np.zeros(total); drums = np.zeros(total); pad = np.zeros(total)
    sN = lambda steps: int(round(steps * STEP * SR))
    bar_i = 0
    for sec, mel, energy in FORM:
        prog = PROG_A if sec == "A" else PROG_B
        lift = 12 if (mel is MEL_A and bar_i >= 24) else 0
        for b, ch in enumerate(prog):
            root, tones = CHORDS[ch]
            base = (bar_i + b) * BAR
            # bass: octave-pumping eighths, a passing note into the next bar
            for k in range(8):
                m = root - 12 + (12 if k % 2 else 0)
                if k == 7 and b < 7: m = root - 12 + 7
                sig = tri(hz(m), sN(2)) * env(sN(2), d=0.12, s=0.5, r=0.02)
                place(bass, sN(base + k * 2), sig)
            # arpeggio: sixteenths up and down the chord, two octaves up
            pat = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 2, 1]
            ext = tones + [12]
            for k, idx in enumerate(pat):
                m = root + 12 + ext[idx]
                sig = pulse(hz(m), sN(1), duty=0.125) * env(sN(1), d=0.05, s=0.25, r=0.01)
                place(arp, sN(base + k), sig * (0.9 if k % 4 == 0 else 0.65))
            # pad: soft sustained chord, filtered later
            for tn in tones:
                n = sN(16)
                sig = pulse(hz(root + 12 + tn), n, duty=0.5) * env(n, a=0.25, d=1.0, s=0.8, r=0.2)
                place(pad, sN(base), sig * 0.33)
            # drums
            for k in range(16):
                if k in (0, 8) or (energy > 0.9 and k == 10 and b % 2): place(drums, sN(base + k), kick(sN(4)) * 1.0)
                if k in (4, 12) and energy > 0.6: place(drums, sN(base + k), snare(sN(3)) * 0.55)
                if k % 2 == 0: place(drums, sN(base + k), hat(sN(1)) * (0.22 if k % 4 else 0.3) * (1 if energy > 0.6 else 0.6))
                if energy > 0.9 and k == 14: place(drums, sN(base + k), hat(sN(2), True) * 0.18)
            if b == 7 and energy > 0.9:  # a snare fill into the next section
                for k in (13, 14, 15): place(drums, sN(base + k), snare(sN(1)) * 0.4)
            # lead
            if mel:
                for st, m, ln in parse(mel[b]):
                    n = sN(ln)
                    t0 = (base + st) * STEP
                    sig = pulse(hz(m + lift), n, duty=0.5 if lift else 0.33, vib=0.006, t0=t0) * env(n, a=0.006, d=0.2, s=0.7, r=0.03)
                    place(lead, sN(base + st), sig)
        bar_i += 8

    # tone shaping
    bass = lowpass(bass, 900)
    arp = lowpass(arp, 3200)
    pad = lowpass(pad, 1200)
    lead = lowpass(lead, 4200)
    # echo on the lead and arp: dotted eighth, wrapped for a seamless loop
    d = int(round(3 * STEP * SR))
    for _ in range(3):
        lead = lead + 0.33 * np.roll(lead, d) * 0.9
    arp = arp + 0.25 * np.roll(arp, d)
    mix = 0.42 * bass + 0.16 * arp + 0.1 * pad + 0.26 * lead + 0.34 * drums
    # gentle sidechain-ish pump from the kick rhythm
    beat = (np.arange(total) / SR) % (4 * STEP)
    mix *= 1 - 0.18 * np.exp(-beat * 9)
    mix = np.tanh(mix * 1.4) / np.tanh(1.4)
    mix /= max(1e-9, np.abs(mix).max()) / 0.89
    return mix

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "attract.wav"
    x = render()
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(out, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print(out, f"{len(x) / SR:.1f}s")

if __name__ == "__main__":
    main()
