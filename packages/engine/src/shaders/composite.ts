/**
 * Composite shader. Everything about the curtain is evaluated in window cm space
 * (window = [0,W]×[0,H], y down) obtained through uPxToCm; masks and shading are sampled in
 * image space. Light is applied in linear RGB; color comes from LAB.
 */
export const VERTEX_SHADER = /* glsl */ `#version 300 es
out vec2 vUv; // 0..1, y down (image convention)
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); // fullscreen triangle
  vUv = p;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}`;

export const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uPhoto;
uniform sampler2D uOccluder;
uniform sampler2D uLimit;
uniform sampler2D uShading;
uniform sampler2D uFabric;

uniform vec2 uImageSize;     // working image px
uniform mat3 uPxToCm;        // column-major upload of the row-major matrix
uniform vec2 uWin;           // window W, H in cm
uniform int uFamily;         // 0 fon, 1 tul, 2 stor, 3 zebra, 4 jaluzi, 5 kruvaze
uniform float uAmount;       // family-specific: openness / drop / tieback height
uniform float uRepeatCm;
uniform float uOpacity;
uniform vec3 uTargetLab;
uniform float uShadingStrength;
uniform int uMode;           // 0 render, 1 original photo, 2 mask debug

const float PI = 3.14159265;
const float ROD_Y = -12.0;     // curtain rod 12 cm above the window
const float OVERHANG = 18.0;   // side overhang for fon / tül / kruvaze
const float MAX_DROP = 170.0;  // below the window top + H; the floor mask usually cuts earlier

// ---------- color ----------
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float fInv(float t) { return t * t * t > 0.008856 ? t * t * t : (116.0 * t - 16.0) / 903.3; }
vec3 labToLinear(vec3 lab) {
  float fy = (lab.x + 16.0) / 116.0;
  float fx = fy + lab.y / 500.0;
  float fz = fy - lab.z / 200.0;
  vec3 xyz = vec3(fInv(fx) * 0.95047, fInv(fy), fInv(fz) * 1.08883);
  return max(mat3(3.2404542, -0.969266, 0.0556434,
                  -1.5371385, 1.8760108, -0.2040259,
                  -0.4985314, 0.041556, 1.0572252) * xyz, 0.0);
}

// ---------- helpers ----------
float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
// Signed coverage of the interval [a,b] at x with anti-aliasing width aa.
float band(float x, float a, float b, float aa) {
  return smoothstep(a - aa, a + aa, x) * (1.0 - smoothstep(b - aa, b + aa, x));
}

struct Curtain {
  float alpha;    // geometric coverage
  vec2 uv;        // fabric coordinates in cm
  float shade;    // fold / slat lighting, multiplicative
  float opacity;  // material opacity multiplier
  float flat_;    // 1 = solid hardware color (rod, rails) instead of fabric
};

// Pleated drape: returns shade for local coordinate s (cm across the fabric), period P.
float pleatShade(float s, float P, float seed, out float squeeze) {
  float k = floor(s / P);
  float jitter = 0.75 + 0.5 * hash1(k + seed);
  float ph = 2.0 * PI * s / P + 0.9 * sin(2.0 * PI * s / (P * 3.7) + seed);
  squeeze = 0.22 * P * sin(ph) / (2.0 * PI);
  float light = 0.5 + 0.5 * sin(ph + 0.6);           // folds facing the light
  float cavity = 0.5 + 0.5 * cos(ph);                 // ambient occlusion in valleys
  return mix(0.48, 1.12, light) * mix(0.72, 1.0, cavity) * mix(0.94, 1.06, jitter);
}

Curtain noCurtain() { return Curtain(0.0, vec2(0.0), 1.0, 1.0, 0.0); }

Curtain rod(vec2 cm, float aa, float x0, float x1) {
  Curtain c = noCurtain();
  float a = band(cm.x, x0, x1, aa) * band(cm.y, ROD_Y - 3.5, ROD_Y - 0.5, aa);
  if (a > 0.0) {
    float t = (cm.y - (ROD_Y - 3.5)) / 3.0;
    c = Curtain(a, cm, 0.55 + 0.6 * sin(PI * clamp(t, 0.0, 1.0)) - 0.25 * t, 1.0, 1.0);
  }
  return c;
}

