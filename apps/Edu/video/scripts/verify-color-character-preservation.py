"""Confirm exact source colors, unchanged AAC, and preservation of prior films."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'out/work/color-characters-v4'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=json.loads((ROOT/'content/color-character-sources-v4.json').read_text())
assets=[]
for asset in manifest['assets']:
    source=Path(asset['source'])
    copied=ROOT/asset['file']
    assets.append({'file':asset['file'],'matchesSource':sha(source)==sha(copied)==asset['sha256'],'rgbPNG':copied.read_bytes()[25]==2})
baseline=json.loads((WORK/'baseline.json').read_text())
preserved=[{**entry,'unchanged':sha(ROOT.parent/entry['file'])==entry['sha256']} for entry in baseline]
def audio_hash(path):
    data=subprocess.check_output(['/Users/joo/.local/bin/ffmpeg','-v','error','-i',str(path),'-map','0:a:0','-c:a','copy','-f','adts','pipe:1'])
    return hashlib.sha256(data).hexdigest()
base=ROOT/'out/BiaDone-Edu-Curriculum-v3.mp4'
target=ROOT/'out/BiaDone-Edu-Curriculum-v4.mp4'
checks={'originalColorAssetsIdentical':all(a['matchesSource'] and a['rgbPNG'] for a in assets),'previousFilesUnchanged':all(p['unchanged'] for p in preserved),'narrationBitstreamMatchesV3':audio_hash(base)==audio_hash(target)}
report={'checks':checks,'assets':assets,'preserved':preserved,'newPaidGenerationCalls':0,'outputSha256':sha(target),'bytes':target.stat().st_size}
(WORK/'preservation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ['assets','preserved']},ensure_ascii=False,indent=2))
if not all(checks.values()):raise SystemExit(1)
