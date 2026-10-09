/** Final pass: photo + shadows + 3D curtain layer, matched to the photo. All lighting math linear. */
export const COMPOSITE_VERTEX = /* glsl */ `
varying vec2 vUv; // 0..1, y down (image convention)
void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uPhoto;
uniform sampler2D uOccluder;
uniform sampler2D uLimit;
uniform sampler2D uWindow;
uniform sampler2D uShading;
uniform sampler2D uCurtain;   // premultiplied linear RGB + coverage (GL orientation, y up)
uniform sampler2D uShadow;    // a = shadow amount on wall/floor catchers
uniform int uMode;            // 0 render, 1 original, 2 masks
uniform float uExposure;
uniform vec3 uWhiteBalance;
uniform float uShadingStrength;
uniform float uBlackLum;
uniform float uNoiseSigma;    // 8-bit sRGB units
uniform float uShadowStrength;
uniform float uTransmission;  // fabric light transmission (backlight through the window)
uniform vec2 uImageSize;

vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 photo = texture(uPhoto, vUv).rgb;
  if (uMode == 1) { gl_FragColor = vec4(photo, 1.0); return; }
  float occ = smoothstep(0.3, 0.7, texture(uOccluder, vUv).r);
  float lim = smoothstep(0.3, 0.7, texture(uLimit, vUv).r);
  float win = smoothstep(0.3, 0.7, texture(uWindow, vUv).r);
  if (uMode == 2) {
    gl_FragColor = vec4(photo * 0.45 + vec3(0.55, 0.1, 0.1) * occ + vec3(0.1, 0.35, 0.1) * lim + vec3(0.1, 0.2, 0.45) * win, 1.0);
    return;
  }

  vec3 photoLin = srgbToLinear(photo);
  vec2 glUv = vec2(vUv.x, 1.0 - vUv.y);

  // Shadows fall on wall and floor only — not on furniture in front, not on the window glass.
  float shadow = texture(uShadow, glUv).a * uShadowStrength * (1.0 - occ) * (1.0 - win);
  vec3 bg = photoLin * (1.0 - shadow);

  vec4 c = texture(uCurtain, glUv);
  float visible = (1.0 - occ) * (1.0 - lim);
  if (c.a <= 0.001 || visible <= 0.001) { gl_FragColor = vec4(linearToSrgb(bg), 1.0); return; }

  float S = texture(uShading, vUv).r * 2.0;
  vec3 lit = c.rgb * uExposure * uWhiteBalance * pow(max(S, 0.05), uShadingStrength);

  // Light from the window passing through the fabric (diffused: blurred photo behind it).
  vec3 behind = srgbToLinear(textureLod(uPhoto, vUv, 4.0).rgb);
  vec3 tint = c.rgb / max(luma(c.rgb), 1e-4);
  lit += luma(behind) * clamp(tint, 0.0, 3.0) * uTransmission * win * c.a * 0.6;

  // The photo's black point: camera shadows never reach absolute zero.
  lit = uBlackLum * c.a + lit * (1.0 - uBlackLum);

  float cover = c.a * visible;
  vec3 outLin = bg * (1.0 - cover) + lit * visible;
  vec3 srgb = linearToSrgb(outLin);
  // Match the photo's grain on the rendered layer (static per pixel).
  float n = (hash(floor(vUv * uImageSize)) + hash(floor(vUv * uImageSize) + 17.0) - 1.0) * 2.45;
  srgb += vec3(n * uNoiseSigma / 255.0) * cover;
  gl_FragColor = vec4(clamp(srgb, 0.0, 1.0), 1.0);
}`;

/** Injected into MeshPhysicalMaterial: fabric color from LAB (instant recolor) + zebra bands. */
export const FABRIC_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uFabric;
uniform float uRepeat;
uniform vec3 uTargetLab;
uniform float uDetailGain;
uniform float uFabricOpacity;
uniform float uBandPeriod;   // zebra: > 0 alternates opaque / sheer bands along v
varying vec2 vFabricUv;
float fabricFInv(float t) { return t * t * t > 0.008856 ? t * t * t : (116.0 * t - 16.0) / 903.3; }
vec3 fabricLabToLinear(vec3 lab) {
  float fy = (lab.x + 16.0) / 116.0;
  float fx = fy + lab.y / 500.0;
  float fz = fy - lab.z / 200.0;
  vec3 xyz = vec3(fabricFInv(fx) * 0.95047, fabricFInv(fy), fabricFInv(fz) * 1.08883);
  return max(mat3(3.2404542, -0.969266, 0.0556434,
                  -1.5371385, 1.8760108, -0.2040259,
                  -0.4985314, 0.041556, 1.0572252) * xyz, 0.0);
}`;

export const FABRIC_MAP_FRAGMENT = /* glsl */ `
{
  float detail = texture2D(uFabric, vFabricUv / uRepeat).r - 0.5;
  vec3 lab = vec3(clamp(uTargetLab.x + detail * uDetailGain, 0.0, 100.0), uTargetLab.yz);
  diffuseColor.rgb = fabricLabToLinear(lab);
  float alpha = uFabricOpacity;
  if (uBandPeriod > 0.0) {
    float t = fract(vFabricUv.y / uBandPeriod);
    float sheer = smoothstep(0.47, 0.53, t) * (1.0 - smoothstep(0.97, 1.0, t));
    alpha = mix(1.0, 0.3, sheer);
  }
  diffuseColor.a = alpha;
}`;
