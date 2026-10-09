import * as THREE from 'three';
import type { CurtainItem, FabricId } from './catalog';
import { hexToRgb01, srgbToLab } from './color';
import { buildCurtain, type CurtainModel, type MeshData, HEAD_Y, OVERHANG } from './drape';
import { exposureFrom, lightOrDefault, whiteBalance, windowRatio, type LightStats } from './matching';
import { cameraCenter, poseFromHomography, type Pose } from './pose';
import type { Geometry } from './scene';
import {
  COMPOSITE_FRAGMENT,
  COMPOSITE_VERTEX,
  FABRIC_FRAGMENT_PARS,
  FABRIC_MAP_FRAGMENT,
} from './shaders/composite';

export interface SceneImages {
  width: number;
  height: number;
  photo: TexImageSource;
  occluder: TexImageSource;
  limit: TexImageSource;
  window: TexImageSource;
  shading: TexImageSource;
  focalPx: number;
  light?: Partial<LightStats> | null;
}

export type RenderMode = 'render' | 'original' | 'masks';

export interface RenderState {
  geometry: Geometry;
  item: CurtainItem;
  colorHex: string;
  /** Family-specific 0–1 parameter (closing, drop, tieback height). */
  amount: number;
  /** Wall–floor junction in window cm. */
  floorY: number;
  mode?: RenderMode;
}

interface FabricLook {
  roughness: number;
  sheen: number;
  sheenRoughness: number;
  bump: number;
  detailGain: number;
  transmission: number;
}

const LOOKS: Record<FabricId, FabricLook> = {
  linen: { roughness: 0.92, sheen: 0.3, sheenRoughness: 0.7, bump: 0.6, detailGain: 40, transmission: 0.35 },
  velvet: { roughness: 0.85, sheen: 1.0, sheenRoughness: 0.45, bump: 0.25, detailGain: 30, transmission: 0.05 },
  stripe: { roughness: 0.88, sheen: 0.3, sheenRoughness: 0.6, bump: 0.35, detailGain: 55, transmission: 0.2 },
  damask: { roughness: 0.8, sheen: 0.55, sheenRoughness: 0.5, bump: 0.35, detailGain: 50, transmission: 0.15 },
  check: { roughness: 0.9, sheen: 0.25, sheenRoughness: 0.7, bump: 0.35, detailGain: 55, transmission: 0.2 },
  sheer: { roughness: 0.9, sheen: 0.15, sheenRoughness: 0.8, bump: 0.15, detailGain: 25, transmission: 0.9 },
  wood: { roughness: 0.6, sheen: 0, sheenRoughness: 1, bump: 0.4, detailGain: 45, transmission: 0 },
  metal: { roughness: 0.35, sheen: 0, sheenRoughness: 1, bump: 0.1, detailGain: 20, transmission: 0 },
};

/** three.js light intensities are radiometric: a unit Lambert response needs π. */
const PI = Math.PI;

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.setAttribute('aAO', new THREE.BufferAttribute(m.ao ?? new Float32Array(m.positions.length / 3).fill(1), 1));
  g.computeVertexNormals();
  return g;
}

