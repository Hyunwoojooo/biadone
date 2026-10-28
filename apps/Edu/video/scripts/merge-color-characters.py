"""Replace the three character scenes in v3 and stream-copy its narration."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'out'
WORK=OUT/'work/color-characters-v4'
base=OUT/'BiaDone-Edu-Curriculum-v3.mp4'
target=OUT/'BiaDone-Edu-Curriculum-v4.mp4'
timeline=json.loads((ROOT/'content/timeline.json').read_text())
scenes={s['id']:s for s in timeline['scenes']}
ffprobe=ROOT/'node_modules/@remotion/compositor-darwin-arm64/ffprobe'
env={**os.environ,'DYLD_LIBRARY_PATH':str(ffprobe.parent)}
for name in ['intro','approach','closing']:
    p=WORK/(name+'.mp4')
    info=json.loads(subprocess.check_output([str(ffprobe),'-v','error','-select_streams','v:0','-show_streams','-of','json',str(p)],env=env,text=True))['streams'][0]
    if int(info['nb_frames'])!=scenes[name]['durationInFrames'] or info['r_frame_rate']!='30/1' or (info['width'],info['height'])!=(1920,1080) or info['pix_fmt']!='yuv420p':
        raise SystemExit('Unexpected character replacement clip: '+name)
middle_from=scenes['approach']['from']+scenes['approach']['durationInFrames']
middle_to=scenes['closing']['from']
filters=f'[1:v]setpts=PTS-STARTPTS[v0];[2:v]setpts=PTS-STARTPTS[v1];[0:v]trim=start_frame={middle_from}:end_frame={middle_to},setpts=PTS-STARTPTS[v2];[3:v]setpts=PTS-STARTPTS[v3];[v0][v1][v2][v3]concat=n=4:v=1:a=0[v]'
with tempfile.TemporaryDirectory(prefix='merge-',dir=WORK) as folder:
    temp=Path(folder)/target.name
    subprocess.run(['/Users/joo/.local/bin/ffmpeg','-hide_banner','-loglevel','error','-n','-i',str(base),'-i',str(WORK/'intro.mp4'),'-i',str(WORK/'approach.mp4'),'-i',str(WORK/'closing.mp4'),'-filter_complex',filters,'-map','[v]','-map','0:a:0','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-r','30','-frames:v',str(timeline['totalFrames']),'-c:a','copy','-movflags','+faststart','-metadata','title=BiaDone Edu · 컬러 캐릭터 커리큘럼 소개',str(temp)],check=True)
    temp.replace(target)
shutil.copy2(OUT/'BiaDone-Edu-Curriculum.ko.srt',target.with_suffix('.ko.srt'))
report={'file':str(target),'base':str(base),'replacementScenes':['intro','approach','closing'],'otherSceneFrameRange':[middle_from,middle_to-1],'audio':'copied unchanged AAC','color':'original RGB assets with no recoloring or grayscale filters','newPaidGenerationCalls':0}
(WORK/'revision.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
