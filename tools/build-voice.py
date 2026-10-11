#!/usr/bin/env python3
"""Records the game's voice-overs with Gemini text-to-speech and packs them into src/voice-data.js.

The API key is read from the GEMINI_API_KEY environment variable, or from a .env file in the
project root (GEMINI_API_KEY=...). .env is git- and Vercel-ignored, and the key never reaches
the game: the clips are recorded once here and shipped as small MP3s.

Each clip is keyed by its speaker and its on-screen text, so the dialogue in src/levels.js and
src/game.js finds it. A line with no clip falls back to the synthesized voice blips, so editing
a line's text never breaks the game; just run this again to re-record it.

Voices: the narrator is a clear Indian English (en-IN) voice and Popo and Swiftee are character
voices, found in Gemini's voice library (see CAST). The chosen voices are saved in
asset/voice/cast.json, so every run sounds the same; a role whose voice changes is re-recorded.

Without a Gemini key, --engine kokoro records the same lines locally with Kokoro-82M
(Apache-2.0, no account needed), using its Hindi speaker voices for Indian English. It needs
Python 3.10+ with `pip install kokoro soundfile lameenc`; run this script with that Python.

Requires lameenc (pip install --user lameenc).
Run: python3 tools/build-voice.py --audition    one sample from each candidate voice per role,
                                                in asset/voice/auditions/, to listen and pick
     python3 tools/build-voice.py --cast popo=VOICE   use that voice (id or prebuilt name)
     python3 tools/build-voice.py               records missing clips, then repacks
     python3 tools/build-voice.py --force       re-records every clip (--only popo: one role)
"""
import argparse
import array
import base64
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'asset', 'voice')       # untouched recordings, never shipped
OUT = os.path.join(ROOT, 'assets', 'voice')      # compressed clips, for listening
DATA = os.path.join(ROOT, 'src', 'voice-data.js')
CAST_FILE = os.path.join(RAW, 'cast.json')      # the voice chosen for each role
CLIPS_FILE = os.path.join(RAW, 'clips.json')    # which voice recorded each clip

MODEL = 'gemini-3.8-flash-tts'
LEGACY_MODEL = 'gemini-2.5-flash-preview-tts'
API = 'https://generativelanguage.googleapis.com/v1beta'

PREBUILT = {'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe',
            'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib',
            'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima',
            'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'}

# Who speaks and how. `find` searches Gemini's voice library, trying each filter set in turn;
# `prefer` ranks what it finds by the words in each voice's description; `fallback` is the
# prebuilt voice used if nothing matches. Accent comes from the voice itself: Google advises
# against asking for an accent in `style`, which is for delivery only.
CAST = {
    'narrator': dict(
        find=[{'language_code': ['en-IN'], 'persona': ['Narrator']}, {'language_code': ['en-IN']},
              {'accent': ['Indian']}],
        prefer=['clear', 'warm', 'story', 'narrat', 'friendly', 'gentle', 'audiobook', 'child', 'kids'],
        fallback='Sulafat',
        style='Clear, warm and unhurried, like a storyteller reading to young children; smiling.'),
    'popo': dict(
        find=[{'language_code': ['en-IN'], 'gender': ['male'], 'pitch': ['low', 'medium']},
              {'gender': ['male'], 'pitch': ['low', 'medium']}],
        prefer=['playful', 'goofy', 'cartoon', 'character', 'animat', 'cheerful', 'warm', 'friendly',
                'excit', 'fun', 'lively', 'upbeat', 'bubbly', 'expressive'],
        fallback='Fenrir',
        style='Goofy, bouncy and warm, with a big cheerful grin; comically expressive.'),
    'swiftee': dict(
        find=[{'language_code': ['en-IN'], 'pitch': ['high']}, {'pitch': ['high']}],
        prefer=['playful', 'cartoon', 'character', 'animat', 'bright', 'youthful', 'excit', 'cheerful',
                'lively', 'bubbly', 'energetic'],
        fallback='Leda',
        style='Quick, chirpy and squeaky with delight, like a tiny excited bird.'),
}
# The same roles for the local Kokoro engine: voice, speaking speed, and a pitch factor applied
# afterwards (below 1 is deeper and bigger, above 1 higher and smaller). British-English
# pronunciation ('b') sits closer to Indian English than American.
KOKORO = {
    'narrator': dict(voice='hf_alpha', lang='b', speed=0.92, pitch=1.0,
                     audition=['hf_alpha', 'hf_beta', 'bf_emma']),
    'popo': dict(voice='hm_psi', lang='b', speed=1.12, pitch=0.9,
                 audition=['hm_psi', 'hm_omega', 'am_puck', 'am_fenrir']),
    'swiftee': dict(voice='hf_beta', lang='b', speed=1.12, pitch=1.3,
                    audition=['hf_beta', 'hf_alpha', 'af_heart']),
}
AUDITION_LINE = {'narrator': 'Popo *loves* fishing.', 'popo': 'Whoopsie Doopsie!', 'swiftee': "Let's find *out!*"}

