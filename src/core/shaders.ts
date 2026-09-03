/**
 * 自定义 GLSL 库。约定：
 *  - 所有 uniform/attribute 名字带材质前缀，避免 three 自动 uniform 冲突。
 *  - 天空/雾在 JS 与 GLSL 两处一致（ENV 常量注入）。
 *  - 线性空间着色，最终由 composite pass 做 ACES + 色调 + 暗角 + 颗粒。
 */
import { ENV } from '../core/palette';

/** 注入 GLSL 的颜色常量 */
function envDefines(): string {
  const c = (name: string, v: readonly number[]) =>
    `const vec3 ${name} = vec3(${v[0].toFixed(5)}, ${v[1].toFixed(5)}, ${v[2].toFixed(5)});`;
  return [
    c('ENV_ZENITH', ENV.zenith),
    c('ENV_HORIZON', ENV.horizon),
    c('ENV_FLOOR', ENV.floor),
    c('ENV_SUN', ENV.sun),
    c('ENV_SUNT', ENV.sunTint),
    c('ENV_CORAL', ENV.coral),
    c('ENV_APRICOT', ENV.apricot),
    c('ENV_LAKE', ENV.lake),
    c('ENV_MINT', ENV.mint),
    c('ENV_LEMON', ENV.lemon),
    c('ENV_PEARL', ENV.pearl),
    c('ENV_LILAC', ENV.lilac),
    c('ENV_ROSE', ENV.rose),
    c('ENV_FOG', ENV.fog),
  ].join('\n');
}

export const CHUNK_COMMON = /* glsl */ `
#define PI 3.141592653589793
#define TAU 6.283185307179586
#define sq(x) ((x)*(x))
${envDefines()}

float hash11(float n){ return fract(sin(n*127.1+311.7)*43758.5453123); }
float hash21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
float hash31(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453123); }
vec2 hash22(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }

float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),u.x),
             mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),u.x),u.y);
}
float vnoise3(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float n=dot(i,vec3(1.0,57.0,113.0));
  return mix(mix(mix(hash11(n),hash11(n+1.0),f.x),mix(hash11(n+57.0),hash11(n+58.0),f.x),f.y),
             mix(mix(hash11(n+113.0),hash11(n+114.0),f.x),mix(hash11(n+170.0),hash11(n+171.0),f.x),f.y),f.z);
}
float fbm(vec2 p){ float a=0.0,s=0.5; for(int i=0;i<5;i++){ a+=s*vnoise(p); p*=2.03; s*=0.5;} return a; }
float fbm3(vec3 p){ float a=0.0,s=0.5; for(int i=0;i<4;i++){ a+=s*vnoise3(p); p*=2.07; s*=0.5;} return a; }

vec3 skyColor(vec3 dir){
  float y=dir.y;
  vec3 c=mix(ENV_HORIZON,ENV_ZENITH,smoothstep(-0.02,0.55,y));
  float down=smoothstep(0.0,-0.4,y);
  c=mix(c,ENV_FLOOR,down*0.85);
  // 暖色地平带
  float band=exp(-abs(y)*6.0);
  c+=ENV_SUNT*band*0.28;
  return c;
}
`;

/** 菲涅尔（Schlick） */
export const CHUNK_FRESNEL = /* glsl */ `
float fresnel(vec3 N, vec3 V, float f0){ return f0 + (1.0-f0)*pow(clamp(1.0-dot(N,V),0.0,1.0),5.0); }
vec3 acesTone(vec3 x){
  x*=0.6;
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);
}
`;

// ============================================================
// 天穹 / 环境
// ============================================================
export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir=normalize(position);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;
export const SKY_FRAG = /* glsl */ `
${CHUNK_COMMON}
uniform float uTime;
varying vec3 vDir;
void main(){
  vec3 c=skyColor(vDir);
  // 缓慢流动的柔和云带（偏移沿圆周运动，120s 精确闭环 → 无缝循环）
  vec2 clOff=vec2(cos(uTime*TAU/120.0)-1.0,sin(uTime*TAU/120.0))*2.0;
  float cl=fbm(vDir.xz*3.0+clOff+vDir.y*1.5);
  cl=smoothstep(0.48,0.75,cl);
  c=mix(c,ENV_PEARL,cl*0.32*smoothstep(-0.05,0.4,vDir.y));
  // 极浅淡紫的天幕过渡
  c+=ENV_LILAC*0.05*smoothstep(0.1,0.9,vDir.y)*(0.6+0.4*cl);
  gl_FragColor=vec4(c,1.0);
}`;

