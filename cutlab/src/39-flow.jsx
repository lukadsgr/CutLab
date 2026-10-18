/* =====================================================================
   Interpolação por fluxo óptico (WebGL2)
   Gera quadros intermediários de verdade em câmera lenta, em vez de
   repetir ou "fantasmar" quadros:
     1. pirâmide (até 6 níveis) com luminância + gradientes dos quadros A e B
     2. fluxo do grosso para o fino, nos DOIS sentidos (A→B e B→A): busca por blocos
        nos níveis grossos (movimentos grandes) + Lucas–Kanade com janela ponderada
        pela borda (não mistura objeto com fundo)
     3. por nível: mediana 3×3 (remove vetores errados) + filtro bilateral guiado
        pela imagem (suaviza sem borrar as bordas do movimento)
     4. checagem de consistência ida/volta → mapa de visibilidade (oclusões)
     5. warp para o instante t invertendo o fluxo por ponto fixo; cada lado pesa
        pela visibilidade — transições suaves, sem "pulo" no meio do intervalo
   O fluxo fica em cache por par de quadros (alguns pares, para vários clipes);
   cada quadro de saída só refaz o warp (barato). O mesmo warp, amostrado em
   vários instantes, gera desfoque de movimento entre dois quadros reais.
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
    const head = '#version 300 es\nprecision highp float;\nin vec2 uv; out vec4 o;\nuniform vec2 size;\n';
    this.P = {
      // luminância no tamanho do nível 0, com média de 4 amostras (evita serrilhado)
      gray: this.prog(vs, head + `uniform sampler2D src;
        float L(vec2 q){ return dot(texture(src, q).rgb, vec3(0.299, 0.587, 0.114)); }
        void main(){ vec2 d = 0.25 / size; o = vec4((L(uv + d) + L(uv - d) + L(uv + vec2(d.x, -d.y)) + L(uv + vec2(-d.x, d.y))) * 0.25, 0.0, 0.0, 1.0); }`),
      // redução 2× com filtro 4×4 (4 leituras bilineares)
      down: this.prog(vs, head + `uniform sampler2D src;
        void main(){ vec2 d = 0.5 / size; o = vec4((texture(src, uv + d).r + texture(src, uv - d).r + texture(src, uv + vec2(d.x, -d.y)).r + texture(src, uv + vec2(-d.x, d.y)).r) * 0.25, 0.0, 0.0, 1.0); }`),
      // r = intensidade, g/b = gradiente (Scharr) em intensidade por pixel
      grad: this.prog(vs, head + `uniform sampler2D src;
        float I(float x, float y){ return texture(src, uv + vec2(x, y) / size).r; }
        void main(){
          float gx = (3.0 * (I(1.,-1.) - I(-1.,-1.)) + 10.0 * (I(1.,0.) - I(-1.,0.)) + 3.0 * (I(1.,1.) - I(-1.,1.))) / 32.0;
          float gy = (3.0 * (I(-1.,1.) - I(-1.,-1.)) + 10.0 * (I(0.,1.) - I(0.,-1.)) + 3.0 * (I(1.,1.) - I(1.,-1.))) / 32.0;
          o = vec4(I(0., 0.), gx, gy, 1.0);
        }`),
      // um passo de Lucas–Kanade; fluxo guardado em unidades de uv (independe do nível)
      lk: this.prog(vs, head + `uniform sampler2D A; uniform sampler2D B; uniform sampler2D F;
        void main(){
          vec2 px = 1.0 / size;
          vec2 f = texture(F, uv).xy;
          float ic = texture(A, uv).r;
          float sxx = 0.0, syy = 0.0, sxy = 0.0, sxt = 0.0, syt = 0.0, ws = 0.0;
          for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
            vec2 q = uv + vec2(float(i), float(j)) * px;
            vec3 a = texture(A, q).rgb, b = texture(B, q + f).rgb;
            float di = a.r - ic;
            // janela gaussiana × semelhança com o centro: não puxa o movimento do fundo para o objeto
            float w = exp(-float(i * i + j * j) / 8.0 - di * di * 180.0);
            vec2 g = 0.5 * (a.gb + b.gb);
            float it = b.r - a.r;
            sxx += w * g.x * g.x; syy += w * g.y * g.y; sxy += w * g.x * g.y; sxt += w * g.x * it; syt += w * g.y * it; ws += w;
          }
          float lam = ws * 4e-5;
          sxx += lam; syy += lam;
          float det = sxx * syy - sxy * sxy;
          vec2 d = vec2(-(syy * sxt - sxy * syt), -(sxx * syt - sxy * sxt)) / det;
          float m = length(d);
          if (m > 2.0) d *= 2.0 / m;
          o = vec4(f + d * px, 0.0, 1.0);
        }`),
      // busca por blocos ao redor do fluxo atual (níveis grossos): pega movimentos grandes que o LK não alcança
      search: this.prog(vs, head + `uniform sampler2D A; uniform sampler2D B; uniform sampler2D F;
        float ic;
        float cost(vec2 x, vec2 f, vec2 px){
          float c = 0.0, ws = 0.0;
          for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            vec2 q = x + vec2(float(i), float(j)) * px;
            vec3 a = texture(A, q).rgb;
            vec3 d = a - texture(B, q + f).rgb;
            float w = exp(-(a.r - ic) * (a.r - ic) * 120.0);   // pesa os pixels parecidos com o centro (mesmo objeto)
            c += w * (abs(d.r) + 2.0 * (abs(d.g) + abs(d.b))); ws += w;
          }
          return c / ws;
        }
        void main(){
          vec2 px = 1.0 / size;
          ic = texture(A, uv).r;
          vec2 f0 = texture(F, uv).xy, best = f0;
          float bc = cost(uv, f0, px) - 0.002;   // leve preferência pelo fluxo que já veio do nível acima
          for (int j = -4; j <= 4; j++) for (int i = -4; i <= 4; i++) {
            if (i == 0 && j == 0) continue;
            vec2 f = f0 + vec2(float(i), float(j)) * px;
            float c = cost(uv, f, px) + 0.0002 * float(i * i + j * j);
            if (c < bc) { bc = c; best = f; }
          }
          o = vec4(best, 0.0, 1.0);
        }`),
      // mediana 3×3 por componente (rede de ordenação de 9 elementos)
      median: this.prog(vs, head + `uniform sampler2D F;
        #define S(a,b) { vec2 lo = min(v[a], v[b]); v[b] = max(v[a], v[b]); v[a] = lo; }
        void main(){
          vec2 px = 1.0 / size; vec2 v[9];
          for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) v[j * 3 + i] = texture(F, uv + vec2(float(i - 1), float(j - 1)) * px).xy;
          S(1,2) S(4,5) S(7,8) S(0,1) S(3,4) S(6,7) S(1,2) S(4,5) S(7,8) S(0,3) S(5,8) S(4,7) S(3,6) S(1,4) S(2,5) S(4,7) S(4,2) S(6,4) S(4,2)
          o = vec4(v[4], 0.0, 1.0);
        }`),
      // bilateral conjunto: pesa por distância, semelhança na imagem e semelhança do vetor
      smooth: this.prog(vs, head + `uniform sampler2D F; uniform sampler2D G;
        void main(){
          vec2 px = 1.0 / size; vec2 c = texture(F, uv).xy; float ic = texture(G, uv).r;
          vec2 s = vec2(0.0); float ws = 0.0;
          for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            vec2 q = uv + vec2(float(i), float(j)) * px;
            vec2 v = texture(F, q).xy; float di = texture(G, q).r - ic;
            vec2 dv = (v - c) * size;
            float w = exp(-float(i * i + j * j) / 4.5 - di * di * 250.0 - dot(dv, dv) * 0.25);
            s += v * w; ws += w;
          }
          o = vec4(s / ws, 0.0, 1.0);
        }`),
      // visibilidade: o ponto vai com F e volta com R; se não volta ao lugar, está oculto no outro quadro
      occ: this.prog(vs, head + `uniform sampler2D F; uniform sampler2D R;
        void main(){
          vec2 f = texture(F, uv).xy;
          vec2 r = texture(R, uv + f).xy;
          float e = length((f + r) * size);
          float tol = 0.7 + 0.06 * length(f * size);
          o = vec4(f, 1.0 - smoothstep(tol, tol * 3.0, e), 1.0);
        }`),
      // quadro no instante t; com spread > 0 faz a média de vários instantes (desfoque de movimento)
      warp: this.prog(vs, head + `uniform sampler2D SA; uniform sampler2D SB; uniform sampler2D FA; uniform sampler2D FB;
        uniform float t; uniform float spread;
        // acha o ponto p do quadro de origem que chega em x no instante s:  x = p + s·F(p)
        vec3 solve(sampler2D F, vec2 x, float s, vec2 v0){
          vec2 v = v0;
          for (int k = 0; k < 4; k++) v = texture(F, x - s * v).xy;
          vec2 p = x - s * v;
          vec3 fp = texture(F, p).xyz;
          float res = length((p + s * fp.xy - x) * size);
          // confiança: ponto fixo bem resolvido; a visibilidade só desempata (numa área recém-descoberta
          // o único lado que resolve é justamente o que está "oculto" no outro quadro)
          return vec3(p, exp(-res * res * 0.5) * mix(0.12, 1.0, fp.z));
        }
        vec3 pick(sampler2D F, vec2 x, float s, vec2 a, vec2 b){
          vec3 p1 = solve(F, x, s, a), p2 = solve(F, x, s, b);
          return p1.z >= p2.z ? p1 : p2;
        }
        vec4 frameAt(vec2 x, float tt){
          vec2 fa = texture(FA, x).xy, fb = texture(FB, x).xy;
          vec3 pa = pick(FA, x, tt, fa, -fb);
          vec3 pb = pick(FB, x, 1.0 - tt, fb, -fa);
          vec4 a = texture(SA, pa.xy), b = texture(SB, pb.xy);
          float wa = (1.0 - tt) * (pa.z + 0.002), wb = tt * (pb.z + 0.002);
          return (a * wa + b * wb) / max(wa + wb, 1e-5);
        }
        void main(){
          if (spread <= 0.0) { o = frameAt(uv, t); return; }
          vec4 acc = vec4(0.0);
          for (int k = 0; k < 7; k++) acc += frameAt(uv, clamp(t + spread * (float(k) / 6.0 - 0.5), 0.0, 1.0));
          o = acc / 7.0;
        }`),
    };
    this.locs = new Map();
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.zero = this.tex(1, 1, true);
    this.cache = [];
  }
  prog(vs, fs) {
    const gl = this.gl;
    const mk = (t, s) => { const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h); if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(h)); return h; };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
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
  free(x) {
    if (!x) return;
    this.gl.deleteTexture(x.t);
    if (x.fb) this.gl.deleteFramebuffer(x.fb);
  }
  /** prepara a pirâmide de trabalho para um tamanho de quadro */
  setup(w, h) {
    if (this.w === w && this.h === h) return;
    for (const e of this.cache) for (const k of ['SA', 'SB', 'FA', 'FB']) this.free(e[k]);
    this.cache = [];
    for (const l of this.levels || []) for (const k of ['GA', 'GB', 'IA', 'IB', 'F1', 'F2']) this.free(l[k]);
    this.w = w; this.h = h;
    const L0w = Math.min(w, 640), L0h = Math.max(8, Math.round(L0w * h / w));
    this.levels = [];
    for (let l = 0; l < 6; l++) {
      const lw = Math.max(8, Math.round(L0w / 2 ** l)), lh = Math.max(8, Math.round(L0h / 2 ** l));
      this.levels.push({ w: lw, h: lh, IA: this.tex(lw, lh, true), IB: this.tex(lw, lh, true), GA: this.tex(lw, lh, true), GB: this.tex(lw, lh, true), F1: this.tex(lw, lh, true), F2: this.tex(lw, lh, true) });
      if (lw <= 24 || lh <= 12) break;
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }
  pass(prog, target, uniforms, flip = false) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    const W = target ? target.w : this.canvas.width, H = target ? target.h : this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    let locs = this.locs.get(prog);
    if (!locs) this.locs.set(prog, (locs = {}));
    const loc = (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(prog, n)));
    gl.uniform1i(loc('flip'), flip ? 1 : 0);
    gl.uniform2f(loc('size'), uniforms.size?.[0] ?? W, uniforms.size?.[1] ?? H);
    let unit = 0;
    for (const [name, v] of Object.entries(uniforms)) {
      if (name === 'size') continue;
      if (v && v.t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.t); gl.uniform1i(loc(name), unit++); }
      else gl.uniform1f(loc(name), v);
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
  /** fluxo de G1 para G2 (pirâmides de gradiente) do grosso para o fino; devolve a textura do nível 0 */
  flowDir(g1, g2) {
    const L = this.levels;
    let prev = this.zero;
    for (let l = L.length - 1; l >= 0; l--) {
      const lv = L[l], size = [lv.w, lv.h], iters = l === 0 ? 3 : 4;
      let src = prev, out = lv.F1, other = lv.F2;
      if (l >= 2) {
        // busca + limpeza antes do LK, para o refinamento partir de um palpite robusto
        this.pass(this.P.search, out, { A: lv[g1], B: lv[g2], F: src, size });
        this.pass(this.P.median, other, { F: out, size });
        src = other;
      }
      for (let it = 0; it < iters; it++) {
        this.pass(this.P.lk, out, { A: lv[g1], B: lv[g2], F: src, size });
        src = out; [out, other] = [other, out];
      }
      this.pass(this.P.median, out, { F: src, size });
      [src, out] = [out, src];
      this.pass(this.P.smooth, out, { F: src, G: lv[g1], size });
      prev = out;
    }
    return prev;
  }
  /** calcula o fluxo nos dois sentidos e a visibilidade (uma vez por par) */
  computeFlow(e, A, B) {
    this.upload(e.SA, A);
    this.upload(e.SB, B);
    const L = this.levels, L0 = L[0];
    this.pass(this.P.gray, L0.IA, { src: e.SA });
    this.pass(this.P.gray, L0.IB, { src: e.SB });
    for (let l = 1; l < L.length; l++) {
      this.pass(this.P.down, L[l].IA, { src: L[l - 1].IA });
      this.pass(this.P.down, L[l].IB, { src: L[l - 1].IB });
    }
    for (const lv of L) {
      this.pass(this.P.grad, lv.GA, { src: lv.IA });
      this.pass(this.P.grad, lv.GB, { src: lv.IB });
    }
    // ida: copia para um rascunho do nível 0 antes de calcular a volta (que reusa F1/F2)
    const fwd = this.flowDir('GA', 'GB');
    this.pass(this.P.median, L0.IA, { F: fwd, size: [L0.w, L0.h] });   // IA não é mais usado: vira rascunho
    const bwd = this.flowDir('GB', 'GA');
    this.pass(this.P.occ, e.FA, { F: L0.IA, R: bwd });
    this.pass(this.P.occ, e.FB, { F: bwd, R: L0.IA });
  }
  /** entrada do cache para o par (cria ou recicla a mais antiga) */
  entry(key) {
    let e = this.cache.find((x) => x.key === key);
    if (e) { this.cache = [e, ...this.cache.filter((x) => x !== e)]; return { e, fresh: false }; }
    if (this.cache.length >= 3) e = this.cache.pop();
    else {
      const L0 = this.levels[0];
      e = { SA: this.tex(this.w, this.h, false), SB: this.tex(this.w, this.h, false), FA: this.tex(L0.w, L0.h, true), FB: this.tex(L0.w, L0.h, true) };
    }
    e.key = key;
    this.cache.unshift(e);
    return { e, fresh: true };
  }
  /**
   * quadro intermediário entre A e B no instante t (0..1); devolve um canvas ou null.
   * spread (0..1, em fração do intervalo entre os quadros) faz a média ao redor de t: desfoque de movimento.
   */
  interp(A, B, key, t, w, h, spread = 0) {
    if (!this.ok) return null;
    try {
      this.setup(w, h);
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      const { e, fresh } = this.entry(key);
      if (fresh) this.computeFlow(e, A, B);
      const L0 = this.levels[0];
      this.pass(this.P.warp, null, { SA: e.SA, SB: e.SB, FA: e.FA, FB: e.FB, size: [L0.w, L0.h], t, spread: Math.min(1, spread) }, true);
      return this.canvas;
    } catch (err) {
      this.ok = false;
      return null;
    }
  }
}
let _flowGL;
const flowGL = () => (_flowGL ||= new FlowGL());
