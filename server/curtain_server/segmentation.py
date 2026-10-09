"""SegFormer (ADE20K) semantic segmentation → class map + soft group masks."""

from __future__ import annotations

import time
from dataclasses import dataclass

import cv2
import numpy as np
import torch
import torch.nn.functional as F

from .groups import GROUPS, group_index_lists
from .imageio import model_input_size

MODEL_NAME = "nvidia/segformer-b5-finetuned-ade-640-640"
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


@dataclass
class SegResult:
    class_map: np.ndarray  # H×W int16, ADE20K class index per pixel
    group_probs: dict[str, np.ndarray]  # group → H×W float32 in [0,1]
    id2label: dict[int, str]
    inference_ms: float
    device: str


def pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class Segmenter:
    def __init__(self, model_name: str = MODEL_NAME, device: str | None = None):
        from transformers import SegformerForSemanticSegmentation

        self.model_name = model_name
        self.device = device or pick_device()
        self.model = SegformerForSemanticSegmentation.from_pretrained(model_name)
        self.model.to(self.device).eval()
        self.id2label = {int(k): v for k, v in self.model.config.id2label.items()}
        self._group_idx = {
            g: torch.tensor(idx, dtype=torch.long, device=self.device)
            for g, idx in group_index_lists(self.id2label).items()
        }

    def _preprocess(self, rgb: np.ndarray) -> torch.Tensor:
        in_h, in_w = model_input_size(*rgb.shape[:2])
        x = cv2.resize(rgb, (in_w, in_h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        x = (x - _MEAN) / _STD
        return torch.from_numpy(x.transpose(2, 0, 1)).unsqueeze(0).to(self.device)

    @torch.inference_mode()
    def run(self, rgb: np.ndarray) -> SegResult:
        h, w = rgb.shape[:2]
        t0 = time.perf_counter()
        logits = self.model(pixel_values=self._preprocess(rgb)).logits  # 1×C×h/4×w/4
        # Upsample logits to working resolution first; argmax/softmax afterwards.
        logits = F.interpolate(logits, size=(h, w), mode="bilinear", align_corners=False)[0]
        probs = torch.softmax(logits, dim=0)
        del logits
        class_map = probs.argmax(dim=0).to(torch.int16).cpu().numpy()
        group_probs = {
            g: probs.index_select(0, idx).sum(dim=0).clamp_(0, 1).float().cpu().numpy()
            if idx.numel()
            else np.zeros((h, w), np.float32)
            for g, idx in self._group_idx.items()
        }
        if self.device == "mps":
            torch.mps.synchronize()
        ms = (time.perf_counter() - t0) * 1000.0
        assert set(group_probs) == set(GROUPS)
        return SegResult(class_map, group_probs, self.id2label, ms, self.device)
