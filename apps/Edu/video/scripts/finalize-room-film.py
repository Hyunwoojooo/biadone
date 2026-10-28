from pathlib import Path
import json
import os
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'out'
silent=OUT/'room-film/work/RoomFilm-silent.mp4'
audio=ROOT/'public/room-film/room-film-master.wav'
target=OUT/'BiaDone-Edu-Room-Film-Study.mp4'
ffprobe=ROOT/'node_modules/@remotion/compositor-darwin-arm64/ffprobe'
env={**os.environ,'DYLD_LIBRARY_PATH':str(ffprobe.parent)}
info=json.loads(subprocess.check_output([str(ffprobe),'-v','error','-select_streams','v:0','-show_streams','-of','json',str(silent)],env=env,text=True))['streams'][0]
normalize=info.get('color_range')=='pc' or info['pix_fmt'].startswith('yuvj')
codec=['-c:v','copy']
if normalize:
    matrix='bt709' if info.get('color_space')=='bt709' else 'bt601'
    codec=['-vf',f'scale=in_range=full:out_range=limited:in_color_matrix={matrix}:out_color_matrix=bt709,format=yuv420p','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709']
with tempfile.TemporaryDirectory(prefix='delivery-',dir=silent.parent) as folder:
    temp=Path(folder)/target.name
    subprocess.run(['/Users/joo/.local/bin/ffmpeg','-hide_banner','-loglevel','error','-n','-i',str(silent),'-i',str(audio),'-map','0:v:0','-map','1:a:0',*codec,'-c:a','aac','-b:a','192k','-ar','48000','-t','30','-map_metadata','-1','-metadata','title=BiaDone Edu · 방 안으로 들어가는 연출 샘플','-movflags','+faststart',str(temp)],check=True)
    temp.replace(target)
print(json.dumps({'video':str(target),'seconds':30,'sourcePixelFormat':info['pix_fmt'],'normalizedColorRange':normalize},ensure_ascii=False))
