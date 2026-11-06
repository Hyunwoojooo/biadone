"""Assemble the checked scene audio at exact frame offsets, normalize, and mux.

The original Remotion render and original generated audio remain available.
"""
from pathlib import Path
import json
import os
import re
import subprocess

ROOT=Path(__file__).resolve().parents[1]
FFMPEG=os.environ.get('FFMPEG_PATH','/Users/joo/.local/bin/ffmpeg')
OUT=ROOT/'out'
WORK=OUT/'work'
WORK.mkdir(exist_ok=True)
final=OUT/'BiaDone-Edu-Curriculum.mp4'
raw=WORK/'BiaDone-Edu-Curriculum-render.mp4'
if not raw.exists():
    if not final.exists():
        raise SystemExit('Render the video first.')
    final.rename(raw)
timeline=json.loads((ROOT/'content/timeline.json').read_text())
fps=timeline['fps']
duration=timeline['totalFrames']/fps
args=[FFMPEG,'-hide_banner','-y']
filters=[]
for index,scene in enumerate(timeline['scenes']):
    args+=['-i',str(ROOT/'public'/scene['audio'])]
    if scene['audioFrames']+timeline['leadFrames']+2>scene['durationInFrames']:
        raise SystemExit(f'{scene["id"]}: speech would be cut.')
    align=json.loads((ROOT/'public'/scene['alignment']).read_text())['alignment']
    if ''.join(align['characters'])!=scene['narration']:
        raise SystemExit(f'{scene["id"]}: narration and audio alignment differ.')
    samples=round((scene['from']+timeline['leadFrames'])/fps*48000)
    filters.append(f'[{index}:a]aresample=48000,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS,adelay={samples}S:all=1[a{index}]')
filters.append(''.join(f'[a{i}]' for i in range(len(timeline['scenes'])))+f'amix=inputs={len(timeline["scenes"])}:duration=longest:normalize=0,apad=whole_dur={duration},atrim=duration={duration}[master]')
unprocessed=WORK/'narration-raw.wav'
master=WORK/'narration-master.wav'
subprocess.run(args+['-filter_complex',';'.join(filters),'-map','[master]','-ar','48000','-c:a','pcm_s16le',str(unprocessed)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
analysis=subprocess.run([FFMPEG,'-hide_banner','-i',str(unprocessed),'-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],check=True,capture_output=True,text=True)
stats=json.loads(re.findall(r'\{\s*"input_i".*?\}',analysis.stderr,re.S)[-1])
settings=f'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={stats["input_i"]}:measured_TP={stats["input_tp"]}:measured_LRA={stats["input_lra"]}:measured_thresh={stats["input_thresh"]}:offset={stats["target_offset"]}:linear=true:print_format=json'
normalized=subprocess.run([FFMPEG,'-hide_banner','-y','-i',str(unprocessed),'-af',settings,'-ar','48000','-c:a','pcm_s16le',str(master)],check=True,capture_output=True,text=True)
normalization=json.loads(re.findall(r'\{\s*"input_i".*?\}',normalized.stderr,re.S)[-1])
subprocess.run([FFMPEG,'-hide_banner','-y','-i',str(raw),'-i',str(master),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-metadata','title=BiaDone Edu · 커리큘럼 소개','-movflags','+faststart','-t',str(duration),str(final)],check=True,capture_output=True)
(OUT/'audio-mastering.json').write_text(json.dumps({'target_I':-16,'target_TP':-1.5,'normalization':normalization,'durationSeconds':duration,'brand_pronunciation':'비아던 에듀','rawVideo':str(raw.relative_to(ROOT))},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'output':str(final),'durationSeconds':duration,'normalized_I':normalization['output_i'],'true_peak':normalization['output_tp'],'subtitles':'separate Korean SRT'},ensure_ascii=False))
