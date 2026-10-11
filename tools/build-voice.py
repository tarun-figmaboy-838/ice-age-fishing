#!/usr/bin/env python3
"""Records the game's voice-overs with Gemini text-to-speech and packs them into src/voice-data.js.

The API key is read from the GEMINI_API_KEY environment variable, or from a .env file in the
project root (GEMINI_API_KEY=...). .env is git- and Vercel-ignored, and the key never reaches
the game: the clips are recorded once here and shipped as small MP3s.

Each clip is keyed by its speaker and its on-screen text, so the dialogue in src/levels.js and
src/game.js finds it. A line with no clip falls back to the synthesized voice blips, so editing
a line's text never breaks the game; just run this again to re-record it.

Requires lameenc (pip install --user lameenc).
Run: python3 tools/build-voice.py            records missing clips, then repacks
     python3 tools/build-voice.py --force    re-records every clip
     python3 tools/build-voice.py --only popo   re-records one speaker
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
import urllib.request
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'asset', 'voice')       # untouched recordings, never shipped
OUT = os.path.join(ROOT, 'assets', 'voice')      # compressed clips, for listening
DATA = os.path.join(ROOT, 'src', 'voice-data.js')

MODEL = 'gemini-3.8-flash-tts'
LEGACY_MODEL = 'gemini-2.5-flash-preview-tts'
API = 'https://generativelanguage.googleapis.com/v1beta'

# Who speaks, with which prebuilt voice, and how they sound overall.
CAST = {
    'narrator': dict(voice='Sulafat', style='Warm, playful storybook narrator reading to young children; smiling, bright, unhurried.'),
    'popo': dict(voice='Fenrir', style='Goofy, bouncy cartoon polar bear; a big cheerful grin, comically expressive.'),
    'swiftee': dict(voice='Leda', style='Tiny excited cartoon bird; quick, chirpy and squeaky with delight.'),
}

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


def record(who, text, note, key, model):
    cast = CAST[who]
    style = f"{cast['style']} {note}".strip()
    try:
        res = post(f'{API}/interactions', {
            'model': model,
            'input': [{'type': 'user_input', 'content': [{
                'type': 'text', 'text': spoken(text),
                'annotations': [{'type': 'speech_metadata', 'style': style}],
            }]}],
            'response_format': {'type': 'audio'},
            'generation_config': {'speech_config': [{'voice': cast['voice']}]},
        }, key)
    except urllib.error.HTTPError as e:
        if e.code not in (400, 404):
            raise
        # older API surface: generateContent returns raw 24 kHz 16-bit PCM
        res = post(f'{API}/models/{LEGACY_MODEL}:generateContent', {
            'contents': [{'parts': [{'text': f'Say it like this: {style}\n\n{spoken(text)}'}]}],
            'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {
                'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': cast['voice']}}}},
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


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--force', action='store_true', help='re-record clips that already exist')
    ap.add_argument('--only', choices=sorted(CAST), help='only record this speaker')
    ap.add_argument('--model', default=MODEL)
    args = ap.parse_args()
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    todo = [l for l in LINES if (args.force and (not args.only or l[0] == args.only))
            or not os.path.exists(os.path.join(RAW, slug(l[0], l[1]) + '.wav'))]
    key = api_key() if todo else None
    for who, text, note in todo:
        print(f'recording {who}: {text}')
        for attempt in range(3):
            try:
                rate, samples = record(who, text, note, key, args.model)
                break
            except urllib.error.HTTPError as e:
                detail = e.read().decode(errors='replace')[:300]
                if e.code in (429, 500, 503) and attempt < 2:
                    time.sleep(4 * (attempt + 1))
                    continue
                sys.exit(f'Gemini refused {who!r} {text!r}: HTTP {e.code} {detail}')
        save_wav(os.path.join(RAW, slug(who, text) + '.wav'), rate, samples)

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
