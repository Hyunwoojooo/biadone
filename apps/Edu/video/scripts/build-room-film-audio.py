"""Reuse existing narration and synthesize restrained original Foley locally."""
from array import array
from pathlib import Path
import hashlib
import json
import math
import random
import subprocess
import wave

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'out/room-film'
PUBLIC=ROOT/'public/room-film'
OUT.mkdir(parents=True,exist_ok=True)
PUBLIC.mkdir(parents=True,exist_ok=True)
RATE=48000
DURATION=30
bed=array('f',[0.0])*(RATE*DURATION*2)
rng=random.Random(1729)

def event(at,length,amp,kind,freq=150,pan=0):
    first=max(0,int(at*RATE))
    count=min(int(length*RATE),RATE*DURATION-first)
    left=math.sqrt((1-pan)/2)
    right=math.sqrt((1+pan)/2)
    low=0.0
    for j in range(count):
        t=j/RATE
        p=j/max(1,count-1)
        noise=rng.uniform(-1,1)
        low=.88*low+.12*noise
        if kind=='step':
            s=(.75*math.sin(2*math.pi*(85-35*p)*t)+.4*low)*math.exp(-t*35)*min(1,t/.006)
        elif kind=='key':
            s=(noise*.4+math.sin(2*math.pi*1100*t)*.3)*math.exp(-t*150)*min(1,t/.0008)
        elif kind=='paper':
            s=(noise-low)*math.sin(math.pi*p)**2*.6
        elif kind=='door':
            s=(.4*low+.2*math.sin(2*math.pi*(190+15*math.sin(t*8))*t))*math.sin(math.pi*p)**2
        else:
            s=(math.sin(2*math.pi*freq*t)+.23*math.sin(2*math.pi*freq*2*t)+.08*math.sin(2*math.pi*freq*3*t))*min(1,t/.012)*math.exp(-t*2.7)
        ix=(first+j)*2
        bed[ix]+=s*amp*left
        bed[ix+1]+=s*amp*right

for i,at in enumerate([.96,1.53,2.10,2.67,3.24,3.81,4.38,4.95,5.52,6.09,6.66,7.23]):
    event(at,.14,.065,'step',pan=-.12 if i%2 else .12)
event(2.4,1.8,.012,'door',pan=.3)
for station,pan in enumerate([-.55,0,.55]):
    at=8.3+station*.11
    while at<26.4:
        event(at,.038,.012,'key',pan=pan)
        at+=rng.uniform(.16,.43)
for at,pan in [(10.2,-.4),(15.9,-.4),(16.65,0),(21.75,.45),(24.2,.45)]:
    event(at,.25,.028,'paper',pan=pan)
for at,notes in [(0.15,[146.83,220.0]),(8.3,[293.66,369.99]),(12,[220.0,329.63]),(17,[246.94,369.99]),(22,[293.66,440]),(26.5,[146.83,293.66,369.99]),(28,[220.0,440.0])]:
    for i,note in enumerate(notes):
        event(at+i*.14,1.7,.013,'note',note,pan=(i-(len(notes)-1)/2)*.35)
foley=OUT/'foley-score.wav'
pcm=array('h',(int(max(-.95,min(.95,v))*32767) for v in bed))
with wave.open(str(foley),'wb') as out:
    out.setnchannels(2);out.setsampwidth(2);out.setframerate(RATE);out.writeframes(pcm.tobytes())

source=ROOT/'out/work/narration-master.wav'
master=PUBLIC/'room-film-master.wav'
filters='[0:a]asplit=2[intro][content];[intro]atrim=start=0:end=12.066667,asetpts=PTS-STARTPTS,apad,atrim=0:30[a0];[content]atrim=start=53.6:end=67.733333,asetpts=PTS-STARTPTS,adelay=12000:all=1,apad,atrim=0:30[a1];[a0][a1][1:a]amix=inputs=3:duration=longest:normalize=0,loudnorm=I=-16.5:TP=-1.5:LRA=11,aresample=48000[master]'
subprocess.run(['/Users/joo/.local/bin/ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),'-i',str(foley),'-filter_complex',filters,'-map','[master]','-t','30','-ar','48000','-ac','2','-c:a','pcm_s16le',str(master)],check=True)

def timestamp(value):
    ms=round(value*1000)
    return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'
def seconds(value):
    h,m,s=value.replace(',','.').split(':')
    return int(h)*3600+int(m)*60+float(s)
subtitles=[]
for block in (ROOT/'out/BiaDone-Edu-Curriculum.ko.srt').read_text().strip().split('\n\n'):
    lines=block.splitlines()
    if len(lines)<3:continue
    a,b=map(seconds,lines[1].split(' --> '))
    if a<12.066667:
        subtitles.append((a,min(b,12.066667),'\n'.join(lines[2:])))
    elif 53.6<=a<67.733333:
        subtitles.append((a-53.6+12,min(b,67.733333)-53.6+12,'\n'.join(lines[2:])))
(ROOT/'out/BiaDone-Edu-Room-Film-Study.ko.srt').write_text('\n\n'.join(f'{i+1}\n{timestamp(a)} --> {timestamp(b)}\n{text}' for i,(a,b,text) in enumerate(subtitles))+'\n')
report={'durationSeconds':DURATION,'sampleRate':RATE,'narrationReused':True,'sourceMasterSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'narrationSegments':[{'sourceFrom':0,'sourceTo':12.066667,'start':0},{'sourceFrom':53.6,'sourceTo':67.733333,'start':12}],'soundDesign':'original locally synthesized footsteps, typing, paper, door and short instrumental notes','newPaidGenerationCalls':0}
(OUT/'audio-production.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'master':str(master),'durationSeconds':DURATION,'newPaidGenerationCalls':0}))
