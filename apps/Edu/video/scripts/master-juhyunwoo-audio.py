"""Place the new voice clips at their measured frame offsets and master once."""
from pathlib import Path
import json
import re
import subprocess

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'out/work/cutout-voice-v5'
WORK.mkdir(parents=True,exist_ok=True)
timeline=json.loads((ROOT/'content/timeline-juhyunwoo.json').read_text())
ffmpeg='/Users/joo/.local/bin/ffmpeg'
args=[ffmpeg,'-hide_banner','-loglevel','error','-y']
filters=[]
for i,scene in enumerate(timeline['scenes']):
    alignment=json.loads((ROOT/'public'/scene['alignment']).read_text())['alignment']
    if ''.join(alignment['characters'])!=scene['narration']:raise SystemExit('Narration differs: '+scene['id'])
    if scene['audioFrames']+timeline['leadFrames']+2>scene['durationInFrames']:raise SystemExit('Scene would cut speech: '+scene['id'])
    args+=['-i',str(ROOT/'public'/scene['audio'])]
    samples=round((scene['from']+timeline['leadFrames'])/timeline['fps']*48000)
    filters.append(f'[{i}:a]aresample=48000,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS,adelay={samples}S:all=1[a{i}]')
filters.append(''.join(f'[a{i}]' for i in range(len(timeline['scenes'])))+f'amix=inputs={len(timeline["scenes"])}:duration=longest:normalize=0,apad=whole_dur={timeline["durationSeconds"]},atrim=duration={timeline["durationSeconds"]}[master]')
raw=WORK/'juhyunwoo-raw.wav'
master=ROOT/'public/audio/juhyunwoo-v5/master.wav'
subprocess.run(args+['-filter_complex',';'.join(filters),'-map','[master]','-ar','48000','-c:a','pcm_s16le',str(raw)],check=True,capture_output=True)
measure=subprocess.run([ffmpeg,'-hide_banner','-i',str(raw),'-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],check=True,capture_output=True,text=True)
stats=json.loads(re.findall(r'\{\s*"input_i".*?\}',measure.stderr,re.S)[-1])
settings=f'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={stats["input_i"]}:measured_TP={stats["input_tp"]}:measured_LRA={stats["input_lra"]}:measured_thresh={stats["input_thresh"]}:offset={stats["target_offset"]}:linear=true:print_format=json'
result=subprocess.run([ffmpeg,'-hide_banner','-y','-i',str(raw),'-af',settings,'-ar','48000','-c:a','pcm_s16le',str(master)],check=True,capture_output=True,text=True)
normalization=json.loads(re.findall(r'\{\s*"input_i".*?\}',result.stderr,re.S)[-1])
(WORK/'juhyunwoo-mastering.json').write_text(json.dumps({'voice_id':timeline['voice_id'],'voice_name':timeline['voice_name'],'durationSeconds':timeline['durationSeconds'],'normalization':normalization,'master':str(master.relative_to(ROOT))},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'master':str(master),'seconds':timeline['durationSeconds'],'outputLUFS':normalization['output_i'],'truePeak':normalization['output_tp']},ensure_ascii=False))
