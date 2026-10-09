"""FastAPI app: POST /api/analyze, GET /api/health, static /samples for dev."""

from __future__ import annotations

import threading
from functools import lru_cache
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

from .analyze import analyze
from .segmentation import Segmenter

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
SAMPLES_DIR = Path(__file__).resolve().parents[2] / "assets" / "samples"

app = FastAPI(title="Curtain try-on analysis")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)
_model_lock = threading.Lock()


@lru_cache(maxsize=1)
def get_segmenter() -> Segmenter:
    return Segmenter()


@app.get("/api/health")
def health(seg=Depends(get_segmenter)) -> dict:
    return {"ok": True, "device": seg.device, "model": seg.model_name}


@app.get("/api/samples")
def samples() -> list[str]:
    return sorted(p.name for p in SAMPLES_DIR.glob("*.jpg"))


@app.post("/api/analyze")
def analyze_endpoint(file: UploadFile = File(...), seg=Depends(get_segmenter)) -> dict:
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Dosya çok büyük (en fazla {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).")
    try:
        with _model_lock:  # one inference at a time (MPS/CUDA memory)
            return analyze(data, seg)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as e:
        raise HTTPException(400, f"Görüntü okunamadı: {e}") from e


if SAMPLES_DIR.is_dir():
    app.mount("/samples", StaticFiles(directory=SAMPLES_DIR), name="samples")
