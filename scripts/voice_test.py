"""P3d voice test: render every story line with a local open-source TTS and check it by machine.

Engine: Kokoro-82M-v1.1-zh (Apache-2.0 weights and voices), CPU, through an existing local engine module that exposes
load() / voice_path() / SAMPLE_RATE (pass its folder with --engine-dir). Check: faster-whisper transcribes each
rendered line; both the script line and the transcript are turned into toneless pinyin and compared by edit
distance, so Traditional vs Simplified output does not count as an error. Nothing is sent to any online service.

usage (from the repo root, inside the engine's Python environment):
  python scripts/voice_test.py --engine-dir <folder with tts_kokoro.py> --out incoming/voice [--whisper small]
Writes <out>/<key>_<n>.wav, <out>/results.json and prints a markdown table.
"""
import argparse, json, re, subprocess, sys, time, wave
from pathlib import Path

for s in (sys.stdin, sys.stdout, sys.stderr):  # Big5 console: keep Chinese intact
    try: s.reconfigure(encoding="utf-8")
    except Exception: pass

ap = argparse.ArgumentParser()
ap.add_argument("--engine-dir", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--whisper", default="small")
ap.add_argument("--ffmpeg", default="ffmpeg")
a = ap.parse_args()
sys.path.insert(0, a.engine_dir)
import numpy as np, torch  # noqa: E402
import tts_kokoro as K  # noqa: E402
from pypinyin import lazy_pinyin  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402

# speaker -> (voice, speed, pitch factor applied afterwards with ffmpeg; 1 = unchanged)
CAST = {"mu": ("zf_017", 1.05, 1.0), "elder": ("zm_009", 0.9, 1.0), "lord": ("zm_045", 0.8, 0.82)}
html = Path("index.html").read_text(encoding="utf-8")
block = html[html.index("const DLG={"):html.index("};", html.index("const DLG={"))]
lines = []
for key, body in re.findall(r"(\w+):\[(.*?)\]\](?=,\s*\w+:\[|$)", block + "]", re.S):
    for i, (who, text) in enumerate(re.findall(r"\['(\w+)','([^']+)'\]", body + "]")):
        lines.append((key, i, who, text))
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)

t0 = time.time(); eng = K.load(); load_s = time.time() - t0
res = []
for key, i, who, text in lines:
    voice, speed, pitch = CAST[who]
    clean = text.replace("…", "，").replace("……", "，")
    t1 = time.time(); chunks = []
    with torch.inference_mode():
        for r in eng.pipeline(clean, voice=K.voice_path(voice), speed=speed):
            if r.audio is not None: chunks.append(r.audio.detach().cpu().numpy())
    audio = np.concatenate(chunks) if chunks else np.zeros(1, "float32")
    synth_s = time.time() - t1
    f = out / f"{key}_{i}_{who}.wav"
    with wave.open(str(f), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(K.SAMPLE_RATE)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
    if pitch != 1.0:  # lower the boss voice: resample to shift pitch, then stretch back to the same length
        tmp = f.with_suffix(".tmp.wav")
        sr = K.SAMPLE_RATE
        subprocess.run([a.ffmpeg, "-y", "-loglevel", "error", "-i", str(f), "-af", f"asetrate={int(sr * pitch)},aresample={sr},atempo={1 / pitch:.4f}", str(tmp)], check=True)
        tmp.replace(f)
    res.append({"key": key, "i": i, "who": who, "voice": voice, "text": text, "file": f.name, "seconds": round(len(audio) / K.SAMPLE_RATE, 2), "synth_s": round(synth_s, 2)})

wm = WhisperModel(a.whisper, device="cpu", compute_type="int8")
def py(s): return [p for p in lazy_pinyin(re.sub(r"[^一-鿿]", "", s)) if p]
def ed(x, y):
    d = list(range(len(y) + 1))
    for i in range(1, len(x) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(y) + 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (x[i - 1] != y[j - 1]))
    return d[len(y)]
for r in res:
    segs, _ = wm.transcribe(str(out / r["file"]), language="zh", beam_size=5)
    hyp = "".join(s.text for s in segs).strip()
    ref_p, hyp_p = py(r["text"]), py(hyp)
    r["heard"] = hyp; r["syllables"] = len(ref_p); r["errors"] = ed(ref_p, hyp_p)
tot_err = sum(r["errors"] for r in res); tot_syl = sum(r["syllables"] for r in res)
summary = {"engine": "Kokoro-82M-v1.1-zh (Apache-2.0), CPU", "check": f"faster-whisper {a.whisper}, toneless pinyin edit distance",
           "lines": len(res), "audio_seconds": round(sum(r["seconds"] for r in res), 1), "model_load_s": round(load_s, 1),
           "synth_seconds_total": round(sum(r["synth_s"] for r in res), 1), "syllable_error_rate": round(tot_err / max(1, tot_syl), 4),
           "by_speaker": {w: round(sum(r["errors"] for r in res if r["who"] == w) / max(1, sum(r["syllables"] for r in res if r["who"] == w)), 4) for w in CAST}}
(out / "results.json").write_text(json.dumps({"summary": summary, "lines": res}, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False))
print("| 檔案 | 原句 | Whisper 聽到 | 音節錯 |\n|---|---|---|---|")
for r in res: print(f"| {r['file']} | {r['text']} | {r['heard']} | {r['errors']}/{r['syllables']} |")