// ============================================================
// 水面（主视觉之一）：涟漪叠加 + 焦散 + 菲涅尔反射天穹 + 折射水体
// ============================================================
/** 单个涟漪在高度场上的贡献（与 JS 水面高度保持解析一致时用于顶点位移的近似） */
export function waterSurfaceFrag(maxRipples: number): string {
  return /* glsl */ `
${CHUNK_COMMON}
${CHUNK_FRESNEL}
#define MAXR ${maxRipples}
uniform float uTime;
uniform vec4 uRipA[MAXR];   // xz center, t0, amp
uniform vec4 uRipB[MAXR];   // wl, sp, life, wid
uniform vec3 uRipC[MAXR];   // color
uniform float uCaustic;      // 焦散强度（水冠时刻爆发）
uniform vec2 uSunDirXZ;
uniform float uGather;       // 收拢：水面趋于平静
uniform vec3 uCamPos;
varying vec3 vWorldPos;
varying vec2 vUv;

// 返回 [高度, 颜色叠加权重]；梯度用于法线
vec3 rippleField(vec2 p, float t){
  float h=0.0; vec3 col=vec3(0.0);
  for(int i=0;i<MAXR;i++){
    float t0=uRipA[i].z;
    if(t0<=0.0) continue;
    float age=t-t0;
    if(age<0.0) continue;
    float life=uRipB[i].z;
    if(age>life) continue;
    vec2 ctr=uRipA[i].xy;
    float dist=length(p-ctr);
    float sp=uRipB[i].y, wl=uRipB[i].x, wid=uRipB[i].w;
    float front=sp*age;
    float amp=uRipA[i].w;
    // 波前包络（高斯环）+ 尾部衰减振荡
    float ring=exp(-sq((dist-front)/wid));
    float tail=exp(-pow(max(0.0,front-dist)/ (wl*2.2),2.0));
    float phase=(dist-front)/wl*TAU;
    float w=amp*(ring*0.85 + tail*0.5*cos(phase)*exp(-max(0.0,front-dist)*0.15));
    w*=exp(-age*0.35)*exp(-dist*0.035);
    // 收拢阶段涟漪淡出
    w*=(1.0-uGather*0.7);
    h+=w;
    col+=uRipC[i]*abs(w)*1.6;
  }
  return vec3(h,col);
}

// 解析梯度（数值）
float heightAt(vec2 p, float t){
  float h=0.0;
  for(int i=0;i<MAXR;i++){
    float t0=uRipA[i].z; if(t0<=0.0) continue;
    float age=t-t0; if(age<0.0) continue;
    float life=uRipB[i].z; if(age>life) continue;
    vec2 ctr=uRipA[i].xy;
    float dist=length(p-ctr);
    float sp=uRipB[i].y, wl=uRipB[i].x, wid=uRipB[i].w, amp=uRipA[i].w;
    float front=sp*age;
    float ring=exp(-sq((dist-front)/wid));
    float tail=exp(-pow(max(0.0,front-dist)/(wl*2.2),2.0));
    float phase=(dist-front)/wl*TAU;
    float w=amp*(ring*0.85+tail*0.5*cos(phase)*exp(-max(0.0,front-dist)*0.15));
    h+=w*exp(-age*0.35)*exp(-dist*0.035);
  }
  return h*(1.0-uGather*0.7);
}

void main(){
  vec2 p=vWorldPos.xz;
  float t=uTime;
  vec3 rf=rippleField(p,t);
  float h=rf.x;
  // 数值法线
  float e=0.12;
  float hx=heightAt(p+vec2(e,0.0),t)-heightAt(p-vec2(e,0.0),t);
  float hz=heightAt(p+vec2(0.0,e),t)-heightAt(p-vec2(0.0,e),t);
  // 细密毛细波（首尾包络归零 → 循环点水面绝对平静）
  float capEnv=smoothstep(0.0,2.5,t)*(1.0-uGather);
  float cap=(fbm(p*6.0+t*0.3)-0.5)*0.018 + (fbm(p*22.0-t*0.5)-0.5)*0.006;
  float capx=(vnoise((p+vec2(e,0.0))*22.0-t*0.5)-vnoise((p-vec2(e,0.0))*22.0-t*0.5))*0.02;
  float capz=(vnoise((p+vec2(0.0,e))*22.0-t*0.5)-vnoise((p-vec2(0.0,e))*22.0-t*0.5))*0.02;
  cap*=capEnv; capx*=capEnv; capz*=capEnv;
  vec3 N=normalize(vec3(-(hx*0.5+capx)/e*0.12 - 0.06, 1.0, -(hz*0.5+capz)/e*0.12 - 0.06));
  vec3 V=normalize(uCamPos-vWorldPos);
  float fres=fresnel(N,V,0.02);

  // 天穹反射
  vec3 R=reflect(-V,N);
  R.y=abs(R.y)+0.02;
  vec3 refl=skyColor(normalize(R));
  // 太阳高光
  vec3 L=normalize(vec3(uSunDirXZ.x,0.85,uSunDirXZ.y));
  float spec=pow(max(dot(R,L),0.0),220.0);
  refl+=ENV_SUN*spec*0.9;

  // 折射水体（伪深度：向下的环境吸收 + 焦散）
  vec3 refr=skyColor(normalize(vec3(V.x,abs(V.y)+0.15,V.z)));
  refr=mix(refr,ENV_LAKE*0.7+ENV_MINT*0.3,0.35);
  refr*=0.82;

  // 焦散（两层流动的 Voronoi-ish 光斑）
  vec2 cp=p*1.1+N.xz*1.4;
  float ca=vnoise(cp*2.0+vec2(t*0.6,t*0.35))*vnoise(cp*3.1-vec2(t*0.45,t*0.6));
  ca=pow(ca,2.6);
  float caustic=ca*uCaustic*(0.5+0.4*fres);
  vec3 col=mix(refr,refl,clamp(fres*1.1,0.0,1.0));
  col+=ENV_PEARL*caustic*0.5;
  col+=rf.y*0.5;
  col+=ENV_SUN*caustic*0.22;

  // 泡沫线（波前峰脊）
  float foam=smoothstep(0.07,0.14,abs(h));
  col=mix(col,ENV_PEARL,clamp(foam*0.22,0.0,0.3));

  // 距离雾
  float dist=length(uCamPos-vWorldPos);
  float fg=1.0-exp(-pow(dist*0.018,1.8));
  col=mix(col,ENV_FOG*0.96,fg*0.5);
  gl_FragColor=vec4(col,1.0);
}`;
}

