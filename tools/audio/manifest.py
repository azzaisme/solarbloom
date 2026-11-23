#!/usr/bin/env python3
"""
Phase 8 A08: writes docs/audio/ASSET_MANIFEST.csv and docs/audio/CREDITS.md from the bake report and the
provenance table below. Every raw master a shipped file was baked from must be listed here (the script fails
otherwise), so no asset can ship without a recorded creator, source and licence.

Run after bake.py:  python3 tools/audio/manifest.py
"""
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPORT = os.path.join(ROOT, 'docs', 'audio', 'bake-report.json')
CSV = os.path.join(ROOT, 'docs', 'audio', 'ASSET_MANIFEST.csv')
CREDITS = os.path.join(ROOT, 'docs', 'audio', 'CREDITS.md')
PROOF = 'docs/audio/LICENCE_EVIDENCE.md'

CC0 = 'CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)'
PDD = 'CC Public Domain Dedication (http://creativecommons.org/licenses/publicdomain/)'
PDM = 'Public Domain Mark 1.0 (https://creativecommons.org/publicdomain/mark/1.0/)'

# raw master (under assets/raw/audio) → provenance. `human`: the evidence that a person recorded / performed it.
SOURCES = {
    'atmos/city-wind.ogg': dict(title='windy ambient noise (windy_ambiance.ogg)', creator='Some Weirdo', url='https://opengameart.org/content/windy-ambient-noise', lic=CC0,
                                human='Field recording of wind (as listed in the earlier credits); high- and low-passed for a thin dry wind'),
    'atmos/brook.wav': dict(title='Park ambiences: park_ambience_river.wav (30 s cut)', creator='Thimras', url='https://opengameart.org/content/park-ambiences', lic=CC0,
                            human='"recording of a small river with water falling over a low step... public park in Adelaide"'),
    'atmos/birds-trees.wav': dict(title='Park ambiences: park_ambience_birds.wav (36 s cut)', creator='Thimras', url='https://opengameart.org/content/park-ambiences', lic=CC0,
                                  human='"close to a copse of trees, birds chattering before the rain"; single calls cut by bake.py'),
    'atmos/aspen-leaves.mp3': dict(title='Aspen and Cottonwood Trees Blowing in Wind (Radio Aporee 58287)', creator='dlee (Metabolic Studio)', url='https://archive.org/details/aporee_58287_66859', lic=PDM,
                                   human='"Recorded ... using H4N with two small lav microphones attached directly to the tree branches"'),
    'atmos/morning-kresiek.ogg': dict(title='AMB Morning Sounds (Perfect Loop)', creator='Kresiek The Furry', url='https://opengameart.org/content/amb-morning-sounds-perfect-loop', lic=CC0,
                                      human='"Recorded on Saturday, March 26 at 10:28 AM"'),
    'atmos/night-cevennes.mp3': dict(title='Quiet Night in the Cevennes National Park - part 3 (Radio Aporee 50824)', creator='Guillaume Capsowl Voisin', url='https://archive.org/details/aporee_50824_57983', lic=PDM,
                                     human='"Tascam DR100 MK3 / Lom Usi Pro mics in ORTF"'),
    'atmos/lake-shore.mp3': dict(title='Simpson Lake Shore (Radio Aporee 51993)', creator='Pierrot Desperes', url='https://archive.org/details/aporee_51993_59367', lic=PDM,
                                 human='Field recording: "Waves lapping at shore... wind through dry grass"'),
    'sfx/rustle': dict(title='20 Rustles of dry leaves', creator='qubodup', url='https://opengameart.org/content/20-rustles-dry-leaves', lic=CC0, human='"Recorded in the kitchen", 24-bit/96 kHz'),
    'sfx/cat': dict(title='Cat Purr & Meow', creator='Kerzoven', url='https://opengameart.org/content/cat-purr-meow', lic=CC0,
                    human='"took the day to record some with my limited equipment... the cat liked to move around"'),
    'sfx/steps/Fantozzi': dict(title="Fantozzi's Footsteps (Grass/Sand & Stone)", creator='Fantozzi (submitted by qubodup)', url='https://opengameart.org/content/fantozzis-footsteps-grasssand-stone', lic=CC0,
                               human='Freesound field recordings (Fantozzi pack 10338, CC0)'),
    'sfx/steps': dict(title='Different steps on wood, stone, leaves, gravel and mud', creator='TinyWorlds (from pdsounds.org recordings)', url='https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud', lic=CC0,
                      human='"The sounds are recordings from pdsounds.org, which I edited"'),
    'music/tournier-sonatine-calme-harp.flac': dict(title='Marcel Tournier: Sonatine No. 1 Op. 30, II. Calme et expressif (1924)', creator='Marcel Tournier (composer); Ina Zdorovetchi (harp); recorded by tom.k@archive.org', url='https://archive.org/details/Ina_11_21_2010', lic=CC0,
                                                    human='Live recital, Brown Hall, Boston, 21 Nov 2010 (24-bit/96 kHz binaural recording)'),
    'music/bach-bwv825-sarabande-harp.flac': dict(title='J. S. Bach: Partita No. 1 BWV 825, Sarabande', creator='J. S. Bach (composer); Ina Zdorovetchi (harp); recorded by tom.k@archive.org', url='https://archive.org/details/Ina_11_21_2010', lic=CC0,
                                                  human='Live recital, Brown Hall, Boston, 21 Nov 2010'),
    'music/raga-kiravani-veena.mp3': dict(title='Raga Kiravani: alapana and tanam (traditional raga, improvised)', creator='L. Ramakrishnan (veena)', url='https://archive.org/details/LR_kIravANI', lic=PDD,
                                          human="Performer's own upload: recorded at Lars Nesbakken's home studio, Portland, Oregon"),
    'music/iwashimizu-shakuhachi.mp3': dict(title='Iwashimizu (Tozan-ryu honkyoku; Nakao Tozan, 1904)', creator='Nakao Tozan (composer); Iburozan (shakuhachi)', url='https://archive.org/details/Iwashimizu', lic=CC0,
                                            human="Performer's own upload: \"performed by Iburozan on November 23rd. 2010\""),
    'music/dvorak-op51-romanza-quartet.mp3': dict(title='Antonín Dvořák: String Quartet No. 10 Op. 51, III. Romanza', creator='Antonín Dvořák (composer); Musopen String Quartet', url='https://archive.org/details/MusopenKickstarterRecordings', lic=CC0,
                                                  human='Musopen commissioned studio recording (2012 Kickstarter)'),
    'music/schubert-d664-andante-piano.mp3': dict(title='Franz Schubert: Piano Sonata in A D. 664, II. Andante', creator='Franz Schubert (composer); Paul Pitman (piano); Musopen', url='https://archive.org/details/MusopenKickstarterRecordings', lic=CC0,
                                                  human='Musopen commissioned studio recording (performer in the file tag)'),
}