Curtain fon(vec2 cm, float aa) {
  float W = uWin.x;
  float cover = max(uAmount * W * 0.5, 12.0);
  float pw = OVERHANG + cover;
  float bottom = uWin.y + MAX_DROP;
  float wav = 1.2 * sin(cm.y * 0.07);
  float left = band(cm.x, -OVERHANG, -OVERHANG + pw + wav, aa);
  float right = band(cm.x, W + OVERHANG - pw - wav, W + OVERHANG, aa);
  float vert = band(cm.y, ROD_Y, bottom, aa);
  float a = max(left, right) * vert;
  if (a <= 0.0) return rod(cm, aa, -OVERHANG - 6.0, W + OVERHANG + 6.0);
  float s = cm.x < W * 0.5 ? cm.x + OVERHANG : W + OVERHANG - cm.x;
  float sq;
  float sh = pleatShade(s, 11.0, cm.x < W * 0.5 ? 1.0 : 7.0, sq);
  float heading = smoothstep(ROD_Y, ROD_Y + 9.0, cm.y);
  sh *= mix(0.9, 1.0, heading);
  return Curtain(a, vec2(s * 2.2 + sq, cm.y), sh, 1.0, 0.0);
}

Curtain tul(vec2 cm, float aa) {
  float W = uWin.x;
  float a = band(cm.x, -OVERHANG, W + OVERHANG, aa) * band(cm.y, ROD_Y, uWin.y + MAX_DROP, aa);
  if (a <= 0.0) return rod(cm, aa, -OVERHANG - 6.0, W + OVERHANG + 6.0);
  float sq;
  float sh = pleatShade(cm.x + OVERHANG, 7.0, 3.0, sq);
  sh = mix(1.0, sh, 0.55);
  return Curtain(a, vec2((cm.x + OVERHANG) * 2.4 + sq, cm.y), sh, 1.0, 0.0);
}

// Flat shade families share the frame: x ∈ [-m, W+m], cassette on top, bottom bar at the drop.
Curtain flatShade(vec2 cm, float aa, float margin, float head, out float drop) {
  float W = uWin.x;
  drop = -head + (uWin.y + head + 6.0) * clamp(uAmount, 0.05, 1.0);
  float a = band(cm.x, -margin, W + margin, aa) * band(cm.y, -head, drop + 2.5, aa);
  if (a <= 0.0) return noCurtain();
  if (cm.y < -1.0) { // cassette / head rail
    float t = (cm.y + head) / (head - 1.0);
    return Curtain(a, cm, 0.8 + 0.3 * sin(PI * t), 1.0, 1.0);
  }
  if (cm.y > drop) { // bottom bar
    return Curtain(a, cm, 0.7 + 0.2 * sin(PI * (cm.y - drop) / 2.5), 1.0, 1.0);
  }
  return Curtain(a, cm, 1.0, 1.0, 0.0);
}

Curtain stor(vec2 cm, float aa) {
  float drop;
  Curtain c = flatShade(cm, aa, 5.0, 8.0, drop);
  if (c.alpha > 0.0 && c.flat_ < 0.5) c.shade = 0.97 + 0.03 * sin(cm.x * 0.08);
  return c;
}

Curtain zebra(vec2 cm, float aa) {
  float drop;
  Curtain c = flatShade(cm, aa, 5.0, 8.0, drop);
  if (c.alpha > 0.0 && c.flat_ < 0.5) {
    float t = fract(cm.y / 15.0);
    float sheer = smoothstep(0.48, 0.52, t) * (1.0 - smoothstep(0.96, 1.0, t));
    c.opacity = mix(1.0, 0.32, sheer);
    c.shade = mix(1.0, 1.06, sheer);
  }
  return c;
}

Curtain jaluzi(vec2 cm, float aa) {
  float drop;
  Curtain c = flatShade(cm, aa, 3.0, 6.0, drop);
  if (c.alpha > 0.0 && c.flat_ < 0.5) {
    float t = fract(cm.y / 5.0);
    c.shade = 0.62 + 0.5 * sin(PI * t) - 0.12 * t;   // curved slat lit from above
    c.alpha *= 1.0 - smoothstep(0.9, 0.95, t);          // gap between slats
    float W = uWin.x;
    float ladder = 0.0;
    for (int i = 0; i < 3; i++) {
      float lx = mix(12.0, W - 12.0, float(i) * 0.5);
      ladder = max(ladder, band(cm.x, lx - 0.3, lx + 0.3, aa));
    }
    c.shade *= 1.0 - 0.5 * ladder;
    c.uv = vec2(cm.x, floor(cm.y / 5.0) * 7.3 + t * 5.0);
  }
  return c;
}

