"""Verify the final MP4. Optional argument: directory of motion-00..09 PNGs."""
from pathlib import Path
from fractions import Fraction
import json
import struct
import sys
import av
import numpy as np

root = Path(__file__).resolve().parent.parent
video = root / 'Biadon-Edu-Curriculum-1080p.mp4'
sample_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else None
times = [4, 14, 23, 31, 41, 50, 59, 72, 86, 97]
sample_frames = {int(t*30): (i, t) for i, t in enumerate(times)}


def block_ssim(left, right):
    """8x8 luminance SSIM, same pixel alignment and full-range gray conversion."""
    a = left.astype(np.float64).reshape(135, 8, 240, 8).transpose(0, 2, 1, 3)
    b = right.astype(np.float64).reshape(135, 8, 240, 8).transpose(0, 2, 1, 3)
    ma, mb = a.mean(axis=(2, 3)), b.mean(axis=(2, 3))
    va, vb = a.var(axis=(2, 3)), b.var(axis=(2, 3))
    cov = ((a-ma[:, :, None, None])*(b-mb[:, :, None, None])).mean(axis=(2, 3))
    c1, c2 = (0.01*255)**2, (0.03*255)**2
    return float((((2*ma*mb+c1)*(2*cov+c2))/((ma*ma+mb*mb+c1)*(va+vb+c2))).mean())


with av.open(str(video)) as container:
    vs, aus = container.streams.video[0], container.streams.audio[0]
    metadata = dict(width=vs.width, height=vs.height, fps=float(vs.average_rate),
                    video_codec=vs.codec_context.name, audio_codec=aus.codec_context.name,
                    audio_rate=aus.codec_context.sample_rate,
                    video_duration=float(vs.duration*vs.time_base),
                    audio_duration=float(aus.duration*aus.time_base),
                    video_start=float((vs.start_time or 0)*vs.time_base),
                    audio_start=float((aus.start_time or 0)*aus.time_base))
    count = 0
    comparisons = []
    for count, frame in enumerate(container.decode(video=0), start=1):
        index = count-1
        if index in sample_frames and sample_dir:
            i, t = sample_frames[index]
            reference = sample_dir / f'motion-{i:02}.png'
            if reference.exists():
                with av.open(str(reference)) as still:
                    rgb = next(still.decode(video=0)).to_ndarray(format='rgb24')
                a = np.rint(rgb @ np.array([.299, .587, .114])).astype(np.uint8)
                rgb = frame.to_ndarray(format='rgb24')
                b = np.rint(rgb @ np.array([.299, .587, .114])).astype(np.uint8)
                score = block_ssim(a, b)
                comparisons.append(dict(time=t, frame=index, luminance_ssim=score))
                assert score >= .97, (t, score)

assert metadata['width'] == 1920 and metadata['height'] == 1080
assert metadata['fps'] == 30 and count == 3000
assert metadata['video_codec'] == 'h264' and metadata['audio_codec'] == 'aac'
assert abs(metadata['video_duration']-100) < .001
assert abs(metadata['audio_duration']-100) < .05
assert metadata['video_start'] == metadata['audio_start'] == 0
atoms = []
with video.open('rb') as source:
    while True:
        header = source.read(8)
        if len(header) != 8:
            break
        size, kind = struct.unpack('>I4s', header)
        header_size = 8
        if size == 1:
            size, = struct.unpack('>Q', source.read(8))
            header_size = 16
        atoms.append(kind.decode('ascii', errors='replace'))
        if size == 0:
            break
        source.seek(size-header_size, 1)
assert atoms.index('moov') < atoms.index('mdat'), 'faststart metadata follows video data'
result = dict(**metadata, decoded_frames=count, faststart=True,
              file_bytes=video.stat().st_size, preview_comparisons=comparisons,
              verification='PASS', narration=False, soundtrack='original locally synthesized score')
(root / 'video-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
