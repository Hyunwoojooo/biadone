"""Explicit, versioned regeneration of the two brand-name clips; preserves previous audio."""
import base64
import getpass
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('speech',Path(__file__).with_name('generate-narration.py'))
speech=importlib.util.module_from_spec(spec)
spec.loader.exec_module(speech)

key=getpass.getpass('ElevenLabs API key (not saved): ')
scenes=json.loads((ROOT/'content/narration-scenes.json').read_text())
production=json.loads((ROOT/'content/voice-production.json').read_text())
for index,scene in enumerate(scenes):
    if scene['id'] not in ('intro','closing'):
        continue
    stem=f'{index+1:02d}-{scene["id"]}-brand'
    folder=ROOT/'public/audio/curriculum'
    audio_file=folder/(stem+'.mp3')
    alignment_file=folder/(stem+'.alignment.json')
    if audio_file.exists() or alignment_file.exists():
        raise SystemExit(f'{stem} already exists; no paid retry was made.')
    print(f'Generating {stem}...',flush=True)
    result=speech.request(key,f'/v1/text-to-speech/{production["voice_id"]}/with-timestamps?output_format=mp3_44100_128',{
        'text':scene['narration'],'model_id':production['model_id'],'voice_settings':production['voice_settings'],
        'previous_text':scenes[index-1]['narration'] if index else '',
        'next_text':scenes[index+1]['narration'] if index+1<len(scenes) else '',
    })
    audio_file.write_bytes(base64.b64decode(result['audio_base64']))
    alignment_file.write_text(json.dumps({k:result.get(k) for k in ('alignment','normalized_alignment')},ensure_ascii=False,indent=2))
    for clip in production['scenes']:
        if clip['id']==scene['id']:
            clip['audio']=f'audio/curriculum/{audio_file.name}'
            clip['alignment']=f'audio/curriculum/{alignment_file.name}'
    print(f'Saved {stem}.',flush=True)
production['brand_pronunciation']='비아던 에듀'
(ROOT/'content/voice-production.json').write_text(json.dumps(production,ensure_ascii=False,indent=2)+'\n')
key=None
