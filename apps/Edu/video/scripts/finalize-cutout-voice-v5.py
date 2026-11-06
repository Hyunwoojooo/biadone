"""Deliver two clean versions while preserving all earlier files."""
from pathlib import Path
import argparse
import json
import os
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'out'
WORK=OUT/'work/cutout-voice-v5'
ffmpeg='/Users/joo/.local/bin/ffmpeg'
ffprobe=ROOT/'node_modules/@remotion/compositor-darwin-arm64/ffprobe'
env={**os.environ,'DYLD_LIBRARY_PATH':str(ffprobe.parent)}

def probe(path):
    return json.loads(subprocess.check_output([str(ffprobe),'-v','error','-show_streams','-of','json',str(path)],env=env,text=True))

def june():
    timeline=json.loads((ROOT/'content/timeline.json').read_text())
    scenes={s['id']:s for s in timeline['scenes']}
    for name in ['intro','approach','closing']:
        info=next(s for s in probe(WORK/f'june-{name}.mp4')['streams'] if s['codec_type']=='video')
        if int(info['nb_frames'])!=scenes[name]['durationInFrames'] or info['pix_fmt']!='yuv420p':raise SystemExit('Unexpected clean clip: '+name)
    first=scenes['approach']['from']+scenes['approach']['durationInFrames'];last=scenes['closing']['from']
    filters=f'[1:v]setpts=PTS-STARTPTS[v0];[2:v]setpts=PTS-STARTPTS[v1];[0:v]trim=start_frame={first}:end_frame={last},setpts=PTS-STARTPTS[v2];[3:v]setpts=PTS-STARTPTS[v3];[v0][v1][v2][v3]concat=n=4:v=1:a=0[v]'
    target=OUT/'BiaDone-Edu-Curriculum-v5.mp4'
    with tempfile.TemporaryDirectory(prefix='june-',dir=WORK) as folder:
        temp=Path(folder)/target.name
        subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-n','-i',str(OUT/'BiaDone-Edu-Curriculum-v4.mp4'),'-i',str(WORK/'june-intro.mp4'),'-i',str(WORK/'june-approach.mp4'),'-i',str(WORK/'june-closing.mp4'),'-filter_complex',filters,'-map','[v]','-map','0:a:0','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-r','30','-frames:v',str(timeline['totalFrames']),'-c:a','copy','-movflags','+faststart','-metadata','title=BiaDone Edu · 배경 정리 · 기존 목소리',str(temp)],check=True)
        temp.replace(target)
    shutil.copy2(OUT/'BiaDone-Edu-Curriculum-v4.ko.srt',target.with_suffix('.ko.srt'))
    return {'file':str(target),'seconds':timeline['durationSeconds'],'voice':'June','audio':'original AAC copied'}

def juhyunwoo():
    timeline=json.loads((ROOT/'content/timeline-juhyunwoo.json').read_text())
    silent=WORK/'juhyunwoo-silent.mp4'
    info=next(s for s in probe(silent)['streams'] if s['codec_type']=='video')
    if int(info['nb_frames'])!=timeline['totalFrames'] or info['pix_fmt']!='yuv420p':raise SystemExit('Unexpected own-voice video encoding')
    target=OUT/'BiaDone-Edu-Curriculum-v5-Juhyunwoo.mp4'
    with tempfile.TemporaryDirectory(prefix='own-',dir=WORK) as folder:
        temp=Path(folder)/target.name
        subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-n','-i',str(silent),'-i',str(ROOT/'public/audio/juhyunwoo-v5/master.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t',str(timeline['durationSeconds']),'-movflags','+faststart','-metadata','title=BiaDone Edu · 주현우 목소리',str(temp)],check=True)
        temp.replace(target)
    return {'file':str(target),'seconds':timeline['durationSeconds'],'voice':'주현우','voice_id':timeline['voice_id']}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--only',choices=['june','juhyunwoo']);args=parser.parse_args()
    results=[]
    if args.only in [None,'june']:results.append(june())
    if args.only in [None,'juhyunwoo']:results.append(juhyunwoo())
    saved=WORK/'outputs.json'
    existing=json.loads(saved.read_text()) if saved.is_file() else []
    updated_files={item['file'] for item in results}
    saved.write_text(json.dumps([item for item in existing if item['file'] not in updated_files]+results,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(results,ensure_ascii=False))
