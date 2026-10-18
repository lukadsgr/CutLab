/* =====================================================================
   Interpolação por fluxo óptico (WebGL2)
   Gera quadros intermediários de verdade em câmera lenta, em vez de
   repetir ou "fantasmar" quadros:
     1. pirâmide de luminância (4 níveis) dos quadros A e B
     2. fluxo Lucas–Kanade do grosso para o fino (3 iterações por nível)
     3. suavização do campo de fluxo
     4. warp bidirecional A→t←B com proteção contra oclusões
   O fluxo é calculado uma vez por par de quadros; cada quadro de saída
   só refaz o warp (barato).
   ===================================================================== */
class FlowGL {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    this.ok = !!gl && !!gl.getExtension('EXT_color_buffer_float');
    if (!this.ok) return;
    this.gl = gl;
    const vs = `#version 300 es
      in vec2 p; out vec2 uv; uniform bool flip;
      void main(){ uv = p * 0.5 + 0.5; if (flip) uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }`;
    const head = '#version 300 es\nprecision highp float;\nin vec2 uv; out vec4 o;\n';
    this.P = {
      gray: this.prog(vs, head + `uniform sampler2D src; void main(){ vec3 c = texture(src, uv).rgb; o = vec4(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 0.0, 1.0); }`),
      down: this.prog(vs, head + `uniform sampler2D src; void main(){ o = vec4(texture(src, uv).r, 0.0, 0.0, 1.0); }`),
      lk: this.prog(vs, head + `
        uniform sampler2D A; uniform sampler2D B; uniform sampler2D F; uniform vec2 size; uniform float scaleF;
        void main(){
          vec2 px = 1.0 / size;
          vec2 f = texture(F, uv).xy * scaleF;
          float sxx = 0.0, syy = 0.0, sxy = 0.0, sxt = 0.0, syt = 0.0;
          for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            vec2 q = uv + vec2(float(i), float(j)) * px;
            float w = exp(-float(i * i + j * j) / 4.5);
            float ax = (texture(A, q + vec2(px.x, 0.0)).r - texture(A, q - vec2(px.x, 0.0)).r) * 0.5;
            float ay = (texture(A, q + vec2(0.0, px.y)).r - texture(A, q - vec2(0.0, px.y)).r) * 0.5;
            float bt = texture(B, q + f * px).r - texture(A, q).r;
            sxx += w * ax * ax; syy += w * ay * ay; sxy += w * ax * ay; sxt += w * ax * bt; syt += w * ay * bt;
          }
          sxx += 2e-4; syy += 2e-4;
          float det = sxx * syy - sxy * sxy;
          vec2 d = vec2(-(syy * sxt - sxy * syt), -(sxx * syt - sxy * sxt)) / det;
          o = vec4(f + clamp(d, -2.5, 2.5), 0.0, 1.0);
        }`),
      smooth: this.prog(vs, head + `
        uniform sampler2D F; uniform vec2 size;
        void main(){
          vec2 px = 1.0 / size; vec2 s = vec2(0.0); float ws = 0.0;
          vec2 c = texture(F, uv).xy;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 v = texture(F, uv + vec2(float(i), float(j)) * px).xy;
            float w = exp(-dot(v - c, v - c) * 0.5) * (i == 0 && j == 0 ? 2.0 : 1.0);
            s += v * w; ws += w;
          }
          o = vec4(s / ws, 0.0, 1.0);
        }`),
      warp: this.prog(vs, head + `
        uniform sampler2D SA; uniform sampler2D SB; uniform sampler2D FL; uniform vec2 flSize; uniform float t;
        void main(){
          vec2 f = texture(FL, uv).xy / flSize;
          vec4 a = texture(SA, uv - f * t);
          vec4 b = texture(SB, uv + f * (1.0 - t));
          // onde A e B discordam (oclusão), pende para o quadro mais próximo no tempo
          float diff = length(a.rgb - b.rgb);
          float wt = mix(t, step(0.5, t), smoothstep(0.12, 0.4, diff));
          o = mix(a, b, wt);
        }`),
    };
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.zero = this.tex(1, 1, true);
    this.key = null;
  }
  prog(vs, fs) {
    const gl = this.gl;
    const mk = (t, s) => { const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h); if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(h)); return h; };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    return p;
  }
  tex(w, h, float) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    if (float) {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { t, fb, w, h };
    }
    return { t, w, h };
  }
  /** prepara texturas para um tamanho de quadro */
  setup(w, h) {
    if (this.w === w && this.h === h) return;
    this.w = w; this.h = h;
    const gl = this.gl;
    this.srcA = this.tex(w, h, false); this.srcB = this.tex(w, h, false);
    const L0w = 384, L0h = Math.max(8, Math.round(384 * h / w));
    this.levels = [];
    for (let l = 0; l < 4; l++) {
      const lw = Math.max(4, L0w >> l), lh = Math.max(4, L0h >> l);
      this.levels.push({ w: lw, h: lh, A: this.tex(lw, lh, true), B: this.tex(lw, lh, true), F1: this.tex(lw, lh, true), F2: this.tex(lw, lh, true) });
    }
    this.pre = { A: this.tex(L0w * 2, L0h * 2, true), B: this.tex(L0w * 2, L0h * 2, true) };
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  pass(prog, target, uniforms, flip = false) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'flip'), flip ? 1 : 0);
    let unit = 0;
    for (const [name, v] of Object.entries(uniforms)) {
      const loc = gl.getUniformLocation(prog, name);
      if (v && v.t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.t); gl.uniform1i(loc, unit++); }
      else if (Array.isArray(v)) gl.uniform2f(loc, v[0], v[1]);
      else gl.uniform1f(loc, v);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  upload(dst, img) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, dst.t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, dst.w, dst.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
  }
  /** calcula o fluxo A→B (uma vez por par) */
  computeFlow(A, B) {
    this.upload(this.srcA, A);
    this.upload(this.srcB, B);
    const L = this.levels;
    this.pass(this.P.gray, this.pre.A, { src: this.srcA });
    this.pass(this.P.gray, this.pre.B, { src: this.srcB });
    this.pass(this.P.down, L[0].A, { src: this.pre.A });
    this.pass(this.P.down, L[0].B, { src: this.pre.B });
    for (let l = 1; l < L.length; l++) {
      this.pass(this.P.down, L[l].A, { src: L[l - 1].A });
      this.pass(this.P.down, L[l].B, { src: L[l - 1].B });
    }
    let prev = null;
    for (let l = L.length - 1; l >= 0; l--) {
      const lv = L[l];
      let src = prev || this.zero, scale = prev ? 2 : 0, out = lv.F1, other = lv.F2;
      for (let it = 0; it < 3; it++) {
        this.pass(this.P.lk, out, { A: lv.A, B: lv.B, F: src, size: [lv.w, lv.h], scaleF: scale });
        src = out; scale = 1;
        [out, other] = [other, out];
      }
      this.pass(this.P.smooth, out, { F: src, size: [lv.w, lv.h] });
      prev = out;
    }
    this.flow = prev;
  }
  /** quadro intermediário entre A e B no instante t (0..1); devolve um canvas ou null */
  interp(A, B, key, t, w, h) {
    if (!this.ok) return null;
    try {
      this.setup(w, h);
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      if (key !== this.key) { this.computeFlow(A, B); this.key = key; }
      const L0 = this.levels[0];
      this.pass(this.P.warp, null, { SA: this.srcA, SB: this.srcB, FL: this.flow, flSize: [L0.w, L0.h], t }, true);
      return this.canvas;
    } catch (e) {
      this.ok = false;
      return null;
    }
  }
}
let _flowGL;
const flowGL = () => (_flowGL ||= new FlowGL());
