#!/usr/bin/env python3
"""
O'zbekcha TTS — Meta MMS-TTS modeli asosida.

Ikki rejimda ishlaydi:

  1) Bir martalik (Hamroh uchun HAMROH_TTS=cmd):
       echo "Salom dunyo" | python3 mms_tts_uz.py --out javob.ogg

  2) Server (tavsiya etiladi — model bir marta yuklanadi, har chaqiruv tez):
       python3 mms_tts_uz.py --serve --port 8010
     Keyin .env da:
       HAMROH_TTS=http
       HAMROH_TTS_URL=http://127.0.0.1:8010/v1
       HAMROH_TTS_FORMAT=ogg

Nima uchun server yaxshiroq: modelni yuklash 3-10 soniya oladi. Bir martalik
rejimda har bir javob shu vaqtni qayta sarflaydi; serverda esa faqat sintez vaqti qoladi.

O'rnatish:
    pip install -r requirements.txt
    # ogg (Telegram "voice message") uchun ffmpeg ham kerak:
    #   Ubuntu: sudo apt install ffmpeg
"""

from __future__ import annotations

import argparse
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
from typing import Iterable

# MMS modeli nomlari turlicha bo'lishi mumkin — birinchi ishlaganini olamiz.
MODEL_CANDIDATES = [
    "facebook/mms-tts-uzn-script_latin",
    "facebook/mms-tts-uzb",
    "facebook/mms-tts-uzn",
]

# ---------------------------------------------------------------- matn tayyorlash

ONES = ["nol", "bir", "ikki", "uch", "to‘rt", "besh", "olti", "yetti", "sakkiz", "to‘qqiz"]
TENS = ["", "o‘n", "yigirma", "o‘ttiz", "qirq", "ellik", "oltmish", "yetmish", "sakson", "to‘qson"]
SCALES = [(1_000_000_000, "milliard"), (1_000_000, "million"), (1_000, "ming")]