function sceneTexture(img: TexImageSource, mipmaps = false): THREE.Texture {
  const t = new THREE.Texture(img as never);
  t.flipY = false; // v = 0 is the top image row
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = mipmaps;
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Renders a 3D curtain in the camera recovered from the photo and composites it onto the photo.
 * Framework-free: the caller provides the canvas and its WebGL2 context.
 */
export class CurtainRenderer {
  private r: THREE.WebGLRenderer;
  private scene3d = new THREE.Scene();
  private camera = new THREE.Camera();
  private curtainGroup = new THREE.Group();
  private catchers = new THREE.Group();
  private hemi = new THREE.HemisphereLight(0xffffff, 0x777777, 1);
  private key = new THREE.DirectionalLight(0xffffff, 1);
  private windowLight = new THREE.PointLight(0xffffff, 1, 0, 0);
  private fabricMat: THREE.MeshPhysicalMaterial;
  private hardwareMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c4, roughness: 0.4, metalness: 0, side: THREE.DoubleSide });
  private fabricUniforms = {
    uFabric: { value: null as THREE.Texture | null },
    uRepeat: { value: 10 },
    uTargetLab: { value: new THREE.Vector3(70, 0, 0) },
    uDetailGain: { value: 40 },
    uFabricOpacity: { value: 1 },
    uBandPeriod: { value: 0 },
  };
  private fabrics = new Map<string, THREE.Texture>();
  private rtCurtain: THREE.WebGLRenderTarget;
  private rtShadow: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private composite: THREE.ShaderMaterial;
  private sceneTex: THREE.Texture[] = [];
  private size: [number, number] = [1, 1];
  private focalPx = 1000;
  private light: LightStats = lightOrDefault(null);
  private modelKey = '';
  private wallCatcher: THREE.Mesh;
  private floorCatcher: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, gl: WebGL2RenderingContext) {
    this.r = new THREE.WebGLRenderer({ canvas: canvas as HTMLCanvasElement, context: gl, antialias: false });
    this.r.autoClear = true;
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFShadowMap;
    this.r.shadowMap.autoUpdate = false;

    this.camera.matrixAutoUpdate = false;
    this.scene3d.add(this.curtainGroup, this.catchers, this.hemi, this.key, this.key.target, this.windowLight);
    this.hemi.position.set(0, -1, 0); // world "up" is −y
    this.key.castShadow = true;
    this.key.layers.enable(2); // the shadow-catcher pass (layer 2) needs the shadow-casting light
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.radius = 6;
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.6;

    this.fabricMat = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
    // A single-layer sheet must write both sides to the shadow map, or panels facing the light vanish.
    this.fabricMat.shadowSide = THREE.DoubleSide;
    this.fabricMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.fabricUniforms);
      shader.vertexShader = 'attribute float aAO;\nvarying float vAO;\nvarying vec2 vFabricUv;\n' + shader.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n  vFabricUv = uv;\n  vAO = aAO;',
      );
      shader.fragmentShader = FABRIC_FRAGMENT_PARS + '\nvarying float vAO;\n' + shader.fragmentShader
        .replace('#include <map_fragment>', FABRIC_MAP_FRAGMENT)
        // Fold cavities: little ambient light reaches inside a fold, and direct light is partly blocked.
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse *= vAO;\n  reflectedLight.directDiffuse *= mix(1.0, vAO, 0.6);\n  reflectedLight.directSpecular *= vAO;');
    };

    // Shadow catchers: invisible wall (z = 0) and floor planes that only show received shadows.
    const shadowMat = new THREE.ShadowMaterial({ opacity: 1, side: THREE.DoubleSide });
    this.wallCatcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
    this.floorCatcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
    this.floorCatcher.rotation.x = Math.PI / 2;
    for (const m of [this.wallCatcher, this.floorCatcher]) {
      m.receiveShadow = true;
      m.layers.set(2);
      this.catchers.add(m);
    }

    const rtOpts = { type: THREE.HalfFloatType, colorSpace: THREE.NoColorSpace } as const;
    this.rtCurtain = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, samples: 4 });
    this.rtShadow = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, samples: 2 });

    this.composite = new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPhoto: { value: null }, uOccluder: { value: null }, uLimit: { value: null }, uWindow: { value: null },
        uShading: { value: null }, uCurtain: { value: this.rtCurtain.texture }, uShadow: { value: this.rtShadow.texture },
        uMode: { value: 0 }, uExposure: { value: 0.3 }, uWhiteBalance: { value: new THREE.Vector3(1, 1, 1) },
        uShadingStrength: { value: 0.6 }, uBlackLum: { value: 0.003 }, uNoiseSigma: { value: 1.5 },
        uShadowStrength: { value: 0.55 }, uTransmission: { value: 0.2 }, uImageSize: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite));
  }

  setScene(s: SceneImages): void {
    this.sceneTex.forEach((t) => t.dispose());
    const photo = sceneTexture(s.photo, true);
    const [occ, lim, win, shading] = [s.occluder, s.limit, s.window, s.shading].map((i) => sceneTexture(i));
    this.sceneTex = [photo, occ, lim, win, shading];
    const u = this.composite.uniforms;
    u.uPhoto.value = photo;
    u.uOccluder.value = occ;
    u.uLimit.value = lim;
    u.uWindow.value = win;
    u.uShading.value = shading;
    u.uImageSize.value.set(s.width, s.height);
    this.size = [s.width, s.height];
    this.focalPx = s.focalPx;
    this.light = lightOrDefault(s.light);
    this.rtCurtain.setSize(s.width, s.height);
    this.rtShadow.setSize(s.width, s.height);
    this.modelKey = '';
  }

  hasFabric(id: string): boolean {
    return this.fabrics.has(id);
  }

  /** Grayscale, power-of-two, tileable detail texture (mean ≈ 0.5). */
  setFabric(id: string, img: TexImageSource): void {
    const t = new THREE.Texture(img as never);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    this.fabrics.get(id)?.dispose();
    this.fabrics.set(id, t);
  }

  private rebuild(state: RenderState): void {
    const g = state.geometry;
    const key = [state.item.family, state.amount.toFixed(3), g.widthCm.toFixed(1), g.heightCm.toFixed(1), state.floorY.toFixed(1)].join('|');
    if (key === this.modelKey) return;
    this.modelKey = key;
    this.curtainGroup.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
    this.curtainGroup.clear();
    const model: CurtainModel = buildCurtain(state.item.family, {
      widthCm: g.widthCm, heightCm: g.heightCm, floorY: state.floorY, amount: state.amount, seed: 7,
    });
    for (const m of model.fabric) this.curtainGroup.add(this.mesh(m, this.fabricMat));
    for (const m of model.hardware) this.curtainGroup.add(this.mesh(m, this.hardwareMat));
    this.r.shadowMap.needsUpdate = true;
  }

  private mesh(m: MeshData, mat: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(toGeometry(m), mat);
    mesh.castShadow = true;
    // Fabric doesn't receive: self-shadowing of thin folds aliases badly; fold AO covers cavities.
    mesh.receiveShadow = mat !== this.fabricMat;
    return mesh;
  }

  private placeCamera(pose: Pose): void {
    const [w, h] = this.size;
    const { R, t, focalPx: f, pp } = pose;
    // OpenCV camera → three camera (y up, looking down −z): flip y and z.
    const view = new THREE.Matrix4().set(
      R[0], R[1], R[2], t[0],
      -R[3], -R[4], -R[5], -t[1],
      -R[6], -R[7], -R[8], -t[2],
      0, 0, 0, 1,
    );
    this.camera.matrix.copy(view).invert();
    this.camera.matrixWorld.copy(this.camera.matrix);
    this.camera.matrixWorldInverse.copy(view);
    const n = 5, far = 5000;
    this.camera.projectionMatrix.set(
      (2 * f) / w, 0, 1 - (2 * pp[0]) / w, 0,
      0, (2 * f) / h, (2 * pp[1]) / h - 1, 0,
      0, 0, -(far + n) / (far - n), (-2 * far * n) / (far - n),
      0, 0, -1, 0,
    );
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  private placeLights(pose: Pose, state: RenderState): void {
    const W = state.geometry.widthCm, H = state.geometry.heightCm;
    const C = cameraCenter(pose);
    const wr = windowRatio(this.light);
    const span = W + 2 * OVERHANG + 120;

    // Side panels are shaped by the window light; shades covering the window are lit from the room.
    const side = state.item.family === 'fon' || state.item.family === 'kruvaze';
    // Calibrated so a cream fabric beside the window reads brighter than an off-white wall.
    this.hemi.intensity = (side ? 0.16 : 0.38) * PI;
    this.hemi.groundColor.setRGB(0.45, 0.45, 0.45);

    // Room light comes from the window side too (in a photo the window is the dominant source):
    // in front of and above the window, so both panels' window-facing folds light up together and
    // their soft shadows fall outward on the wall.
    this.key.intensity = (side ? 0.5 : 0.9) * PI;
    this.key.position.set(W / 2, HEAD_Y - 120, Math.max(C[2] * 0.6, -220));
    this.key.target.position.set(W / 2, H / 2, 0);
    const sc = this.key.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
    sc.near = 1; sc.far = 4000;
    sc.updateProjectionMatrix();

    // Window light for side panels: daylight enters at the window and grazes the fold faces turned
    // toward it. Families that cover the window get their window light from transmission instead.
    this.windowLight.intensity = side ? Math.min(2.6, 1.25 + 0.15 * wr) * PI : 0;
    this.windowLight.position.set(W / 2, H * 0.45, -12);
    this.wallCatcher.scale.set(span * 3, Math.max(600, state.floorY + 400), 1);
    this.wallCatcher.position.set(W / 2, state.floorY / 2, 0);
    this.floorCatcher.scale.set(span * 3, 800, 1);
    this.floorCatcher.position.set(W / 2, state.floorY, -400);
  }

  private setMaterial(state: RenderState): void {
    const fabric = this.fabrics.get(state.item.fabric)!;
    const look = LOOKS[state.item.fabric];
    const lab = srgbToLab(hexToRgb01(state.colorHex));
    const fu = this.fabricUniforms;
    fu.uFabric.value = fabric;
    fu.uRepeat.value = state.item.repeatCm;
    fu.uTargetLab.value.set(lab[0], lab[1], lab[2]);
    fu.uDetailGain.value = look.detailGain;
    fu.uFabricOpacity.value = state.item.opacity;
    fu.uBandPeriod.value = state.item.family === 'zebra' ? 15 : 0;

    const m = this.fabricMat;
    const sheer = state.item.opacity < 1 || state.item.family === 'zebra';
    if (m.transparent !== sheer) {
      m.transparent = sheer;
      m.depthWrite = !sheer;
      m.needsUpdate = true;
    }
    m.roughness = look.roughness;
    m.sheen = look.sheen;
    m.sheenRoughness = look.sheenRoughness;
    const sheenLab: [number, number, number] = [Math.min(100, lab[0] + 18), lab[1] * 0.8, lab[2] * 0.8];
    m.sheenColor.setRGB(...labToLinearRgb(sheenLab));
    if (m.bumpMap !== fabric) {
      m.bumpMap = fabric;
      m.needsUpdate = true;
    }
    fabric.repeat.set(1 / state.item.repeatCm, 1 / state.item.repeatCm);
    m.bumpScale = look.bump;
    this.composite.uniforms.uTransmission.value = look.transmission;
  }

  render(state: RenderState): void {
    const r = this.r;
    const u = this.composite.uniforms;
    const mode = state.mode ?? 'render';
    u.uMode.value = mode === 'render' ? 0 : mode === 'original' ? 1 : 2;
    const pose = mode === 'render' ? poseFromHomography(state.geometry.cmToPx, this.focalPx, [this.size[0] / 2, this.size[1] / 2]) : null;
    const ready = pose && this.fabrics.has(state.item.fabric) && u.uPhoto.value;
    if (!u.uPhoto.value) return;

    if (ready && pose) {
      this.rebuild(state);
      this.placeCamera(pose);
      this.placeLights(pose, state);
      this.setMaterial(state);
      this.r.shadowMap.needsUpdate = true;

      r.setClearColor(0x000000, 0);
      // Pass A: curtain only (layer 0).
      this.camera.layers.set(0);
      r.setRenderTarget(this.rtCurtain);
      r.clear();
      r.render(this.scene3d, this.camera);
      // Pass B: shadow catchers only (layer 2), reusing the shadow map from pass A.
      this.camera.layers.set(2);
      r.setRenderTarget(this.rtShadow);
      r.clear();
      r.render(this.scene3d, this.camera);
    } else {
      for (const rt of [this.rtCurtain, this.rtShadow]) {
        r.setRenderTarget(rt);
        r.setClearColor(0x000000, 0);
        r.clear();
      }
    }

    u.uExposure.value = exposureFrom(this.light);
    u.uWhiteBalance.value.set(...whiteBalance(this.light));
    u.uBlackLum.value = Math.min(0.02, this.light.blackLum);
    u.uNoiseSigma.value = Math.min(6, this.light.noiseSigma);
    r.setRenderTarget(null);
    r.setViewport(0, 0, this.size[0], this.size[1]);
    r.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.sceneTex.forEach((t) => t.dispose());
    this.fabrics.forEach((t) => t.dispose());
    this.curtainGroup.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
    this.rtCurtain.dispose();
    this.rtShadow.dispose();
    this.fabricMat.dispose();
    this.hardwareMat.dispose();
    this.composite.dispose();
    this.r.dispose();
  }
}

function labToLinearRgb(lab: [number, number, number]): [number, number, number] {
  const fInv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (116 * t - 16) / 903.3);
  const fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200;
  const X = fInv(fx) * 0.95047, Y = fInv(fy), Z = fInv(fz) * 1.08883;
  return [
    Math.max(0, 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z),
    Math.max(0, -0.969266 * X + 1.8760108 * Y + 0.041556 * Z),
    Math.max(0, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z),
  ];
}