INSTRUCTION = 'Clear and encouraging, a little slower so a young child can follow.'
ANNOUNCE = 'Excited, celebratory announcer naming a prize.'

# (speaker, text exactly as shown in the game with *stressed* words, extra delivery note)
LINES = [
    ('narrator', 'Popo *loves* fishing.', ''),
    ('narrator', 'And today…', 'Teasing, building suspense.'),
    ('narrator', 'he wants to catch *all* kinds of fish!', 'Big and excited.'),
    ('narrator', 'Catch the *triangle* fish!', INSTRUCTION),
    ('narrator', 'Catch the *pentagon* fish!', INSTRUCTION),
    ('narrator', 'Catch the *hexagon* fish!', INSTRUCTION),
    ('narrator', 'Catch all the *quadrilateral* fish!', INSTRUCTION),
    ('narrator', 'Triangle!', ANNOUNCE),
    ('narrator', 'Pentagon!', ANNOUNCE),
    ('narrator', 'Hexagon!', ANNOUNCE),
    ('narrator', 'Square!', ANNOUNCE),
    ('narrator', 'Rectangle!', ANNOUNCE),
    ('narrator', 'Rhombus!', ANNOUNCE),
    ('narrator', 'Parallelogram!', ANNOUNCE),
    ('narrator', 'Great fishing, Popo!', 'Proud and joyful.'),
    ('popo', 'Whoopsie Doopsie!', 'Wobbly and embarrassed, then a giggle.'),
    ('popo', '*Great* catch!', 'Delighted and proud.'),
    ('popo', '*Woah!*', 'An amazed gasp.'),
    ('popo', "I haven't seen *that* one before!", 'Astonished.'),
    ('popo', 'What *kind* of fish was that?', 'Puzzled and curious.'),
    ('swiftee', "Let's find *out!*", 'Eager, swooping in.'),
]


def voice_key(who, text):
    """Must match voiceKey() in src/audio.js."""
    text = text.replace('*', '').replace('…', '...').replace('’', "'")
    return f"{who}:{' '.join(text.split())}".lower()


def slug(who, text):
    return f"{who}-{re.sub(r'[^a-z0-9]+', '-', voice_key(who, text).split(':', 1)[1]).strip('-')}"[:60]


def spoken(text):
    # Gemini stresses capitalised words; the stars are only for the on-screen highlight
    return re.sub(r'\*([^*]+)\*', lambda m: m.group(1).upper(), text)


def api_key():
    key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    if key:
        return key.strip()
    for name in ('.env', '.env.local'):
        path = os.path.join(ROOT, name)
        if os.path.exists(path):
            for line in open(path):
                m = re.match(r'\s*(?:export\s+)?(GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*["\']?([^"\'\s]+)', line)
                if m:
                    return m.group(2)
    sys.exit('No API key: set GEMINI_API_KEY, or put GEMINI_API_KEY=... in a .env file in the project root.')


def get(url, key):
    req = urllib.request.Request(url, headers={'x-goog-api-key': key})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)


def pick(v, *names):
    """A voice field, whichever case the API spells it in."""
    for n in names:
        if v.get(n):
            return v[n]
    return ''