/** 水面顶点：位移 + 传入世界坐标 */
export function waterSurfaceVert(maxRipples: number): string {
  return /* glsl */ `
${CHUNK_COMMON}
#define MAXR ${maxRipples}
uniform float uTime;
uniform vec4 uRipA[MAXR];
uniform vec4 uRipB[MAXR];
uniform float uGather;
varying vec3 vWorldPos;
varying vec2 vUv;
void main(){
  vec3 pos=position;
  vec2 p=(modelMatrix*vec4(pos,1.0)).xz; // 世界 XZ（水面跟随相机时涟漪仍固定于绝对位置）
  float h=0.0;
  for(int i=0;i<MAXR;i++){
    float t0=uRipA[i].z; if(t0<=0.0) continue;
    float age=uTime-t0; if(age<0.0) continue;
    if(age>uRipB[i].z) continue;
    vec2 ctr=uRipA[i].xy;
    float dist=length(p-ctr);
    float sp=uRipB[i].y,wl=uRipB[i].x,wid=uRipB[i].w,amp=uRipA[i].w;
    float front=sp*age;
    float ring=exp(-sq((dist-front)/wid));
    float tail=exp(-pow(max(0.0,front-dist)/(wl*2.2),2.0));
    float phase=(dist-front)/wl*TAU;
    float w=amp*(ring*0.85+tail*0.5*cos(phase)*exp(-max(0.0,front-dist)*0.15));
    h+=w*exp(-age*0.35)*exp(-dist*0.035);
  }
  h*= (1.0-uGather*0.7);
  pos.y+=h;
  vWorldPos=(modelMatrix*vec4(pos,1.0)).xyz;
  vUv=uv;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
}`;
}