// One kruvaze panel in mirrored coordinates (outer edge at x = -OVERHANG).
Curtain kruvazePanel(vec2 cm, float aa, float seed) {
  float W = uWin.x;
  float tieY = ROD_Y + clamp(uAmount, 0.2, 0.95) * (uWin.y + 12.0);
  float xTie = -OVERHANG + 26.0;
  float xTop = W * 0.5 + 10.0;
  float inner;
  if (cm.y < tieY) {
    float t = clamp((cm.y - ROD_Y) / (tieY - ROD_Y), 0.0, 1.0);
    inner = mix(xTop, xTie, pow(t, 0.75));
  } else {
    inner = xTie + min((cm.y - tieY) * 0.22, 20.0);
  }
  float outer = -OVERHANG;
  float a = band(cm.x, outer, inner, aa * 1.5) * band(cm.y, ROD_Y, uWin.y + MAX_DROP, aa);
  if (a <= 0.0) return noCurtain();
  float u = clamp((cm.x - outer) / max(inner - outer, 1.0), 0.0, 1.0);
  float sq;
  float topWidth = xTop - outer;
  float sh = pleatShade(u * topWidth * 0.8, 11.0, seed, sq);
  sh *= mix(0.86, 1.0, u);                        // inner swag catches more light
  float tie = band(cm.y, tieY - 3.0, tieY + 3.0, aa) * step(u, 0.98);
  sh = mix(sh, 0.55 + 0.25 * sin(PI * (cm.y - tieY + 3.0) / 6.0), tie);
  return Curtain(a, vec2(u * topWidth * 2.0 + sq, cm.y), sh, 1.0, 0.0);
}

Curtain kruvaze(vec2 cm, float aa) {
  float W = uWin.x;
  Curtain l = kruvazePanel(cm, aa, 2.0);
  Curtain r = kruvazePanel(vec2(W - cm.x, cm.y), aa, 9.0);
  Curtain c = l; // left panel lies on top
  if (l.alpha < 0.999 && r.alpha > l.alpha) c = r;
  if (c.alpha <= 0.0) return rod(cm, aa, -OVERHANG - 6.0, W + OVERHANG + 6.0);
  c.alpha = max(l.alpha, r.alpha);
  return c;
}

Curtain evalCurtain(vec2 cm, float aa) {
  if (uFamily == 0) return fon(cm, aa);
  if (uFamily == 1) return tul(cm, aa);
  if (uFamily == 2) return stor(cm, aa);
  if (uFamily == 3) return zebra(cm, aa);
  if (uFamily == 4) return jaluzi(cm, aa);
  return kruvaze(cm, aa);
}

void main() {
  vec3 photo = texture(uPhoto, vUv).rgb;
  if (uMode == 1) { outColor = vec4(photo, 1.0); return; }
  float occ = texture(uOccluder, vUv).r;
  float lim = texture(uLimit, vUv).r;
  if (uMode == 2) {
    vec3 dbg = photo * 0.45 + vec3(0.55, 0.1, 0.1) * occ + vec3(0.1, 0.35, 0.1) * lim;
    outColor = vec4(dbg, 1.0);
    return;
  }

  vec3 h = uPxToCm * vec3(vUv * uImageSize, 1.0);
  vec2 cm = h.xy / h.z;
  float aa = max(fwidth(cm.x), fwidth(cm.y)) * 0.75;
  Curtain c = noCurtain(); // GLSL ES forbids ?: on structs
  if (h.z > 0.0) c = evalCurtain(cm, aa);

  vec3 photoLin = srgbToLinear(photo);
  if (c.alpha <= 0.0) { outColor = vec4(photo, 1.0); return; }

  vec3 baseLin;
  if (c.flat_ > 0.5) {
    baseLin = vec3(0.62, 0.62, 0.6); // hardware: rod, cassette, rails
  } else {
    float detail = texture(uFabric, c.uv / uRepeatCm).r - 0.5;
    vec3 lab = vec3(clamp(uTargetLab.x + detail * 55.0, 0.0, 100.0), uTargetLab.yz);
    baseLin = labToLinear(lab);
  }
  float S = texture(uShading, vUv).r * 2.0;
  vec3 lit = baseLin * c.shade * pow(max(S, 0.02), uShadingStrength);

  // Soft masks come from bilinearly upsampled probabilities; tighten the transition band so the
  // curtain stops crisply at furniture and floor instead of fading out.
  float visible = c.alpha * (1.0 - smoothstep(0.3, 0.7, occ)) * (1.0 - smoothstep(0.3, 0.7, lim));
  float op = clamp(uOpacity * c.opacity, 0.0, 1.0);
  if (c.flat_ > 0.5) op = 1.0;
  vec3 outLin = mix(photoLin, lit, visible * op);
  outColor = vec4(linearToSrgb(outLin), 1.0);
}`;
