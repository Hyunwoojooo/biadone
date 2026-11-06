"""Replace only the two corrected scenes; preserve the existing AAC stream."""
from pathlib import Path
import json
import os
import subprocess

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'out'
WORK=OUT/'work/line-fixes-v3'
timeline=json.loads((ROOT/'content/timeline.json').read_text())
approach=next(s for s in timeline['scenes'] if s['id']=='approach')
choice=next(s for s in timeline['scenes'] if s['id']=='choice')
base=OUT/'BiaDone-Edu-Curriculum-v2.mp4'
target=OUT/'BiaDone-Edu-Curriculum-v3.mp4'
ffprobe=ROOT/'node_modules/@remotion/compositor-darwin-arm64/ffprobe'
env={**os.environ,'DYLD_LIBRARY_PATH':str(ffprobe.parent)}
for scene in [approach,choice]:
    clip=WORK/(scene['id']+'.mp4')
    data=json.loads(subprocess.check_output([str(ffprobe),'-v','error','-select_streams','v:0','-show_entries','stream=nb_frames,width,height,r_frame_rate','-of','json',str(clip)],env=env,text=True))['streams'][0]
    if int(data['nb_frames'])!=scene['durationInFrames'] or data['r_frame_rate']!='30/1' or (data['width'],data['height'])!=(1920,1080):
        raise SystemExit('Unexpected replacement clip: '+scene['id'])
a0=approach['from']; a1=a0+approach['durationInFrames']
c0=choice['from']; c1=c0+choice['durationInFrames']
filters=f'[0:v]split=3[lead][middle][tail];[lead]trim=start_frame=0:end_frame={a0},setpts=PTS-STARTPTS[v0];[1:v]setpts=PTS-STARTPTS[v1];[middle]trim=start_frame={a1}:end_frame={c0},setpts=PTS-STARTPTS[v2];[2:v]setpts=PTS-STARTPTS[v3];[tail]trim=start_frame={c1}:end_frame={timeline["totalFrames"]},setpts=PTS-STARTPTS[v4];[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[v]'
subprocess.run(['/Users/joo/.local/bin/ffmpeg','-hide_banner','-loglevel','error','-n','-i',str(base),'-i',str(WORK/'approach.mp4'),'-i',str(WORK/'choice.mp4'),'-filter_complex',filters,'-map','[v]','-map','0:a:0','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-r','30','-frames:v',str(timeline['totalFrames']),'-c:a','copy','-movflags','+faststart','-metadata','title=BiaDone Edu · 커리큘럼 소개',str(target)],check=True)
print(json.dumps({'video':str(target),'replacementRanges':[[a0,a1-1],[c0,c1-1]],'audio':'copied unchanged'},ensure_ascii=False))