// ============================================================
// 玻璃花瓣（GPU 实例化，一帧一次 draw call）：
//  - 绽放度 bloom 在顶点着色器内由 spring(uTime - t0) 解析计算；
//  - 含卷曲舒展、层间错峰、弹性余振、风颤、收拢、隐藏（scale→0）；
//  - 薄透边缘/叶脉/虹彩/露珠/透光全部程序化。
// ============================================================
export const PETAL_VERT = /* glsl */ `
${CHUNK_COMMON}
uniform float uTime;
uniform float uGather;
uniform float uWind;
uniform float uMicro; // 微观段：花体放大感由 JS 相机完成，这里只加强露珠与透光
attribute vec4 iData1;  // t0, scale, rotY, seed
attribute vec4 iData2;  // petalIdx, petals, layerIdx, layerCount
attribute vec3 iColA;   // 根色
attribute vec3 iColB;   // 尖色
attribute vec3 iEdge;   // 边缘/虹彩基色
attribute vec4 iPos4; // pos.xyz, delay
attribute vec4 iParams; // tiltX, kind(0水1空2峡谷), (预留), openDur
varying vec3 vN; varying vec3 vWorld; varying vec2 vUv;
varying vec3 vColA; varying vec3 vColB; varying vec3 vEdge;
varying float vOpen; varying float vSeed; varying float vKind; varying float vHide;

// 花瓣曲面：uv.x→u∈[-1,1] 宽向，uv.y→v∈[0,1] 根到尖。含苞卷成筒，盛开平展成宽瓣。
vec3 petalSurface(vec2 uv,float open,float seed,float layer){
  float v=uv.y, u=uv.x*2.0-1.0;
  open=clamp(open,0.0,1.0);
  // 宽度轮廓：根部窄、中部宽、尖端圆收
  float w=(0.30+0.70*sin(pow(v,0.78)*PI*0.60))*(1.0-0.30*pow(v,5.0));
  // 横向：卷筒(含苞) → 平扇(盛开)
  float wrap=mix(2.3,0.30,open);
  float ang=u*w*wrap;
  float rad=w/max(wrap,0.02)*0.5;
  float xr=sin(ang)*rad;
  float zr=(1.0-cos(ang))*rad*0.55;
  float xf=u*w*0.55;
  float zf=(0.12+0.30*open)*(u*u)*w; // 盛开兜成浅勺，内凹朝心
  float x=mix(xr,xf,open);
  float z=mix(zr,zf,open);
  // 纵向：沿 +Y 伸展，轻微反弓，尖端自然外翻下垂
  float y=v*(0.95+0.10*sin(seed*5.0));
  y+=sin(v*PI*0.5)*0.10*(1.0-open);
  y-=pow(v,3.0)*0.22*open;                 // 尖端下垂
  // 薄边翻卷 + 微褶
  x+=sign(u)*pow(abs(u)*w,3.0)*0.10*open;
  z+=sin(v*8.0+seed*9.0)*0.018*abs(u)*w*open;
  // 含苞：收成圆润水滴（中部鼓、顶部收尖、压短），避免高尖圆锥
  float pinch=1.0-0.82*pow(v,3.0)*(1.0-open);
  float bulge=0.72+0.40*sin(v*PI)*(1.0-open);
  x*=pinch*bulge; z*=pinch*bulge;
  y*=mix(0.70,1.0,open);
  return vec3(x,y,z);
}

float springG(float x,float f,float d){
  if(x<=0.0) return 0.0;
  return 1.0-exp(-d*x)*cos(TAU*f*x);
}

void main(){
  float t0=iData1.x, scale=iData1.y, rotY0=iData1.z, seed=iData1.w;
  float openDur=max(iParams.w,0.4);
  // 绽放（解析）：含弹性过冲与余振
  float raw=max(uTime-t0,0.0)/openDur;
  float open=clamp(springG(raw,2.0,4.2),0.0,1.25);
  // 层间错峰：外层先展、内层稍迟
  float layerT=iData2.z/max(iData2.w,1.0);
  open*=smoothstep(0.0,0.35,raw)*mix(1.0,0.86,layerT);
  open=clamp(open,0.0,1.2);
  // 未生长（t<t0）时完全隐藏
  float born=step(0.0,uTime-t0)*smoothstep(0.0,0.12,raw);
  // 收拢：按每花 delay 错峰卷合缩小直至消失（与开场全闭合态等价）
  float gd=clamp((uGather*(1.0+iParams.x*0.0)-iPos4.w*0.45-layerT*0.12)/0.42,0.0,1.0);
  float g=gd*gd*(3.0-2.0*gd);
  open=mix(open,0.02,g);
  float shrink=mix(1.0,0.0,g)*born;
  vKind=iParams.y;

  // 风颤（盛开后振幅渐入；含弹性尾振）
  float sway=sin(uTime*1.25+seed*8.1)*0.55+sin(uTime*2.7+seed*3.3)*0.45;
  float trem=sin(uTime*9.0+seed*20.0)*0.022*exp(-raw*2.6);
  open=clamp(open+trem*(1.0-g),0.0,1.3);

  vec2 uva=vec2(uv.x,uv.y);
  vec3 P=petalSurface(uva,open,seed,layerT);

  // 排布到花冠：花瓣沿 +Y 生长，先按 tilt 从直立放平到外展，再绕 Y 均分
  float petals=max(floor(iData2.y),1.0);
  float angY=(floor(iData2.x)/petals)*TAU+layerT*(TAU/petals)*0.5+seed*0.3+rotY0;
  // 外层平展外翻、内层直立聚拢 → 杯状花冠
  float tilt=mix(1.18,0.30,layerT);
  float s2=scale*shrink;
  mat3 rotX=mat3(1.0,0.0,0.0,0.0,cos(tilt),-sin(tilt),0.0,sin(tilt),cos(tilt));
  mat3 rotY=mat3(cos(angY),0.0,-sin(angY),0.0,1.0,0.0,sin(angY),0.0,cos(angY));
  vec3 local=rotY*rotX*P*s2;
  local.y+=mix(0.10,0.02,layerT)*scale*shrink; // 内层略高，形成花心隆起
  // 整花倾角
  float tx=iParams.x;
  mat3 tilt2=mat3(1.0,0.0,0.0,0.0,cos(tx),-sin(tx),0.0,sin(tx),cos(tx));
  local=tilt2*local;
  // 浮花缓慢漂移（整周期 → 120s 闭环）
  vec3 base=iPos4.xyz;
  if(iParams.y>0.5&&iParams.y<1.5){
    float ph=seed*TAU;
    float w2=TAU/120.0;
    base+=vec3(sin(uTime*w2*4.0+ph)*0.5,cos(uTime*w2*3.0+ph*1.7)*0.35,sin(uTime*w2*5.0+ph*2.3)*0.5)*(1.0-uGather);
  }
  // 风摆（花顶摆动）
  local.x+=sway*0.05*uWind*open*s2;
  local.z+=cos(uTime*0.9+seed*5.0)*0.03*uWind*open*s2;
  vec3 world=base+local;

  // 近似法线（曲面偏导），退化时回退避免 NaN
  float e=0.02;
  vec3 dU=petalSurface(uva+vec2(e,0.0),open,seed,layerT)-petalSurface(uva-vec2(e,0.0),open,seed,layerT);
  vec3 dV=petalSurface(uva+vec2(0.0,e),open,seed,layerT)-petalSurface(uva-vec2(0.0,e),open,seed,layerT);
  vec3 nn=cross(dU,dV);
  float nl=length(nn);
  vN=normalize(rotY*rotX*(nl>1e-5?nn/max(nl,1e-5):vec3(0.0,1.0,0.0)));
  vWorld=world; vUv=uva;
  vColA=iColA; vColB=iColB; vEdge=iEdge;
  vOpen=open; vSeed=seed;
  // 未出生/收拢：投影位置塌缩到基座点 + 片元 discard（双保险，杜绝黑块）
  vHide = shrink<0.004 ? 1.0 : 0.0;
  vec3 cullP = shrink<0.004 ? base : world;
  gl_Position=projectionMatrix*viewMatrix*vec4(cullP,1.0);
}`;