def _under_1000(n: int) -> str:
    out = []
    if n // 100:
        out.append("yuz" if n // 100 == 1 else f"{ONES[n // 100]} yuz")
    rest = n % 100
    if rest // 10:
        out.append(TENS[rest // 10])
    if rest % 10:
        out.append(ONES[rest % 10])
    return " ".join(out)


def number_to_words(value: int) -> str:
    """1250000 -> 'bir million ikki yuz ellik ming'."""
    if value < 0:
        return f"minus {number_to_words(-value)}"
    if value == 0:
        return "nol"
    parts, n = [], value
    for scale, name in SCALES:
        count = n // scale
        if count:
            parts.append(name if (count == 1 and scale == 1000) else f"{_under_1000(count)} {name}")
            n %= scale
    if n:
        parts.append(_under_1000(n))
    return " ".join(parts).strip()


def normalize(text: str) -> str:
    """
    Raqamlarni so'zga aylantiradi va o'qilmaydigan belgilarni tozalaydi.

    Hamroh matnni o'zi ham tayyorlaydi (src/util/speech.ts), shuning uchun bu yerda
    faqat yengil himoya qatlami — skript alohida ishlatilganda ham tushunarli bo'lsin.
    """
    t = text
    t = re.sub(r"\b(\d[\d\s ]*)\s*(UZS|so‘m|som|sum)\b", lambda m: f"{number_to_words(int(re.sub(r'[^0-9]', '', m.group(1))))} so‘m", t, flags=re.I)
    t = re.sub(r"\b\d[\d\s ]*\d\b|\b\d+\b", lambda m: number_to_words(int(re.sub(r"[^0-9]", "", m.group(0)))), t)
    t = re.sub(r"[*_`|<>«»\"()\[\]{}#]", " ", t)
    t = re.sub(r"\s*[—–-]\s*", ", ", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def split_sentences(text: str, max_len: int = 200) -> list[str]:
    """Gaplarga bo'ladi — har biri alohida sintez qilinib, orasiga pauza qo'yiladi."""
    rough: list[str] = []
    for part in re.split(r"(?<=[.!?])\s+", text):
        part = part.strip()
        if not part:
            continue
        if len(part) <= max_len:
            rough.append(part)
        else:  # juda uzun gapni vergullar bo'yicha bo'lamiz
            buf = ""
            for chunk in part.split(", "):
                if len(buf) + len(chunk) > max_len and buf:
                    rough.append(buf.strip())
                    buf = ""
                buf += chunk + ", "
            if buf.strip():
                rough.append(buf.strip().rstrip(","))
    return rough


# ---------------------------------------------------------------- sintez

class Synthesizer:
    """Modelni bir marta yuklab, qayta-qayta ishlatadi."""

    def __init__(self, model_id: str | None, rate: float, expressiveness: float) -> None:
        import torch  # noqa: PLC0415 - og'ir import, faqat kerak bo'lganda
        from transformers import AutoTokenizer, VitsModel  # noqa: PLC0415

        self.torch = torch
        candidates = [model_id] if model_id else MODEL_CANDIDATES
        errors: list[str] = []

        for candidate in candidates:
            try:
                self.model = VitsModel.from_pretrained(candidate)
                self.tokenizer = AutoTokenizer.from_pretrained(candidate)
                self.model_id = candidate
                break
            except Exception as exc:  # model topilmadi yoki yuklab bo'lmadi
                errors.append(f"  {candidate}: {type(exc).__name__}: {exc}")
        else:
            raise SystemExit(
                "MMS-TTS modeli yuklanmadi. Sinab ko'rilganlar:\n"
                + "\n".join(errors)
                + "\n\nHuggingFace'da mavjud nomni tekshiring va --model bilan bering."
            )

        if getattr(self.tokenizer, "is_uroman", False):
            print(
                "DIQQAT: bu model uroman talab qiladi (pip install uroman).\n"
                "O'zbek lotin yozuvi uchun odatda kerak emas — natijani tekshiring.",
                file=sys.stderr,
            )

        # VITS parametrlari: prosodiyani tabiiyroq qiladi
        self.model.speaking_rate = rate           # katta qiymat = tezroq
        self.model.noise_scale = expressiveness   # ohang xilma-xilligi (0.667 standart)
        self.model.noise_scale_duration = 0.8     # bo'g'in uzunligidagi tabiiy tebranish
        self.model.eval()
        self.sample_rate = int(self.model.config.sampling_rate)

    def _one(self, sentence: str):
        import numpy as np  # noqa: PLC0415

        inputs = self.tokenizer(sentence, return_tensors="pt")
        with self.torch.no_grad():
            wave_out = self.model(**inputs).waveform[0].cpu().numpy()
        return np.asarray(wave_out, dtype="float32")

    def synth(self, text: str, pause: float = 0.22) -> bytes:
        """Matnni WAV baytlariga aylantiradi (gaplar orasida pauza bilan)."""
        import numpy as np  # noqa: PLC0415

        sentences = split_sentences(normalize(text)) or [normalize(text) or "."]
        silence = np.zeros(int(self.sample_rate * pause), dtype="float32")

        chunks: list = []
        for i, sentence in enumerate(sentences):
            chunks.append(self._one(sentence))
            if i < len(sentences) - 1:
                chunks.append(silence)

        audio = np.concatenate(chunks) if chunks else silence
        peak = float(np.max(np.abs(audio))) or 1.0
        audio = (audio / peak) * 0.95  # bir xil balandlik
        pcm = (audio * 32767).astype("<i2")

        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(self.sample_rate)
            w.writeframes(pcm.tobytes())
        return buf.getvalue()


# ---------------------------------------------------------------- format

def convert(wav_bytes: bytes, fmt: str) -> bytes:
    """WAV -> ogg/opus yoki mp3 (ffmpeg orqali). Telegram 'voice message' uchun ogg kerak."""
    fmt = fmt.lower()
    if fmt == "wav":
        return wav_bytes
    if not shutil.which("ffmpeg"):
        raise SystemExit(
            f"'{fmt}' format uchun ffmpeg kerak (topilmadi).\n"
            "  Ubuntu: sudo apt install ffmpeg\n"
            "  Yoki HAMROH_TTS_FORMAT=wav qo'ying."
        )

    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "wav", "-i", "pipe:0"]
    if fmt in ("ogg", "oga", "opus"):
        args += ["-c:a", "libopus", "-b:a", "48k", "-f", "ogg"]
    elif fmt == "mp3":
        args += ["-c:a", "libmp3lame", "-b:a", "96k", "-f", "mp3"]
    else:
        raise SystemExit(f"Noma'lum format: {fmt} (wav | ogg | mp3)")
    args.append("pipe:1")

    done = subprocess.run(args, input=wav_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if done.returncode != 0:
        raise SystemExit(f"ffmpeg xatosi: {done.stderr.decode('utf-8', 'ignore')[:300]}")
    return done.stdout


# ---------------------------------------------------------------- server

def serve(synth: Synthesizer, host: str, port: int, default_format: str) -> None:
    """OpenAI-mos /v1/audio/speech endpointi."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: PLC0415

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args) -> None:  # jim ishlaydi
            print(f"  {self.address_string()} {fmt % args}", file=sys.stderr)

        def _json(self, code: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            if self.path.rstrip("/").endswith("/models"):
                self._json(200, {"data": [{"id": synth.model_id, "object": "model"}]})
            else:
                self._json(404, {"error": {"message": "faqat /v1/models va /v1/audio/speech"}})

        def do_POST(self) -> None:  # noqa: N802
            if not self.path.rstrip("/").endswith("/audio/speech"):
                self._json(404, {"error": {"message": "faqat /v1/audio/speech"}})
                return
            try:
                size = int(self.headers.get("content-length", "0"))
                payload = json.loads(self.rfile.read(size) or b"{}")
                text = (payload.get("input") or "").strip()
                if not text:
                    self._json(400, {"error": {"message": "input bo'sh"}})
                    return
                fmt = (payload.get("response_format") or default_format).lower()
                audio = convert(synth.synth(text), fmt)
            except Exception as exc:
                self._json(500, {"error": {"message": f"{type(exc).__name__}: {exc}"}})
                return

            mime = {"ogg": "audio/ogg", "opus": "audio/ogg", "mp3": "audio/mpeg", "wav": "audio/wav"}
            self.send_response(200)
            self.send_header("content-type", mime.get(fmt, "application/octet-stream"))
            self.send_header("content-length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)

    server = ThreadingHTTPServer((host, port), Handler)
    print(f"MMS-TTS server: http://{host}:{port}/v1  (model: {synth.model_id})", file=sys.stderr)
    print("To'xtatish: Ctrl+C", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nto'xtatildi", file=sys.stderr)


# ---------------------------------------------------------------- CLI

def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="O'zbekcha TTS (MMS-TTS)")
    ap.add_argument("--out", help="natija fayli (bir martalik rejim)")
    ap.add_argument("--text", help="matn (berilmasa stdin dan o'qiladi)")
    ap.add_argument("--model", help=f"HuggingFace model (standart: {MODEL_CANDIDATES[0]})")
    ap.add_argument("--rate", type=float, default=1.0, help="gapirish tezligi (1.0 standart, 0.9 sekinroq)")
    ap.add_argument("--expressiveness", type=float, default=0.667, help="ohang xilma-xilligi (0.5-0.9)")
    ap.add_argument("--pause", type=float, default=0.22, help="gaplar orasidagi pauza, soniya")
    ap.add_argument("--format", default=None, help="wav | ogg | mp3 (standart: --out kengaytmasi)")
    ap.add_argument("--serve", action="store_true", help="HTTP server rejimi")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8010)
    args = ap.parse_args(list(argv) if argv is not None else None)

    synth = Synthesizer(args.model, args.rate, args.expressiveness)

    if args.serve:
        serve(synth, args.host, args.port, args.format or "ogg")
        return 0

    if not args.out:
        ap.error("--out kerak (yoki --serve)")

    text = args.text if args.text is not None else sys.stdin.read()
    if not text.strip():
        print("Matn bo'sh.", file=sys.stderr)
        return 1

    fmt = (args.format or Path(args.out).suffix.lstrip(".") or "wav").lower()
    audio = convert(synth.synth(text, pause=args.pause), fmt)
    Path(args.out).write_bytes(audio)
    print(f"{args.out}: {len(audio) // 1024} KB ({fmt}, {synth.model_id})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
