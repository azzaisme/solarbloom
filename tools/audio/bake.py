#!/usr/bin/env python3
"""
Phase 8 A08: bakes the shipped audio (assets/audio/) from the raw masters (assets/raw/audio/).

For each entry in SPEC it decodes the master with ffmpeg (applying its EQ), then:
  - loop:     cuts `dur` seconds and folds an equal-power crossfade of the tail into the head, so the file
              loops with no seam (no pop, no gap) as an AudioBuffer loop;
  - oneshot:  trims, fades in/out;
  - calls:    finds the `n` clearest events (bird calls) in a band and cuts each as a one-shot variation;
  - split:    cuts several one-shots at given times (footstep takes).
It normalises loudness (integrated LUFS for beds and music, peak for one-shots), keeps peaks under -1 dBFS,
encodes Ogg Vorbis, re-decodes the result and checks the loop seam, and writes docs/audio/bake-report.json
(durations, loudness, peaks, seam jumps) for the manifest.

Run from the repository root:  python3 tools/audio/bake.py [only-this-id-prefix]
Needs ffmpeg and numpy. Outputs are committed; the masters stay in assets/raw/audio (not bundled).
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, 'assets', 'raw', 'audio')
OUT = os.path.join(ROOT, 'assets', 'audio')
REPORT = os.path.join(ROOT, 'docs', 'audio', 'bake-report.json')

# EQ shared by beds: no rumble (it only muddies a small speaker), no fizz above 9 kHz (the grating part of noise).
CLEAN = 'highpass=f=90,lowpass=f=9000'

SPEC = [
    # ── the dead world: a thin, dry wind (the old bed was a loud mid-range roar) ──
    dict(id='ambience/barren/wind-dry', src='atmos/city-wind.ogg', kind='loop', start=20, dur=75, xfade=6, ch=2, sr=44100,
         af='highpass=f=220,lowpass=f=3200,equalizer=f=900:t=q:w=1:g=-4', lufs=-24),
    # ── restored ground ──
    dict(id='ambience/restored/leaves', src='atmos/leaves.ogg', kind='loop', start=0, dur=60, xfade=5, ch=2, sr=44100, af=CLEAN + ',highpass=f=300', lufs=-24),
    dict(id='ambience/restored/meadow', src='atmos/meadow.ogg', kind='loop', start=0, dur=90, xfade=6, ch=2, sr=44100, af=CLEAN, lufs=-24),
    # the crickets were boosted 14 dB in game over a rumbling noise floor: cut the rumble and the hiss instead
    dict(id='ambience/restored/night-insects', src='atmos/crickets.mp3', kind='loop', start=0.5, dur=17, xfade=2.5, ch=2, sr=44100,
         af='highpass=f=1800,lowpass=f=7000,afftdn=nf=-40', lufs=-26),
    # ── water (mono: they are 3D sources) ──
    dict(id='ambience/water/brook', src='atmos/brook.wav', kind='loop', start=0, dur=27, xfade=3, ch=1, sr=24000, af='highpass=f=120,lowpass=f=7500', lufs=-22),
    dict(id='ambience/water/shore', src='atmos/shore.ogg', kind='loop', start=0, dur=60, xfade=5, ch=1, sr=32000, af='highpass=f=80,lowpass=f=6000', lufs=-22),
    # ── wildlife: single calls cut from the park recording's busiest stretch ──
    dict(id='ambience/wildlife/bird', src='atmos/birds-trees.wav', kind='calls', n=8, band=(1800, 7000), min_len=1.2, max_len=3.2, ch=1, sr=24000,
         af='highpass=f=900,lowpass=f=8500', peak=-6),
    # ── restoration foley ──
    dict(id='sfx/restoration/soil', src='sfx/soil.ogg', kind='calls', n=4, band=(100, 2000), min_len=0.25, max_len=0.7, ch=1, sr=32000, af='highpass=f=60,lowpass=f=6000', peak=-4),
    dict(id='sfx/restoration/leaf', src='sfx/leaf.ogg', kind='calls', n=4, band=(1500, 7000), min_len=0.3, max_len=0.9, ch=1, sr=32000, af='highpass=f=300,lowpass=f=9000', peak=-5),
    dict(id='sfx/events/meow', src='sfx/meow.ogg', kind='calls', n=3, band=(400, 3000), min_len=0.4, max_len=1.4, ch=1, sr=32000, af='highpass=f=150,lowpass=f=7000', peak=-4),
    dict(id='ambience/barren/creak', src='sfx/creak.ogg', kind='calls', n=3, band=(150, 3000), min_len=0.6, max_len=2.5, ch=1, sr=32000, af='highpass=f=120,lowpass=f=4000', peak=-6),
]

# footsteps and music are added from tools/audio/sources.json (written once the sources were chosen)
EXTRA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sources.json')
if os.path.exists(EXTRA):
    with open(EXTRA) as f:
        SPEC += json.load(f)


def decode(path, sr, ch, af):
    cmd = ['ffmpeg', '-v', 'error', '-i', path]
    if af:
        cmd += ['-af', af]
    cmd += ['-ac', str(ch), '-ar', str(sr), '-f', 'f32le', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch).copy()


def lufs(x, sr):
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as t:
        name = t.name
    write_wav(name, x, sr)
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', name, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    os.unlink(name)
    val = None
    for line in out.splitlines():
        line = line.strip()
        if line.startswith('I:') and 'LUFS' in line:
            val = float(line.split()[1])
    return val


def write_wav(path, x, sr):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    import wave
    with wave.open(path, 'wb') as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def encode(x, sr, out, q=5):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as t:
        name = t.name
    write_wav(name, x, sr)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', name, '-c:a', 'libvorbis', '-q:a', str(q), out], check=True)
    os.unlink(name)


def seamless(seg, sr, dur, xfade):
    n = int(dur * sr)
    f = int(xfade * sr)
    if len(seg) < n + f:
        n = len(seg) - f
    y = seg[:n].copy()
    t = np.linspace(0, np.pi / 2, f, dtype=np.float32)[:, None]
    y[:f] = seg[:f] * np.sin(t) + seg[n:n + f] * np.cos(t)
    return y


def fades(y, sr, fin=0.01, fout=0.08):
    a = max(1, int(fin * sr))
    b = max(1, int(fout * sr))
    y[:a] *= np.linspace(0, 1, a, dtype=np.float32)[:, None]
    y[-b:] *= np.linspace(1, 0, b, dtype=np.float32)[:, None] ** 2
    return y


def band_env(x, sr, lo, hi, hop):
    mono = x.mean(axis=1)
    n = 2048
    win = np.hanning(n)
    freqs = np.fft.rfftfreq(n, 1 / sr)
    sel = (freqs >= lo) & (freqs < hi)
    env = []
    for i in range(0, len(mono) - n, hop):
        S = np.abs(np.fft.rfft(mono[i:i + n] * win)) ** 2
        env.append(S[sel].sum())
    return np.array(env)


def find_calls(x, sr, n, band, min_len, max_len):
    """The n strongest, non-overlapping events in `band`: each starts a little before its onset, ends when it decays."""
    hop = int(sr * 0.02)
    env = band_env(x, sr, *band, hop)
    if not len(env):
        return []
    floor = np.percentile(env, 30)
    used = np.zeros(len(env), bool)
    picks = []
    order = np.argsort(env)[::-1]
    for i in order:
        if len(picks) >= n:
            break
        if used[max(0, i - int(min_len / 0.02)):i + int(min_len / 0.02)].any():
            continue
        if env[i] < floor * 4:
            break
        # back up to the onset, forward to the decay
        a = i
        while a > 0 and env[a - 1] > floor * 2 and (i - a) * 0.02 < 0.4:
            a -= 1
        b = i
        while b < len(env) - 1 and env[b + 1] > floor * 2 and (b - a) * 0.02 < max_len:
            b += 1
        if (b - a) * 0.02 < min_len:
            b = a + int(min_len / 0.02)
        a0 = max(0, a * hop - int(0.03 * sr))
        b0 = min(len(x), b * hop + int(0.15 * sr))
        used[max(0, a - 5):b + 5] = True
        picks.append((a0, b0))
    picks.sort()
    return picks


def peak_db(x):
    p = float(np.abs(x).max())
    return 20 * np.log10(p) if p > 0 else -120


def seam_jump(x):
    """The step at the loop point, against the typical step between neighbouring samples (1 = invisible)."""
    d = np.abs(np.diff(x, axis=0)).mean()
    j = np.abs(x[0] - x[-1]).mean()
    return float(j / d) if d > 0 else 0.0


def normalise(y, sr, e):
    if 'lufs' in e:
        l = lufs(y, sr)
        if l is not None:
            y = y * (10 ** ((e['lufs'] - l) / 20))
    else:
        y = y * (10 ** ((e.get('peak', -3) - peak_db(y)) / 20))
    p = peak_db(y)
    if p > -1:
        y = y * (10 ** ((-1 - p) / 20))
    return y


def bake(e, report):
    src = os.path.join(RAW, e['src'])
    if not os.path.exists(src):
        print(f"  skip {e['id']}: no master at {e['src']}")
        return
    sr, ch = e.get('sr', 44100), e.get('ch', 2)
    x = decode(src, sr, ch, e.get('af'))
    outs = []
    if e['kind'] == 'loop':
        seg = x[int(e.get('start', 0) * sr):]
        y = normalise(seamless(seg, sr, e['dur'], e['xfade']), sr, e)
        outs.append((e['id'], y))
    elif e['kind'] == 'oneshot':
        a = int(e.get('start', 0) * sr)
        b = int(e['end'] * sr) if 'end' in e else len(x)
        y = normalise(fades(x[a:b].copy(), sr, e.get('fin', 0.005), e.get('fout', 0.1)), sr, e)
        outs.append((e['id'], y))
    elif e['kind'] == 'music':
        a = int(e.get('start', 0) * sr)
        b = int(e['end'] * sr) if 'end' in e else len(x)
        y = normalise(fades(x[a:b].copy(), sr, e.get('fin', 0.5), e.get('fout', 3)), sr, e)
        outs.append((e['id'], y))
    elif e['kind'] in ('calls', 'split'):
        if e['kind'] == 'calls':
            spans = find_calls(x, sr, e['n'], e['band'], e['min_len'], e['max_len'])
        else:
            spans = [(int(a * sr), int(b * sr)) for a, b in e['at']]
        for k, (a, b) in enumerate(spans):
            y = normalise(fades(x[a:b].copy(), sr, 0.004, min(0.25, (b - a) / sr / 3)), sr, e)
            outs.append((f"{e['id']}-{k + 1:02d}", y))
    for oid, y in outs:
        path = os.path.join(OUT, oid + '.ogg')
        encode(y, sr, path, e.get('q', 5))
        back = decode(path, sr, ch, None)  # what the browser will decode
        rec = dict(file=os.path.relpath(path, ROOT), src=e['src'], seconds=round(len(back) / sr, 3), peak_dbfs=round(peak_db(back), 2), bytes=os.path.getsize(path))
        if e['kind'] in ('loop', 'music'):
            rec['lufs'] = lufs(back, sr)
        if e['kind'] == 'loop':
            rec['seam'] = round(seam_jump(back), 2)
            rec['length_kept'] = abs(len(back) - len(y)) <= 1
        report[oid] = rec
        print(f"  {oid}: {rec}")


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ''
    report = {}
    if os.path.exists(REPORT):
        with open(REPORT) as f:
            report = json.load(f)
    for e in SPEC:
        if e['id'].startswith(only):
            for k in [k for k in report if k == e['id'] or k.startswith(e['id'] + '-')]:
                del report[k]
            bake(e, report)
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, 'w') as f:
        json.dump(dict(sorted(report.items())), f, indent=1)


if __name__ == '__main__':
    main()