export const PETAL_FRAG = /* glsl */ `
${CHUNK_COMMON}
${CHUNK_FRESNEL}
uniform vec3 uCamPos; uniform float uTime; uniform float uGather; uniform float uMicro;
varying vec3 vN; varying vec3 vWorld; varying vec2 vUv;
varying vec3 vColA; varying vec3 vColB; varying vec3 vEdge;
varying float vOpen; varying float vSeed; varying float vKind; varying float vHide;
void main(){
  if(vHide>0.5) discard;
  float u=vUv.x*2.0-1.0;
  float v=vUv.y; // 0根 1尖
  vec3 N=normalize(vN+vec3(0.0,1e-4,0.0));
  if(dot(N,N)<0.5) discard;
  vec3 V=normalize(uCamPos-vWorld);
  if(!gl_FrontFacing) N=-N;
  // 叶脉（主脉+侧脉+细网）
  float midvein=smoothstep(0.05,0.0,abs(u))*(0.5+0.5*v);
  float side=pow(abs(sin(u*PI*5.0+v*2.0+fract(vSeed)*3.0)),9.0)*smoothstep(0.08,0.75,v);
  float net=pow(fbm(vec2(u*4.0+v*2.0,v*7.0)),3.0)*0.4*smoothstep(0.2,0.9,v);
  float veins=(midvein*0.7+side*0.45+net*0.5);
  // 根浅尖深渐变 + 霜感
  vec3 col=mix(vColA,vColB,pow(v,1.25));
  col+=ENV_PEARL*(1.0-v)*0.06;
  col*=1.0-veins*0.28;
  // 次表面透光
  vec3 L=normalize(vec3(0.45,0.8,0.4));
  float sss=pow(clamp(dot(V,-L+N*0.3),0.0,1.0),2.0)*smoothstep(0.25,1.0,v);
  col+=mix(vColB,vEdge,0.5)*sss*0.55;
  // 菲涅薄透边缘 + 虹彩
  float fres=fresnel(N,V,0.05);
  vec3 iridCol=0.5+0.5*cos(TAU*(fres*vec3(0.9,0.75,0.6)+vec3(0.10,0.45,0.75))+v*2.0+uTime*0.5+vSeed);
  col=mix(col,col*0.62+iridCol*0.42,smoothstep(0.4,1.0,fres)*0.62);
  // 露珠（微观段变多变亮）
  float dew=0.0;
  vec2 dp=u*7.0+vec2(v*9.0,vSeed*10.0);
  float cell=hash21(floor(dp));
  if(cell>0.80){
    vec2 lp=fract(dp)-0.5;
    float d=1.0-smoothstep(0.0,0.20,length(lp));
    vec3 Ln=normalize(reflect(-V,N)+vec3(0.0,0.4,0.0));
    dew=pow(max(dot(N,Ln),0.0),110.0)*d*(1.5+uMicro*2.2);
    col+=ENV_PEARL*dew+ENV_LAKE*dew*0.15;
  }
  // 柔光漫反射
  float diff=0.55+0.45*max(dot(N,L),0.0);
  col*=mix(0.72,1.12,diff);
  col+=skyColor(reflect(-V,N))*fres*0.30;
  // 收拢提亮（花瓣化为光回聚）
  col=mix(col,col*1.5+vEdge*0.8,uGather*0.7);
  // 距离雾
  float dist=length(uCamPos-vWorld);
  float fg=1.0-exp(-pow(dist*0.011,1.7));
  col=mix(col,ENV_FOG,fg*0.32);
  float alpha=clamp(0.58+fres*0.42+sss*0.5+veins*0.15+dew*0.4,0.0,1.0);
  gl_FragColor=vec4(col,alpha);
}`;