def describe(v):
    return ' | '.join(str(x) for x in (pick(v, 'display_name', 'displayName'), pick(v, 'accent'),
                                        pick(v, 'gender'), pick(v, 'pitch'), pick(v, 'description')[:90]) if x)


def library(filters, key):
    voices, token = [], None
    while len(voices) < 600:
        query = dict(filters, page_size=200, **({'page_token': token} if token else {}))
        res = get(f'{API}/voices?{urllib.parse.urlencode(query, doseq=True)}', key)
        voices += res.get('voices', [])
        token = res.get('next_page_token') or res.get('nextPageToken')
        if not token:
            break
    return voices


def candidates(who, key):
    """Library voices that suit a role, best match first."""
    cast = CAST[who]
    for filters in cast['find']:
        try:
            found = library(filters, key)
        except (OSError, ValueError) as e:  # HTTP errors, dropped connections, bad JSON
            print(f'  voice search {filters} failed: {getattr(e, "code", "") or e}')
            continue
        if found:
            def score(v):
                text = ' '.join(str(pick(v, f)) for f in ('display_name', 'displayName', 'description', 'persona', 'contexts')).lower()
                return sum(word in text for word in cast['prefer'])
            return sorted(found, key=score, reverse=True)
    return []


def voice_ref(v):
    return pick(v, 'id', 'voice_id', 'voiceId', 'name')


def load_json(path):
    return json.load(open(path)) if os.path.exists(path) else {}


def resolve_cast(roles, key, pinned):
    """The voice for each role: pinned on the command line, saved from an earlier run, or the
    best library match (falling back to a prebuilt voice)."""
    chosen = load_json(CAST_FILE)
    for who, voice in pinned.items():
        chosen[who] = {'voice': voice, 'about': 'chosen with --cast'}
    for who in roles:
        if who in chosen:
            continue
        found = candidates(who, key)
        if found:
            chosen[who] = {'voice': voice_ref(found[0]), 'about': describe(found[0])}
        else:
            chosen[who] = {'voice': CAST[who]['fallback'], 'about': 'prebuilt fallback (no library match)'}
    with open(CAST_FILE, 'w') as fh:
        json.dump(chosen, fh, indent=2)
    return chosen


def post(url, body, key):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.load(res)


def find_audio(node):
    """The first base64 audio payload anywhere in a response, with its mime type if given."""
    if isinstance(node, dict):
        for field in ('data', 'audio'):
            value = node.get(field)
            if isinstance(value, str) and len(value) > 1000:
                return value, node.get('mime_type') or node.get('mimeType') or ''
        for value in node.values():
            found = find_audio(value)
            if found:
                return found
    elif isinstance(node, list):
        for value in node:
            found = find_audio(value)
            if found:
                return found
    return None


def record(who, text, note, key, model, voice):
    style = f"{CAST[who]['style']} {note}".strip()
    # a library voice may be named "voices/voice_..." or just "voice_..."; try both
    refs = [voice] + ([voice.split('/', 1)[1]] if voice.startswith('voices/') else [])
    res, error = None, None
    for ref in refs:
        try:
            res = post(f'{API}/interactions', {
                'model': model,
                'input': [{'type': 'user_input', 'content': [{
                    'type': 'text', 'text': spoken(text),
                    'annotations': [{'type': 'speech_metadata', 'style': style}],
                }]}],
                'response_format': {'type': 'audio'},
                'generation_config': {'speech_config': [{'voice': ref}]},
            }, key)
            break
        except urllib.error.HTTPError as e:
            if e.code not in (400, 404):
                raise
            error = e
    if res is None:
        if voice not in PREBUILT:
            raise error
        # older API surface: generateContent returns raw 24 kHz 16-bit PCM
        res = post(f'{API}/models/{LEGACY_MODEL}:generateContent', {
            'contents': [{'parts': [{'text': f'Say it like this: {style}\n\n{spoken(text)}'}]}],
            'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {
                'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}},
        }, key)
    found = find_audio(res)
    if not found:
        raise RuntimeError(f'no audio in the response: {json.dumps(res)[:300]}')
    raw = base64.b64decode(found[0])
    if raw[:4] == b'RIFF':
        with wave.open(io.BytesIO(raw)) as w:
            assert w.getsampwidth() == 2, 'expected 16-bit audio'
            rate, channels, frames = w.getframerate(), w.getnchannels(), w.readframes(w.getnframes())
    else:
        m = re.search(r'rate=(\d+)', found[1])
        rate, channels, frames = int(m.group(1)) if m else 24000, 1, raw
    samples = array.array('h', frames)
    if channels > 1:
        samples = array.array('h', samples[::channels])
    return rate, samples


