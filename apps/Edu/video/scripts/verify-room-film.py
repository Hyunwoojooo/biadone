"""Verify the delivered 30-second 3D study and preservation of existing work."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'out/room-film'
file=ROOT/'out/BiaDone-Edu-Room-Film-Study.mp4'
ffmpeg='/Users/joo/.local/bin/ffmpeg'
ffprobe=ROOT/'node_modules/@remotion/compositor-darwin-arm64/ffprobe'
env={**os.environ,'DYLD_LIBRARY_PATH':str(ffprobe.parent)}
probe=json.loads(subprocess.check_output([str(ffprobe),'-v','error','-show_streams','-show_format','-of','json',str(file)],env=env,text=True))
video=next(s for s in probe['streams'] if s['codec_type']=='video')
audio=next(s for s in probe['streams'] if s['codec_type']=='audio')
decode=subprocess.run([ffmpeg,'-v','error','-nostats','-progress','pipe:1','-i',str(file),'-map','0:v:0','-map','0:a:0','-f','null','-'],capture_output=True,text=True)
frames=int(re.findall(r'^frame=(\d+)',decode.stdout,re.M)[-1])
loudness=subprocess.run([ffmpeg,'-hide_banner','-i',str(file),'-af','loudnorm=I=-16.5:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
levels=json.loads(re.findall(r'\{\s*"input_i".*?\}',loudness.stderr,re.S)[-1])
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
baseline=json.loads((OUT/'baseline.json').read_text())
preservation=[{**entry,'unchanged':sha(ROOT.parent/entry['file'])==entry['sha256']} for entry in baseline]
production=json.loads((OUT/'audio-production.json').read_text())
render=json.loads((OUT/'render-log.json').read_text())
timeline=json.loads((ROOT/'content/timeline.json').read_text())
selected=[s for s in timeline['scenes'] if s['id'] in ['intro','content']]
narration_matches=all(''.join(json.loads((ROOT/'public'/s['alignment']).read_text())['alignment']['characters'])==s['narration'] for s in selected)
checks={
 'fullDecode':decode.returncode==0 and not decode.stderr.strip(),
 'frameCount':frames==900,
 'dimensions':video['width']==1920 and video['height']==1080,
 'fps':video['r_frame_rate']=='30/1',
 'videoEncoding':video['codec_name']=='h264' and video['pix_fmt']=='yuv420p',
 'audioEncoding':audio['codec_name']=='aac' and int(audio['sample_rate'])==48000 and audio['channels']==2,
 'duration':abs(float(probe['format']['duration'])-30)<.05,
 'audioDuration':abs(float(audio['duration'])-30)<.05,
 'audibleLoudness':-19<=float(levels['input_i'])<=-14,
 'noClipping':float(levels['input_tp'])<0,
 'subtitles':file.with_suffix('.ko.srt').is_file(),
 'narrationTextMatches':narration_matches,
 'sourceNarrationPreserved':sha(ROOT/'out/work/narration-master.wav')==production['sourceMasterSha256'],
 'existingFilesPreserved':all(p['unchanged'] for p in preservation),
 'noNewPaidGenerations':production['newPaidGenerationCalls']==0,
 'noBrowserErrors':not any(log['type']=='error' for log in render['logs']),
}
report={'file':str(file),'bytes':file.stat().st_size,'sha256':sha(file),'seconds':float(probe['format']['duration']),'frames':frames,'width':video['width'],'height':video['height'],'fps':video['r_frame_rate'],'videoEncoding':{'codec':video['codec_name'],'pixelFormat':video['pix_fmt']},'audio':{'codec':audio['codec_name'],'sampleRate':audio['sample_rate'],'channels':audio['channels'],'integratedLUFS':levels['input_i'],'truePeakDbTP':levels['input_tp']},'checks':checks,'preservation':preservation,'browserWarnings':list(dict.fromkeys(log['text'] for log in render['logs'] if log['type']=='warning')),'decodeErrors':decode.stderr.strip()}
(OUT/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='preservation'},ensure_ascii=False,indent=2))
if not all(checks.values()):raise SystemExit(1)
