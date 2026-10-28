"""Offline-only Korean narration transcription. Emits JSON progress to stdout.

This helper never downloads a model and never alters the original audio.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"


def emit(progress, message):
    print(json.dumps({"progress": progress, "message": message}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    arguments = parser.parse_args()
    from faster_whisper import WhisperModel
    import numpy as np

    emit(0.01, "로컬 한국어 음성 모델을 불러오고 있습니다.")
    model = WhisperModel(
        arguments.model,
        device="cpu",
        compute_type="int8_float32",
        cpu_threads=max(1, min(6, (os.cpu_count() or 4) - 1)),
        local_files_only=True,
    )
    emit(0.04, "녹음에서 문장과 단어 시간을 분석하고 있습니다.")
    # Decode through the already-installed FFmpeg rather than PyAV's changing
    # container API. This is also the exact sample clock used for word timing.
    pcm = subprocess.run(
        [os.environ.get("STUDIO_FFMPEG", "ffmpeg"), "-v", "error", "-nostdin", "-i", arguments.input,
         "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"],
        check=True, capture_output=True,
    ).stdout
    audio = np.frombuffer(pcm, dtype="<f4")
    segments, information = model.transcribe(
        audio,
        language="ko",
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 350},
        condition_on_previous_text=True,
    )
    duration = max(float(information.duration), 0.001)
    result = {"duration": duration, "language": information.language, "segments": []}
    for segment in segments:
        result["segments"].append({
            "id": segment.id,
            "start": segment.start,
            "end": segment.end,
            "text": segment.text,
            "words": [
                {"start": word.start, "end": word.end, "word": word.word, "probability": word.probability}
                for word in (segment.words or [])
            ],
        })
        emit(min(0.98, 0.05 + float(segment.end) / duration * 0.92),
             f"나레이션 분석 {min(100, round(segment.end / duration * 100))}%")
    output = Path(arguments.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(output)
    emit(1, "단어 시간 정보와 자막 분석을 마쳤습니다.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
