"""Generate scene narration with ElevenLabs. The API key stays in process memory.

Run interactively: python3 scripts/generate-narration.py
Existing outputs are skipped. HTTP failures are reported without automatic paid retries.
"""
import base64
import getpass
import json
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
API = 'https://api.elevenlabs.io'


def request(key, path, payload=None):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(API + path, data=body, headers={
        'xi-api-key': key, 'Content-Type': 'application/json', 'Accept': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = json.loads(error.read().decode('utf-8'))
        print(json.dumps({'http_status': error.code, 'detail': detail.get('detail', 'request failed')}, ensure_ascii=False), flush=True)
        raise SystemExit(1) from None


def main():
    key = getpass.getpass('ElevenLabs API key (not saved): ')
    print('Fetching Korean male narration voices...', flush=True)
    query = urllib.parse.urlencode({'language': 'ko', 'gender': 'male', 'page_size': 30, 'sort': 'usage_character_count_1y', 'include_custom_rates': 'false', 'include_live_moderated': 'false'})
    shared = request(key, '/v1/shared-voices?' + query)
    voices = shared.get('voices', [])
    options = [{k: voice.get(k) for k in ('voice_id', 'name', 'description', 'accent', 'use_case', 'preview_url', 'free_users_allowed', 'live_moderation_enabled', 'rate')} for voice in voices]
    (ROOT / 'content' / 'voice-options.json').write_text(json.dumps(options, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(options, ensure_ascii=False, indent=2), flush=True)
    voice_id = input('Selected public voice ID: ').strip()
    selected = next((voice for voice in voices if voice.get('voice_id') == voice_id), None)
    if not selected:
        raise SystemExit('Selected ID was not in this response; no speech generated.')
    model_id = 'eleven_multilingual_v2'
    settings = {'stability': 0.67, 'similarity_boost': 0.78, 'style': 0.08, 'use_speaker_boost': True, 'speed': 0.97}
    scenes = json.loads((ROOT / 'content' / 'narration-scenes.json').read_text(encoding='utf-8'))
    audio_dir = ROOT / 'public' / 'audio' / 'curriculum'
    audio_dir.mkdir(parents=True, exist_ok=True)
    metadata = {'provider': 'ElevenLabs', 'voice_id': voice_id, 'voice_name': selected.get('name'), 'model_id': model_id, 'voice_settings': settings, 'scenes': []}
    for index, scene in enumerate(scenes):
        stem = f'{index+1:02d}-{scene["id"]}'
        audio_file = audio_dir / f'{stem}.mp3'
        timing_file = audio_dir / f'{stem}.alignment.json'
        if audio_file.exists() and timing_file.exists():
            existing = json.loads(timing_file.read_text(encoding='utf-8'))
            if ''.join((existing.get('alignment') or {}).get('characters', [])) != scene['narration']:
                raise SystemExit(f'{stem}: narration changed; use a new versioned output instead of silently reusing audio.')
            old_metadata_file = ROOT / 'content' / 'voice-production.json'
            if old_metadata_file.exists() and json.loads(old_metadata_file.read_text(encoding='utf-8')).get('voice_id') != voice_id:
                raise SystemExit(f'{stem}: voice differs; use a new versioned output.')
            print(f'Skip existing {stem}', flush=True)
        else:
            print(f'Generating {stem} ({len(scene["narration"])} characters)...', flush=True)
            result = request(key, f'/v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128', {
                'text': scene['narration'], 'model_id': model_id,
                'voice_settings': settings, 'previous_text': scenes[index-1]['narration'] if index else '',
                'next_text': scenes[index+1]['narration'] if index+1 < len(scenes) else '',
            })
            audio_file.write_bytes(base64.b64decode(result['audio_base64']))
            timing_file.write_text(json.dumps({k: result.get(k) for k in ('alignment', 'normalized_alignment')}, ensure_ascii=False, indent=2), encoding='utf-8')
        metadata['scenes'].append({'id': scene['id'], 'audio': f'audio/curriculum/{stem}.mp3', 'alignment': f'audio/curriculum/{stem}.alignment.json'})
        print(f'Saved {audio_file.name}', flush=True)
    (ROOT / 'content' / 'voice-production.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    key = None
    print('Narration completed. No key was written to disk.', flush=True)


if __name__ == '__main__':
    main()
