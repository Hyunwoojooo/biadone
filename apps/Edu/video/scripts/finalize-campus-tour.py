"""Normalize delivery color range and reuse verified narration. No API calls."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'out'
video=OUT/'campus-tour/work/CampusTour-silent.mp4'
source=OUT/'BiaDone-Edu-Curriculum-v3.mp4'
audio_source=source if source.is_file() else ROOT/'public/campus-tour/narration-master.wav'
audio_codec=['-c:a','copy'] if source.is_file() else ['-c:a','aac','-b:a','192k','-ar','48000']
target=OUT/'BiaDone-Edu-Campus-Tour.mp4'
timeline=json.loads((ROOT/'content/timeline.json').read_text())
ffprobe=ROOT/'node_modules/@remotion/compositor-darwin-arm64/ffprobe'
env={**os.environ,'DYLD_LIBRARY_PATH':str(ffprobe.parent)}
probe=json.loads(subprocess.check_output([str(ffprobe),'-v','error','-select_streams','v:0','-show_streams','-of','json',str(video)],env=env,text=True))['streams'][0]
# JPEG browser frames can carry full-range YUV even with yuv420p requested.
# Convert the actual pixel values to limited range rather than only changing tags.
normalize_range=probe.get('color_range')=='pc' or probe['pix_fmt'].startswith('yuvj')
if normalize_range:
    video_codec=['-vf','scale=in_range=full:out_range=limited:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709']
else:
    video_codec=['-c:v','copy']
with tempfile.TemporaryDirectory(prefix='delivery-',dir=video.parent) as temp:
    encoded=Path(temp)/target.name
    subprocess.run(['/Users/joo/.local/bin/ffmpeg','-hide_banner','-loglevel','error','-n','-i',str(video),'-i',str(audio_source),'-map','0:v:0','-map','1:a:0',*video_codec,*audio_codec,'-map_metadata','-1','-metadata','title=BiaDone Edu · 캠퍼스 투어','-movflags','+faststart','-t',str(timeline['durationSeconds']),str(encoded)],check=True)
    encoded.replace(target)
shutil.copy2(OUT/'BiaDone-Edu-Curriculum.ko.srt',OUT/'BiaDone-Edu-Campus-Tour.ko.srt')
report={'video':str(target),'durationSeconds':timeline['durationSeconds'],'sourcePixelFormat':probe['pix_fmt'],'rangeNormalized':normalize_range,'narration':'reused existing verified AAC' if source.is_file() else 'encoded existing narration master','paidGenerations':0}
(OUT/'campus-tour/delivery-encoding.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