// ============================================================
// 丝绸彩带（ribbon）：沿样条流动 + 翻卷扭转 + 虹彩 + 透光
// ============================================================
export const RIBBON_VERT = /* glsl */ `
${CHUNK_COMMON}
uniform float uTime; uniform float uGrow; uniform float uGather; uniform float uTwist;
varying vec3 vN; varying vec3 vWorld; varying vec2 vUv;
void main(){
  vec3 P=position;
  float s=uv.x;
  // 收拢：向起点回卷收缩
  P*=(1.0-uGather*s*0.6);
  // 翻卷波动
  float w=sin(s*TAU*3.0-uTime*2.2+uTwist)*0.12*(1.0-uGather);
  P.y+=w*abs(uv.y-0.5)*2.0;
  vec4 wp=modelMatrix*vec4(P,1.0);
  vWorld=wp.xyz;
  vN=normalize(mat3(modelMatrix)*normal);
  vUv=uv;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;
export const RIBBON_FRAG = /* glsl */ `
${CHUNK_COMMON}
${CHUNK_FRESNEL}
uniform vec3 uColA; uniform vec3 uColB; uniform float uTime; uniform vec3 uCamPos; uniform float uSeed;
varying vec3 vN; varying vec3 vWorld; varying vec2 vUv;
void main(){
  vec3 N=normalize(vN); vec3 V=normalize(uCamPos-vWorld); if(!gl_FrontFacing) N=-N;
  float shimmer=0.5+0.5*sin(vUv.x*40.0-uTime*3.0+vUv.y*6.0+uSeed);
  vec3 col=mix(uColA,uColB,vUv.y*0.5+0.5)*0.86;
  col*=0.85+0.3*shimmer;
  float fres=fresnel(N,V,0.06);
  vec3 iridPhase=vec3(vUv.x*10.0+uTime*0.5+uSeed)+vec3(0.0,2.1,4.2);
  vec3 iridCol=0.5+0.5*cos(iridPhase*vec3(0.85,0.7,0.6));
  col=mix(col,iridCol*0.5+col*0.7,smoothstep(0.25,0.9,fres)*0.7);
  vec3 L=normalize(vec3(0.4,0.8,0.35));
  float diff=0.5+0.5*max(dot(N,L),0.0);
  col*=mix(0.75,1.1,diff);
  float alpha=clamp(0.26+fres*0.5+shimmer*0.16,0.0,0.9);
  gl_FragColor=vec4(col,alpha);
}`;

// ============================================================
// 玻璃晶体：折射天穹 + 虹彩边 + 内发光
// ============================================================
export const CRYSTAL_VERT = /* glsl */ `
${CHUNK_COMMON}
uniform float uTime; uniform float uGrow; varying vec3 vN; varying vec3 vWorld; varying vec3 vCol;
attribute vec3 aCol;
void main(){
  vec3 P=position*smoothstep(0.0,1.0,uGrow);
#ifdef USE_INSTANCING
  vec4 wp=modelMatrix*instanceMatrix*vec4(P,1.0);
  vN=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
#else
  vec4 wp=modelMatrix*vec4(P,1.0);
  vN=normalize(mat3(modelMatrix)*normal);
#endif
  vWorld=wp.xyz; vCol=aCol;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;
export const CRYSTAL_FRAG = /* glsl */ `
${CHUNK_COMMON}
${CHUNK_FRESNEL}
uniform float uTime; uniform vec3 uCamPos; uniform float uGlow;
varying vec3 vN; varying vec3 vWorld; varying vec3 vCol;
void main(){
  vec3 N=normalize(vN); vec3 V=normalize(uCamPos-vWorld);
  float fres=fresnel(N,V,0.04);
  vec3 R=reflect(-V,N);
  vec3 refr=skyColor(refract(-V,N,0.82));
  vec3 refl=skyColor(normalize(R));
  vec3 col=mix(refr,refl,clamp(fres*1.2,0.0,1.0));
  col=mix(col,vCol,0.42);
  vec3 iridCol=0.5+0.5*cos((fres*10.0+uTime*0.4)*vec3(0.85,0.7,0.6)+vec3(0.0,2.1,4.2));
  col+=iridCol*0.16*smoothstep(0.2,0.9,fres);
  col+=vCol*uGlow;
  col+=ENV_SUN*pow(max(dot(R,normalize(vec3(0.4,0.7,0.3))),0.0),120.0)*1.2;
  gl_FragColor=vec4(col,clamp(0.55+fres*0.45,0.0,1.0));
}`;

// ============================================================
// 粒子（花粉/光丝/雾/飞沫）：instanced 点 + shader 运动
// ============================================================
export const PARTICLE_VERT = /* glsl */ `
${CHUNK_COMMON}
uniform float uTime; uniform float uGather; uniform float uSize; uniform vec2 uRes;
attribute vec3 aOffset; attribute vec4 aRand; attribute vec3 aColor;
varying vec3 vColor; varying float vAlpha;
void main(){
  vec3 P=aOffset;
  float seed=aRand.x;
  // 漂浮运动
  P.x+=sin(uTime*aRand.y+seed*20.0)*aRand.z*1.5;
  P.y+=cos(uTime*aRand.w+seed*13.0)*aRand.z*1.2 + mod(uTime*0.15+seed,1.0)*0.3;
  P.z+=cos(uTime*aRand.y*0.8+seed*7.0)*aRand.z*1.5;
  // 收拢：向原点汇聚成一滴
  vec3 toC=normalize(-P+vec3(0.0,1.4,0.0));
  float g=smoothstep(0.0,1.0,uGather);
  P=mix(P, vec3(0.0,1.62,0.0), g*g);
  vec4 mv=modelViewMatrix*vec4(P,1.0);
  gl_Position=projectionMatrix*mv;
  float dist=-mv.z;
  gl_PointSize=clamp(uSize*aRand.z*20.0/max(dist,1.0)*uRes.y/900.0,1.0,5.0);
  vColor=aColor;
  vAlpha=clamp(1.0-dist*0.014,0.04,0.6)*(1.0-g*0.0);
}`;
export const PARTICLE_FRAG = /* glsl */ `
${CHUNK_COMMON}
varying vec3 vColor; varying float vAlpha;
void main(){
  vec2 c=gl_PointCoord-0.5;
  float d=length(c);
  if(d>0.5) discard;
  float a=1.0-smoothstep(0.0,0.5,d);
  a*=a;
  gl_FragColor=vec4(vColor*(0.55+a*0.8),a*vAlpha);
}`;

// ============================================================
// 全屏后期：god rays / DOF 简化 / 暗角 / 颗粒 / 色散 / ACES
// ============================================================
export const FS_QUAD = /* glsl */ `
varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0);} `;

export const COMPOSITE_FRAG = /* glsl */ `
${CHUNK_COMMON}
${CHUNK_FRESNEL}
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tDof;
uniform float uBloomAmt; uniform float uDofAmt; uniform float uTime;
uniform float uVignette; uniform float uGrain; uniform float uChroma;
uniform float uExposure; uniform vec3 uTint; uniform float uGodRay; uniform vec2 uSunScreen;
varying vec2 vUv;

vec3 radialShadow(sampler2D tex, vec2 uv, vec2 center, float rays, float intensity){
  vec2 dir=uv-center; float sum=0.0;
  for(int i=0;i<12;i++){
    float fi=float(i)/12.0;
    vec2 suv=uv-dir*fi*rays;
    vec3 s=texture2D(tex,suv).rgb;
    float lum=dot(s,vec3(0.2126,0.7152,0.0722));
    sum+=max(0.0,lum-0.75)*fi;
  }
  return vec3(sum*intensity*0.12);
}

vec3 cleanN(vec3 v){ return all(equal(v,clamp(v,-1e5,1e5))) ? v : vec3(0.0); }

void main(){
  vec2 uv=vUv;
  // 色散（边缘轻微 RGB 偏移）
  vec2 dir=uv-0.5;
  float r2=dot(dir,dir);
  vec3 col;
  float ca=uChroma*r2;
  col.r=cleanN(texture2D(tScene,uv-dir*ca).rgb).r;
  col.g=cleanN(texture2D(tScene,uv).rgb).g;
  col.b=cleanN(texture2D(tScene,uv+dir*ca).rgb).b;

  // 景深混合（tDof 为已模糊的场景）
  float focus=abs(uv.y-0.5)+length(dir)*0.3;
  float dofMask=smoothstep(0.15,0.75,focus)*uDofAmt;
  col=mix(col,texture2D(tDof,uv).rgb,dofMask);

  // 体积光/神光（从太阳屏幕位置放射，基于亮部）
  vec3 god=radialShadow(tBloom,uv,uSunScreen,0.16,uGodRay);
  col+=god*ENV_SUN;

  // Bloom 叠加（克制）
  vec3 bl=texture2D(tBloom,uv).rgb;
  col+=bl*uBloomAmt;

  // 阶段色调 + 曝光
  col*=uExposure;
  col*=mix(vec3(1.0),uTint*1.15,0.12);
  col=acesTone(col);

  // 轻微抬升暗部，保证明亮清透不压黑
  col=max(col,vec3(0.03));

  // 暗角
  float vig=1.0-uVignette*smoothstep(0.35,0.95,r2*1.6);
  col*=vig;
  // 颗粒（种子沿整周期偏移，t=0 与 t=120 同相 → 循环无缝）
  float grain=(hash21(uv*vec2(1920.0,1080.0)+vec2(sin(uTime*TAU/120.0),cos(uTime*TAU/120.0))*0.5)-0.5)*uGrain;
  col+=grain;
  gl_FragColor=vec4(col,1.0);
}`;

/** 亮部提取（bloom 前置）；clean() 用 clamp 同时捕获 NaN 与 Inf，杜绝黑块扩散 */
export const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tDiffuse; uniform float uThreshold; uniform float uSoft;
varying vec2 vUv;
vec3 clean(vec3 v){ return all(equal(v,clamp(v,-1e5,1e5))) ? v : vec3(0.0); }
void main(){
  vec3 c=clean(texture2D(tDiffuse,vUv).rgb);
  float l=dot(c,vec3(0.2126,0.7152,0.0722));
  float k=smoothstep(uThreshold,uThreshold+uSoft,l);
  gl_FragColor=vec4(c*k,1.0);
}`;

/** 可分离高斯（bloom / dof 复用） */
export const GAUSS_FRAG = /* glsl */ `
uniform sampler2D tDiffuse; uniform vec2 uDir; uniform float uRadius;
varying vec2 vUv;
void main(){
  vec3 sum=texture2D(tDiffuse,vUv).rgb*0.227027;
  vec2 o1=uDir*uRadius*0.1383716;
  vec2 o2=uDir*uRadius*0.247359;
  vec2 o3=uDir*uRadius*0.31549;
  sum+=texture2D(tDiffuse,vUv+o1).rgb*0.316227;
  sum+=texture2D(tDiffuse,vUv-o1).rgb*0.316227;
  sum+=texture2D(tDiffuse,vUv+o2).rgb*0.07027;
  sum+=texture2D(tDiffuse,vUv-o2).rgb*0.07027;
  sum+=texture2D(tDiffuse,vUv+o3).rgb*0.136363;
  sum+=texture2D(tDiffuse,vUv-o3).rgb*0.136363;
  gl_FragColor=vec4(sum,1.0);
}`;
