"""Generate only the requested private voice; never persist or log credentials.

The optional session file reads only the user's earlier ElevenLabs-key reply in
this same conversation. No other messages, credentials, or account data are saved.
Successful clips are reused; ambiguous or failed paid calls are not retried.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
API='https://api.elevenlabs.io'
VOICE='OPFjzL0JpsgltRkDljyO'
MODEL='eleven_multilingual_v2'
SETTINGS={'stability':.67,'similarity_boost':.78,'style':.08,'use_speaker_boost':True,'speed':.97}
PRODUCTION=ROOT/'content/voice-juhyunwoo-production.json'

def credential(path):
    for name in ['ELEVENLABS_API_KEY','ELEVEN_LABS_API_KEY','XI_API_KEY']:
        if os.environ.get(name):return os.environ[name]
    if not path:raise SystemExit('No local ElevenLabs credential is configured.')
    matches=[]
    with Path(path).open() as lines:
        for line in lines:
            try:event=json.loads(line)
            except ValueError:continue
            payload=event.get('payload',{})
            if event.get('type')!='response_item' or payload.get('type')!='message' or payload.get('role')!='user':continue
            for item in payload.get('content',[]):
                found=re.search(r'<send_user_message_question_reply>\s*(.*?)\s*</send_user_message_question_reply>',item.get('text',''),re.S)
                if not found:continue
                try:answers=json.loads(found.group(1))
                except ValueError:continue
                for answer in answers:
                    question=answer.get('question','');value=answer.get('answer','')
                    if 'ElevenLabs' in question and 'API' in question and value.startswith('sk_') and len(value)>25:matches.append(value)
    if not matches:raise SystemExit('No previously supplied ElevenLabs credential was found in this session.')
    return matches[-1]

def request(key,path,payload=None):
    raw=None if payload is None else json.dumps(payload,ensure_ascii=False).encode()
    req=urllib.request.Request(API+path,data=raw,headers={'xi-api-key':key,'Content-Type':'application/json','Accept':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=120) as response:
            data=json.load(response)
            meta={name:response.headers.get(name) for name in ['request-id','character-cost'] if response.headers.get(name)}
            return data,meta
    except urllib.error.HTTPError as error:
        body=error.read().decode('utf-8','replace').replace(key,'[REDACTED]')
        raise RuntimeError(json.dumps({'httpStatus':error.code,'detail':body[:900]},ensure_ascii=False)) from None
    except urllib.error.URLError as error:
        raise RuntimeError('Network request failed: '+str(error.reason).replace(key,'[REDACTED]')) from None

def save(data):
    PRODUCTION.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

def usage(key):
    try:
        data,_=request(key,'/v1/user/subscription')
        return {name:data.get(name) for name in ['character_count','character_limit']}
    except RuntimeError:return None

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--credential-session-file')
    parser.add_argument('--generate',action='store_true')
    args=parser.parse_args()
    key=credential(args.credential_session_file)
    voice,_=request(key,'/v1/voices/'+VOICE)
    if voice.get('voice_id')!=VOICE:raise SystemExit('Unexpected voice ID; speech was not generated.')
    metadata=json.loads(PRODUCTION.read_text()) if PRODUCTION.exists() else {'provider':'ElevenLabs','voice_id':VOICE,'voice_name':voice.get('name','주현우'),'model_id':MODEL,'voice_settings':SETTINGS,'brand_pronunciation':'비아던 에듀','scenes':[]}
    if metadata['voice_id']!=VOICE or metadata['model_id']!=MODEL:raise SystemExit('Production voice mismatch.')
    metadata['voice_name']=voice.get('name','주현우')
    metadata['voice_category']=voice.get('category')
    if not args.generate:
        print(json.dumps({'voice_id':VOICE,'voice_name':metadata['voice_name'],'category':voice.get('category'),'is_owner':voice.get('is_owner'),'paidSpeechRequests':0},ensure_ascii=False),flush=True)
        save(metadata)
        return
    scenes=json.loads((ROOT/'content/timeline.json').read_text())['scenes']
    audio=ROOT/'public/audio/juhyunwoo-v5';audio.mkdir(parents=True,exist_ok=True)
    if 'usage_before' not in metadata:metadata['usage_before']=usage(key)
    save(metadata)
    for index,scene in enumerate(scenes):
        stem=f'{index+1:02d}-{scene["id"]}'
        sound=audio/(stem+'.mp3');alignment=audio/(stem+'.alignment.json')
        previous=next((item for item in metadata['scenes'] if item['id']==scene['id']),None)
        if sound.is_file() and alignment.is_file():
            existing=json.loads(alignment.read_text())
            if ''.join(existing['alignment']['characters'])!=scene['narration']:raise SystemExit(stem+': narration differs from the saved clip.')
            if previous is None:raise SystemExit(stem+': saved audio has no production record.')
            print('Reuse '+stem,flush=True)
            continue
        if previous and previous.get('status')=='pending':raise SystemExit(stem+': previous paid call is unresolved; no automatic retry.')
        record={'id':scene['id'],'audio':f'audio/juhyunwoo-v5/{stem}.mp3','alignment':f'audio/juhyunwoo-v5/{stem}.alignment.json','characters':len(scene['narration']),'status':'pending'}
        metadata['scenes']=[item for item in metadata['scenes'] if item['id']!=scene['id']]+[record]
        save(metadata)
        print(f'Generate {stem} ({record["characters"]} characters)',flush=True)
        result,headers=request(key,f'/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_128',{'text':scene['narration'],'model_id':MODEL,'voice_settings':SETTINGS,'previous_text':scenes[index-1]['narration'] if index else '', 'next_text':scenes[index+1]['narration'] if index+1<len(scenes) else ''})
        sound.write_bytes(base64.b64decode(result['audio_base64']))
        alignment.write_text(json.dumps({name:result.get(name) for name in ['alignment','normalized_alignment']},ensure_ascii=False,indent=2)+'\n')
        record.update({'status':'complete','request':headers})
        save(metadata)
        if ''.join(result['alignment']['characters'])!=scene['narration']:raise SystemExit(stem+': generated text alignment differs; inspect the saved response before proceeding.')
        print('Saved '+stem,flush=True)
    metadata['usage_after']=usage(key)
    metadata['generated_characters']=sum(item['characters'] for item in metadata['scenes'] if item.get('status')=='complete')
    metadata['completed_clips']=sum(item.get('status')=='complete' for item in metadata['scenes'])
    save(metadata)
    key=None
    print(json.dumps({'completedClips':metadata['completed_clips'],'characters':metadata['generated_characters'],'voice':metadata['voice_name'],'usageBefore':metadata.get('usage_before'),'usageAfter':metadata.get('usage_after'),'credentialSaved':False},ensure_ascii=False),flush=True)

if __name__=='__main__':
    try:main()
    except RuntimeError as error:raise SystemExit(str(error)) from None
