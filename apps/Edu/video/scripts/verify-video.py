"""Check the finished encoded file rather than only its source composition."""
from pathlib import Path
import json
import os
import re
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'out'
file=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else OUT/'BiaDone-Edu-Curriculum.mp4'
report_file=Path(sys.argv[2]).resolve() if len(sys.argv)>2 else OUT/'verification.json'
subtitle_file=file.with_suffix('.ko.srt')
if not subtitle_file.is_file() and len(sys.argv)<=3:
    subtitle_file=OUT/'BiaDone-Edu-Curriculum.ko.srt'
timeline_file=Path(sys.argv[3]).resolve() if len(sys.argv)>3 else ROOT/'content/timeline.json'
timeline=json.loads(timeline_file.read_text())
ffprobe=ROOT/'node_modules/@remotion/compositor-darwin-arm64/ffprobe'
env={**os.environ,'DYLD_LIBRARY_PATH':str(ffprobe.parent)}
probe=json.loads(subprocess.check_output([str(ffprobe),'-v','error','-show_streams','-show_format','-of','json',str(file)],env=env,text=True))
video=next(s for s in probe['streams'] if s['codec_type']=='video')
audio=next(s for s in probe['streams'] if s['codec_type']=='audio')
subtitle_streams=[s for s in probe['streams'] if s['codec_type']=='subtitle']
decode=subprocess.run(['/Users/joo/.local/bin/ffmpeg','-v','error','-nostats','-progress','pipe:1','-i',str(file),'-map','0:v:0','-map','0:a:0','-f','null','-'],capture_output=True,text=True)
frames=int(re.findall(r'^frame=(\d+)',decode.stdout,re.M)[-1])
loudness=subprocess.run(['/Users/joo/.local/bin/ffmpeg','-hide_banner','-i',str(file),'-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
levels=json.loads(re.findall(r'\{\s*"input_i".*?\}',loudness.stderr,re.S)[-1])
def subtitle_seconds(value):
    hours,minutes,seconds=value.replace(',','.').split(':')
    return int(hours)*3600+int(minutes)*60+float(seconds)
subtitle_text=subtitle_file.read_text() if subtitle_file.is_file() else ''
subtitle_cues=[tuple(map(subtitle_seconds,cue)) for cue in re.findall(r'(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})',subtitle_text)]
subtitle_timing=bool(subtitle_cues) and all(0<=start<end<=timeline['durationSeconds']+.05 for start,end in subtitle_cues) and all(subtitle_cues[i][0]>=subtitle_cues[i-1][1]-.02 for i in range(1,len(subtitle_cues)))
checks={
 'fullDecode':decode.returncode==0 and not decode.stderr.strip(),
 'decodedFrameCount':frames==timeline['totalFrames'],
 'dimensions':video['width']==1920 and video['height']==1080,
 'fps':video['r_frame_rate']=='30/1',
 'codec':video['codec_name']=='h264' and video['pix_fmt']=='yuv420p',
 'audioPresent':audio['codec_name']=='aac' and int(audio['sample_rate'])==48000,
 'duration':abs(float(probe['format']['duration'])-timeline['durationSeconds'])<.05,
 'separateSubtitles':not subtitle_streams and subtitle_file.is_file(),
 'subtitleTiming':subtitle_timing,
 'audibleLoudness':-18<=float(levels['input_i'])<=-14,
 'noClipping':float(levels['input_tp'])<0,
}
scene_audio=[]
for scene in timeline['scenes']:
    alignment=json.loads((ROOT/'public'/scene['alignment']).read_text())['alignment']
    match=''.join(alignment['characters'])==scene['narration']
    spare=scene['durationInFrames']-scene['audioFrames']-timeline['leadFrames']
    scene_audio.append({'id':scene['id'],'textMatches':match,'spareFrames':spare,'file':scene['audio']})
checks['allNarrationMatches']=all(s['textMatches'] for s in scene_audio)
checks['noSceneAudioCut']=all(s['spareFrames']>=2 for s in scene_audio)
report={'file':str(file),'bytes':file.stat().st_size,'durationSeconds':float(probe['format']['duration']),'decodedFrames':frames,'width':video['width'],'height':video['height'],'fps':video['r_frame_rate'],'videoEncoding':{'codec':video['codec_name'],'pixelFormat':video['pix_fmt'],'colorRange':video.get('color_range')},'audio':{'codec':audio['codec_name'],'sampleRate':audio['sample_rate'],'channels':audio['channels'],'duration':audio.get('duration'),'integratedLUFS':levels['input_i'],'truePeakDbTP':levels['input_tp']},'subtitles':{'file':str(subtitle_file),'cues':len(subtitle_cues),'lastCueEnd':subtitle_cues[-1][1] if subtitle_cues else None},'checks':checks,'scenes':scene_audio,'decodeErrors':decode.stderr.strip()}
report_file.parent.mkdir(parents=True,exist_ok=True)
report_file.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='scenes'},ensure_ascii=False,indent=2))
if not all(checks.values()):
    raise SystemExit(1)
