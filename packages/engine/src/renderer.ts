import type { CurtainItem, Family } from './catalog';
import { hexToRgb01, srgbToLab } from './color';
import type { Geometry } from './scene';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders/composite';

export interface SceneImages {
  width: number;
  height: number;
  photo: TexImageSource;
  occluder: TexImageSource;
  limit: TexImageSource;
  shading: TexImageSource;
}

export type RenderMode = 'render' | 'original' | 'masks';

export interface RenderState {
  geometry: Geometry;
  item: CurtainItem;
  colorHex: string;
  /** Family-specific 0–1 parameter (openness, drop, tieback height). */
  amount: number;
  /** Exponent applied to the wall shading map; 0 disables it. */
  shadingStrength?: number;
  mode?: RenderMode;
}

const FAMILY_INDEX: Record<Family, number> = { fon: 0, tul: 1, stor: 2, zebra: 3, jaluzi: 4, kruvaze: 5 };
const MODE_INDEX: Record<RenderMode, number> = { render: 0, original: 1, masks: 2 };
const SCENE_UNITS = { photo: 0, occluder: 1, limit: 2, shading: 3 } as const;
const FABRIC_UNIT = 4;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

/** Framework-free WebGL2 compositor. The caller owns the canvas/context. */
export class CurtainRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private sceneTex: Partial<Record<keyof typeof SCENE_UNITS, WebGLTexture>> = {};
  private fabricTex = new Map<string, WebGLTexture>();
  private size: [number, number] = [1, 1];
  private loc: Record<string, WebGLUniformLocation | null> = {};

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`program link failed: ${gl.getProgramInfoLog(prog)}`);
    }
    this.program = prog;
    this.vao = gl.createVertexArray()!;
    for (const name of [
      'uPhoto', 'uOccluder', 'uLimit', 'uShading', 'uFabric', 'uImageSize', 'uPxToCm', 'uWin', 'uFamily',
      'uAmount', 'uRepeatCm', 'uOpacity', 'uTargetLab', 'uShadingStrength', 'uMode',
    ]) {
      this.loc[name] = gl.getUniformLocation(prog, name);
    }
  }

  private upload(img: TexImageSource, repeat: boolean, old?: WebGLTexture): WebGLTexture {
    const gl = this.gl;
    const tex = old ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (repeat) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return tex;
  }

  setScene(scene: SceneImages): void {
    this.size = [scene.width, scene.height];
    for (const key of Object.keys(SCENE_UNITS) as (keyof typeof SCENE_UNITS)[]) {
      this.sceneTex[key] = this.upload(scene[key], false, this.sceneTex[key]);
    }
  }

  hasFabric(id: string): boolean {
    return this.fabricTex.has(id);
  }

  /** Fabric textures must be power-of-two grayscale tiles (mipmapped, repeated). */
  setFabric(id: string, img: TexImageSource): void {
    this.fabricTex.set(id, this.upload(img, true, this.fabricTex.get(id)));
  }

  render(state: RenderState): void {
    const gl = this.gl;
    const fabric = this.fabricTex.get(state.item.fabric);
    if (!this.sceneTex.photo || !fabric) return;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    for (const [key, unit] of Object.entries(SCENE_UNITS)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex[key as keyof typeof SCENE_UNITS]!);
    }
    gl.activeTexture(gl.TEXTURE0 + FABRIC_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, fabric);

    const L = this.loc;
    gl.uniform1i(L.uPhoto, SCENE_UNITS.photo);
    gl.uniform1i(L.uOccluder, SCENE_UNITS.occluder);
    gl.uniform1i(L.uLimit, SCENE_UNITS.limit);
    gl.uniform1i(L.uShading, SCENE_UNITS.shading);
    gl.uniform1i(L.uFabric, FABRIC_UNIT);
    gl.uniform2f(L.uImageSize, this.size[0], this.size[1]);
    // Geometry matrices are row-major; GLSL mat3 is column-major (WebGL forbids transpose=true).
    const m = state.geometry.pxToCm;
    gl.uniformMatrix3fv(L.uPxToCm, false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
    gl.uniform2f(L.uWin, state.geometry.widthCm, state.geometry.heightCm);
    gl.uniform1i(L.uFamily, FAMILY_INDEX[state.item.family]);
    gl.uniform1f(L.uAmount, state.amount);
    gl.uniform1f(L.uRepeatCm, state.item.repeatCm);
    gl.uniform1f(L.uOpacity, state.item.opacity);
    const lab = srgbToLab(hexToRgb01(state.colorHex));
    gl.uniform3f(L.uTargetLab, lab[0], lab[1], lab[2]);
    gl.uniform1f(L.uShadingStrength, state.shadingStrength ?? 0.8);
    gl.uniform1i(L.uMode, MODE_INDEX[state.mode ?? 'render']);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    Object.values(this.sceneTex).forEach((t) => t && gl.deleteTexture(t));
    this.fabricTex.forEach((t) => gl.deleteTexture(t));
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