def source_of(src):
    best = None
    for k in SOURCES:
        if src == k or src.startswith(k + '/') or (src.startswith(k) and k.endswith('Fantozzi')):
            if best is None or len(k) > len(best):
                best = k
    return best


def category(asset):
    return asset.split('/')[0] + '/' + asset.split('/')[1] if asset.count('/') >= 2 else asset.split('/')[0]


def main():
    rep = json.load(open(REPORT))
    rows = []
    missing = []
    for asset, r in sorted(rep.items()):
        k = source_of(r['src'])
        if not k:
            missing.append(f'{asset} ← {r["src"]}')
            continue
        s = SOURCES[k]
        loop = 'seam' in r
        rows.append(dict(
            asset_id=asset,
            category=category(asset),
            filename=r['file'].replace('assets/audio/', ''),
            creator=s['creator'],
            source_url=s['url'],
            license=s['lic'],
            commercial_use_verified='yes',
            attribution_required='no',
            attribution_text=f"{s['title']} by {s['creator']}",
            proof_location=PROOF,
            raw_duration_seconds=r['seconds'],
            loopable='yes' if loop else 'no',
            loop_start_seconds=0 if loop else '',
            loop_end_seconds=r['seconds'] if loop else '',
            notes=f"master assets/raw/audio/{r['src']}; human-made: {s['human']}; peak {r['peak_dbfs']} dBFS" + (f"; {r['lufs']} LUFS" if r.get('lufs') is not None else '') + (f"; seam step {r['seam']}x" if loop else ''),
        ))
    if missing:
        print('No provenance for:\n  ' + '\n  '.join(missing))
        sys.exit(1)
    cols = ['asset_id', 'category', 'filename', 'creator', 'source_url', 'license', 'commercial_use_verified', 'attribution_required', 'attribution_text',
            'proof_location', 'raw_duration_seconds', 'loopable', 'loop_start_seconds', 'loop_end_seconds', 'notes']
    with open(CSV, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for row in rows:
            # commas inside fields would break the plain split the tests use: keep fields comma-free
            w.writerow({k: str(v).replace(',', ';') for k, v in row.items()})
    # credits: one line per source, with what it became
    used = {}
    for row in rows:
        used.setdefault((row['attribution_text'], row['source_url'], row['license']), []).append(row['asset_id'])
    with open(CREDITS, 'w') as f:
        f.write('# Solarbloom — audio credits\n\n')
        f.write('Every recorded sound and piece of music in the game is the work of these people. All are CC0 or in the public\n')
        f.write('domain, so no attribution is required; we credit them gladly. Generated from `docs/audio/ASSET_MANIFEST.csv`\n')
        f.write('by `tools/audio/manifest.py`. Designed interface and reward tones are written by hand in `src/audio/Sfx.ts`.\n\n')
        f.write('| Work | Source | Licence | Used as |\n|---|---|---|---|\n')
        for (who, url, lic), ids in sorted(used.items(), key=lambda x: (not x[1][0].startswith('music'), x[0][0])):
            short = sorted({i.rsplit('-', 1)[0] if i[-3] == '-' and i[-2:].isdigit() else i for i in ids})
            f.write(f"| {who} | {url} | {lic.split(' (')[0]} | {', '.join(f'`{s}`' for s in short)} |\n")
        f.write('\nMusic: performances by Ina Zdorovetchi (harp), L. Ramakrishnan (veena), Iburozan (shakuhachi), Paul Pitman (piano) and the Musopen String Quartet, released to the public domain.\n')
    print(f'{len(rows)} rows → {os.path.relpath(CSV, ROOT)}, {os.path.relpath(CREDITS, ROOT)}')


if __name__ == '__main__':
    main()