def trim(samples, rate, pad=0.04):
    """Cuts the silence the voice model leaves around a line, so the words start on cue."""
    peak = max(1, max(abs(s) for s in samples))
    loud = [i for i, s in enumerate(samples) if abs(s) > peak * 0.02]
    if not loud:
        return samples
    p = int(rate * pad)
    return samples[max(0, loud[0] - p):min(len(samples), loud[-1] + p)]


def save_wav(path, rate, samples):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.tobytes())


def load_wav(path):
    with wave.open(path) as w:
        return w.getframerate(), array.array('h', w.readframes(w.getnframes()))


def mp3(rate, samples):
    import lameenc
    enc = lameenc.Encoder()
    enc.set_bit_rate(64)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(2)
    return bytes(enc.encode(samples.tobytes()) + enc.flush())


PIPELINES = {}


def kokoro_ref(who, voice=None):
    k = KOKORO[who]
    return f"kokoro:{voice or k['voice']}:{k['speed']}:{k['pitch']}"


def record_kokoro(who, text, ref):
    """Records a line locally with Kokoro; `ref` is kokoro:VOICE:SPEED:PITCH."""
    import numpy as np
    from kokoro import KPipeline
    _, voice, speed, pitch = ref.split(':')
    lang = KOKORO[who]['lang']
    if lang not in PIPELINES:
        PIPELINES[lang] = KPipeline(lang_code=lang, repo_id='hexgrad/Kokoro-82M')
    # Kokoro reads capitals as letters, so the stressed words go in as plain text
    plain = text.replace('*', '')
    parts = [np.asarray(r.audio, dtype=np.float32) for r in PIPELINES[lang](plain, voice=voice, speed=float(speed)) if r.audio is not None]
    audio = np.concatenate(parts)
    pitch = float(pitch)
    if pitch != 1.0:
        # resample: playing the line back faster raises the pitch (and shortens it), slower lowers it
        n = int(len(audio) / pitch)
        audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio)
    audio = audio / max(1e-6, float(np.abs(audio).max())) * 0.9
    return 24000, array.array('h', (audio * 32767).astype('<i2').tobytes())


def record_retrying(who, text, note, key, model, voice):
    if voice.startswith('kokoro:'):
        return record_kokoro(who, text, voice)
    for attempt in range(3):
        try:
            return record(who, text, note, key, model, voice)
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors='replace')[:300]
            if e.code in (429, 500, 503) and attempt < 2:
                time.sleep(4 * (attempt + 1))
                continue
            sys.exit(f'Gemini refused {who!r} {text!r} with voice {voice!r}: HTTP {e.code} {detail}')


