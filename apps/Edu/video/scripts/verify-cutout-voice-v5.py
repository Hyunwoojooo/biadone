"""Check preservation, real RGBA assets, and clean backgrounds in encoded frames."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'out/work/cutout-voice-v5'
ffmpeg='/Users/joo/.local/bin/ffmpeg'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
baseline=json.loads((WORK/'baseline.json').read_text())
preserved=[{**item,'unchanged':sha(ROOT.parent/item['file'])==item['sha256']} for item in baseline]
assets=[]
for name in ['04-thinking.png','08-explaining.png','07-thumbs-up.png']:
    file=ROOT/'public/character/cutout-v5'/name
    data=file.read_bytes()
    assets.append({'file':str(file.relative_to(ROOT)),'rgba':data[:8]==b'\x89PNG\r\n\x1a\n' and data[25]==6,'sha256':sha(file)})
def audio_hash(path):
    raw=subprocess.check_output([ffmpeg,'-v','error','-i',str(path),'-map','0:a:0','-c:a','copy','-f','adts','pipe:1'])
    return hashlib.sha256(raw).hexdigest()
points={'intro':[(392,425),(773,425)],'approach':[(273,464),(609,464)],'closing':[(454,466),(796,466)]}
visual=[]
for voice,basename,timeline_file in [('June','BiaDone-Edu-Curriculum-v5','timeline.json'),('주현우','BiaDone-Edu-Curriculum-v5-Juhyunwoo','timeline-juhyunwoo.json')]:
    timeline=json.loads((ROOT/'content'/timeline_file).read_text())
    mp4=ROOT/'out'/(basename+'.mp4')
    for id in ['intro','approach','closing']:
        scene=next(s for s in timeline['scenes'] if s['id']==id)
        time=(scene['from']+int(scene['durationInFrames']*.74))/30
        pixels=subprocess.check_output([ffmpeg,'-v','error','-ss',str(time),'-i',str(mp4),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
        if len(pixels)!=1920*1080*3:raise SystemExit('Unexpected inspection frame')
        colors=[list(pixels[(y*1920+x)*3:(y*1920+x)*3+3]) for x,y in points[id]]
        row={'voice':voice,'scene':id,'backgroundSamples':colors,'whiteBackground':all(min(color)>=250 for color in colors)}
        if id=='intro':
            region=[pixels[(y*1920+x)*3:(y*1920+x)*3+3] for y in range(866,920,2) for x in range(380,790,2)]
            ratio=sum(min(color)<245 for color in region)/len(region)
            row.update({'removedCaptionDarkPixelFraction':ratio,'workCaptionRemoved':ratio<.001})
        visual.append(row)
production=json.loads((ROOT/'content/voice-juhyunwoo-production.json').read_text())
checks={'earlierFilesPreserved':all(item['unchanged'] for item in preserved),'allThreeAssetsRGBA':all(item['rgba'] for item in assets),'allCharacterScenesHaveWhiteBackground':all(row['whiteBackground'] for row in visual),'workCaptionRemovedInBothVersions':all(row.get('workCaptionRemoved',True) for row in visual),'juneNarrationBitstreamMatchesV4':audio_hash(ROOT/'out/BiaDone-Edu-Curriculum-v4.mp4')==audio_hash(ROOT/'out/BiaDone-Edu-Curriculum-v5.mp4'),'requestedVoiceUsed':production['voice_id']=='OPFjzL0JpsgltRkDljyO' and production['voice_name']=='주현우' and production['completed_clips']==12}
report={'checks':checks,'assets':assets,'visualChecks':visual,'preserved':preserved,'newSpeechClips':production['completed_clips'],'newSpeechCharacters':production['generated_characters'],'newImageEdits':3}
(WORK/'preservation-and-visual.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ['assets','preserved']},ensure_ascii=False,indent=2))
if not all(checks.values()):raise SystemExit(1)
