# Perde Giydirme Implementation Plan

> **For agentic workers:** Executed natively (user instruction: "Web sürümü çalışana kadar durma").
> Plan is intentionally compact — interfaces and tests are pinned here; code lives in the repo.

**Goal:** Working web app: upload room photo → server segmentation/analysis → client WebGL curtain try-on with 6 families, corner editing, real-scale, shading, occluders, instant LAB recolor.

**Architecture:** FastAPI + SegFormer-B5 returns one scene package per photo; a framework-free TS `engine` renders in WebGL2; React app hosts UI.

**Tech Stack:** Python 3.12, torch 2.14, transformers 5.x, OpenCV, FastAPI · TypeScript, Vite, React 18, Vitest, WebGL2.

**Spec:** `docs/superpowers/specs/2026-10-09-perde-giydirme-design.md`

## Global Constraints
- Working resolution: long side ≤ 1280 px; model input short side 640, multiple of 32.
- Class mapping by label name only (`id2label`), never numeric IDs.
- Corner order TL, TR, BR, BL everywhere.
- Curtain geometry in cm; window rect `[0,W]×[0,H]`, y down. Default W = 120 cm.
- Focal default f35 = 26 mm; `f_px = f35 / 43.27 × diag_px`.
- Recolor never calls the server.
- `packages/engine` has no React/DOM imports (receives `WebGL2RenderingContext` + image sources).
- UI copy Turkish; code English.

## Review Focus
1. Phone photo with EXIF rotation → masks aligned with displayed image (test: `test_imageio.py::test_exif_rotation`).
2. Photo with no detectable window → default centered rectangle, not a crash (test: `test_windows.py::test_no_window_returns_empty`, analyze fallback test).
3. Corners dragged into a non-convex / degenerate quad → aspect falls back to pixel ratio, homography stays finite (test: `aspect.test.ts::degenerate`).
4. Huge / non-image upload → 400/413 with message (test: `test_api.py::test_bad_image`).
5. Fronto-parallel window (no perspective) → Zhang–He undefined focal, aspect still correct (test: `aspect.test.ts::frontal`).

---

### Task 1: Server foundation — imageio, groups, segmentation, segment_visualize (Phase 1)
**Files:** `server/requirements.txt`, `server/pyproject.toml` (pytest config, `model` marker), `server/curtain_server/{__init__,imageio,groups,segmentation}.py`, `server/scripts/segment_visualize.py`, `server/tests/{test_imageio,test_groups,test_segmentation_model}.py`
**Produces:**
- `imageio.load_working_image(data: bytes | Path, max_side=1280) -> WorkingImage(rgb: np.ndarray HxWx3 uint8, orig_size, focal_px: float, focal_source: str)`
- `groups.GROUPS = ("surface","limit","occluder","window","curtain")`; `groups.group_of(label: str) -> set[str]`; `groups.group_index_lists(id2label) -> dict[str, list[int]]`
- `segmentation.Segmenter(model_name, device=None).run(rgb) -> SegResult(class_map: HxW int16, group_probs: dict[str, HxW float32], id2label, inference_ms, device)`
**Tests:** EXIF orientation 6 → transposed size; downscale keeps aspect; focal from EXIF 35mm tag and default; group mapping (wall→surface, windowpane→surface+window, floor→limit, sofa→occluder, unknown→occluder, curtain→surface+curtain); `@pytest.mark.model` smoke: masks shape == working image shape, probs sum ≈ 1 across surface+limit+occluder.
**Run:** `python -m scripts.segment_visualize ../assets/samples/*.jpg --out ../out/segviz` → panel PNG + per-group mask PNGs + stats.json per image; inspect visually.