def audition(key, model, roles, engine='gemini'):
    """Records each role's sample line in its top candidate voices."""
    folder = os.path.join(RAW, 'auditions')
    os.makedirs(folder, exist_ok=True)
    for who in roles:
        if engine == 'kokoro':
            voices = [(kokoro_ref(who, v), f'Kokoro {v}') for v in KOKORO[who]['audition']]
        else:
            found = candidates(who, key)[:4]
            voices = [(voice_ref(v), describe(v)) for v in found] + [(CAST[who]['fallback'], 'prebuilt fallback')]
        print(f'{who}:')
        for i, (voice, about) in enumerate(voices, 1):
            rate, samples = record_retrying(who, AUDITION_LINE[who], '', key, model, voice)
            name = f"{who}-{i}-{re.sub(r'[^A-Za-z0-9]+', '-', voice.split('/')[-1]).strip('-')}.wav"
            save_wav(os.path.join(folder, name), rate, trim(samples, rate))
            print(f'  {i}. {name}  --cast {who}={voice}\n     {about}')
    print(f'Listen in {os.path.relpath(folder, ROOT)}/, then run with --cast ROLE=VOICE to choose.')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--force', action='store_true', help='re-record clips that already exist')
    ap.add_argument('--only', choices=sorted(CAST), help='only this role')
    ap.add_argument('--audition', action='store_true', help='record samples of candidate voices and stop')
    ap.add_argument('--cast', action='append', default=[], metavar='ROLE=VOICE', help='use this voice for a role')
    ap.add_argument('--model', default=MODEL)
    ap.add_argument('--engine', choices=['gemini', 'kokoro'], default='gemini',
                    help='kokoro records locally without an API key')
    args = ap.parse_args()
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    roles = [args.only] if args.only else list(CAST)
    pinned = dict(c.split('=', 1) for c in args.cast)
    assert set(pinned) <= set(CAST), f'roles are {sorted(CAST)}'

    if args.audition:
        audition(api_key() if args.engine == 'gemini' else None, args.model, roles, args.engine)
        return

    recorded = load_json(CLIPS_FILE)
    have = lambda who, text: os.path.exists(os.path.join(RAW, slug(who, text) + '.wav'))
    missing = [l for l in LINES if l[0] in roles and not have(l[0], l[1])]
    if args.engine == 'kokoro':
        key = 'local'
        cast = load_json(CAST_FILE)
        for who in roles:
            voice = pinned.get(who)
            cast[who] = {'voice': kokoro_ref(who, voice), 'about': f"Kokoro {voice or KOKORO[who]['voice']}"}
        with open(CAST_FILE, 'w') as fh:
            json.dump(cast, fh, indent=2)
    else:
        key = api_key() if missing or args.force or pinned else None
        cast = resolve_cast(roles, key, pinned) if key else load_json(CAST_FILE)
    # record what's missing, what was forced, and what an earlier voice recorded
    todo = [l for l in LINES if l[0] in roles and key and (
        args.force or not have(l[0], l[1]) or recorded.get(slug(l[0], l[1])) != cast[l[0]]['voice'])]
    for who in roles:
        if who in cast:
            print(f"{who}: {cast[who]['voice']}  ({cast[who].get('about', '')})")
    for who, text, note in todo:
        print(f'recording {who}: {text}')
        rate, samples = record_retrying(who, text, note, key, args.model, cast[who]['voice'])
        save_wav(os.path.join(RAW, slug(who, text) + '.wav'), rate, samples)
        recorded[slug(who, text)] = cast[who]['voice']
        with open(CLIPS_FILE, 'w') as fh:
            json.dump(recorded, fh, indent=2)

    clips = {}
    for who, text, _ in LINES:
        path = os.path.join(RAW, slug(who, text) + '.wav')
        if not os.path.exists(path):
            continue
        rate, samples = load_wav(path)
        samples = trim(samples, rate)
        data = mp3(rate, samples)
        with open(os.path.join(OUT, slug(who, text) + '.mp3'), 'wb') as fh:
            fh.write(data)
        clips[voice_key(who, text)] = 'data:audio/mpeg;base64,' + base64.b64encode(data).decode()
        print(f'  {len(samples) / rate:4.1f}s {len(data) // 1024:3d} KB  {who}: {text}')

    with open(DATA, 'w') as fh:
        fh.write('// Generated by tools/build-voice.py: recorded voice lines as data URLs, keyed by\n')
        fh.write('// speaker and on-screen text (see voiceKey in src/audio.js). Do not edit by hand.\n')
        fh.write('window.PopoGame = window.PopoGame || {};\nPopoGame.VOICE_DATA = {\n')
        for k, v in clips.items():
            fh.write(f'  {json.dumps(k)}: {json.dumps(v)},\n')
        fh.write('};\n')
    print(f'wrote src/voice-data.js ({len(clips)} of {len(LINES)} lines)')


if __name__ == '__main__':
    main()