### Task 2: Analysis — windows, shading, analyze, FastAPI (Phase 2)
**Files:** `server/curtain_server/{windows,shading,analyze,api}.py`, `server/tests/{test_windows,test_shading,test_api}.py`
**Produces:**
- `windows.find_windows(window_prob: HxW float, min_area_frac=0.005) -> list[Window(corners: list[[x,y]]×4 TL,TR,BR,BL, area_frac)]`; `windows.order_corners(pts) -> np.ndarray(4,2)`
- `shading.shading_map(rgb, valid_mask) -> HxW float32 in [0,2]` (median of valid = 1)
- `analyze.analyze(data: bytes, segmenter) -> dict` (spec §8 JSON)
- `api.app` with `/api/health`, `/api/analyze`; segmenter injectable via `api.get_segmenter` dependency.
**Tests:** synthetic perspective quad mask → corners within 3 px, order TL,TR,BR,BL; two blobs → sorted by area; empty → []; shading: uniform image → ≈1 everywhere, left-dark gradient preserved; API with fake segmenter: 200 + schema keys, bad bytes → 400, >20MB → 413.

### Task 3: Engine math — homography, aspect, color, catalog, scene (Phase 3a)
**Files:** root `package.json` (workspaces), `packages/engine/{package.json,tsconfig.json,vitest.config.ts}`, `src/{homography,aspect,color,catalog,scene,types,index}.ts`, tests `src/*.test.ts`
**Produces:**
- `solveHomography(src: Vec2[4], dst: Vec2[4]): Mat3` (row-major 9), `invert3(m)`, `applyH(m, p)`
- `estimateAspect(corners: Vec2[4], focalPx: number, pp: Vec2): number | null` (width/height)
- `srgbToLab(rgb01)`, `labToSrgb(lab)`, `hexToRgb01`, `rgb01ToHex`
- `CATALOG: CurtainItem[]` (`{id, name, family: Family, fabric: FabricId, repeatCm, defaultColor, opacity}`), `FAMILIES`, `PALETTE`
- `buildGeometry({corners, widthCm, heightCm?, focalPx, imageSize}) -> {widthCm, heightCm, aspectSource: 'user'|'estimated'|'pixel', cmToPx: Mat3, pxToCm: Mat3}`
**Tests:** homography maps 4 points exactly, inverse round-trips random points; aspect from synthetic camera (yaw 30°, pitch 10°, f=1500, aspect 1.5) within 2%; frontal quad → pixel ratio; degenerate → null; LAB known values (white → L100, sRGB red → L≈53.24,a≈80.09,b≈67.20) and round trip; catalog has 10–15 items covering all 6 families with unique ids.

### Task 4: Fabrics + WebGL renderer (Phase 3b)
**Files:** `scripts/gen_fabrics.py` → `assets/fabrics/*.png` (512² grayscale tileable: linen, velvet, stripe, damask, check, sheer, wood, metal); `packages/engine/src/{renderer.ts, shaders/composite.ts}`
**Produces:** `class CurtainRenderer { constructor(gl: WebGL2RenderingContext); setScene(s: SceneImages); setFabric(id, img); render(state: RenderState); dispose() }` with `SceneImages = {photo, occluder, limit, shading}` (TexImageSource) and `RenderState = {geometry, item, colorHex, params: {drop, openness}, showMasks?: boolean, compare?: boolean}`.
**Tests:** shader compiles (verified in browser during Task 5 — WebGL unavailable in vitest).

### Task 5: Web app (Phase 4)
**Files:** `apps/web/{package.json,vite.config.ts,index.html,tsconfig.json}`, `src/{main.tsx,App.tsx,api.ts,styles.css}`, `src/components/{Uploader,Editor,CornerHandles,Sidebar}.tsx`
**Behavior:** upload/sample pick → `/api/analyze` → editor; drag corners; catalog grid by family; palette + color input; width cm; height override; drop/openness sliders; hold-to-compare; mask view; PNG download; existing-curtain warning; WebGL2 missing message. Vite proxy `/api` and `/samples` → server (server serves `assets/samples` at `/samples`, fabrics bundled from `assets/fabrics`).

### Task 6: End-to-end verification (Phase 5)
Run server + web; drive the browser on all 5 samples × several families; screenshot; tune shader constants; run all test suites.
