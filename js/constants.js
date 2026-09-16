export const CHANNELS = [
  {key:'D1',   label:'D1',            color:'#e9e9e9', kind:'surface'},
  {key:'D2',   label:'D2',            color:'#e9e9e9', kind:'surface'},
  {key:'V1',   label:'V1',            color:'#e9e9e9', kind:'surface'},
  {key:'AblD', label:'Abl distal',    color:'#ffb020', kind:'ablation'},
  {key:'AblP', label:'Abl proximal',  color:'#ffb020', kind:'ablation'},
  {key:'HRA',  label:'AD alta',       color:'#c9a0ff', kind:'hra'},
  {key:'CS12', label:'CS 1-2 (dist.)',color:'#35c9f0', kind:'cs', csIdx:4},
  {key:'CS34', label:'CS 3-4',        color:'#35c9f0', kind:'cs', csIdx:3},
  {key:'CS56', label:'CS 5-6',        color:'#35c9f0', kind:'cs', csIdx:2},
  {key:'CS78', label:'CS 7-8',        color:'#35c9f0', kind:'cs', csIdx:1},
  {key:'CS910',label:'CS 9-10 (prox.)',color:'#35c9f0',kind:'cs', csIdx:0},
  {key:'VD',   label:'VD',            color:'#ff4d6d', kind:'vd'},
];
export const ROW_H = 48, TOP_PAD = 34, LOCAL_ERP = 150, PX_PER_MM = 10;

export function mmsToPxPerMs(mms){ return mms * PX_PER_MM / 1000; }

// Derivaciones estándar: morfología normal (conducción angosta) + cómo cambia el eje cuando el
// latido viene de estimulación ventricular (b.origin==='V'), según el sitio de pacing en VD.
export const LEADS12 = [
  {name:'DI',   type:'up'},
  {name:'DII',  type:'qR'},
  {name:'DIII', type:'rs'},
  {name:'aVR',  type:'QS'},
  {name:'aVL',  type:'rs'},
  {name:'aVF',  type:'qR'},
  {name:'V1',   type:'rS'},
  {name:'V2',   type:'rS'},
  {name:'V3',   type:'RS'},
  {name:'V4',   type:'Rs'},
  {name:'V5',   type:'qR'},
  {name:'V6',   type:'qR'},
];

// Secuencia de activación retrógrada por localización de la vía accesoria: offset (ms) del CS distal
// y proximal (se interpola entre ambos según el bipolo), de la AD alta y del catéter de ablación —
// 0 = el sitio que se activa primero.
export const PATHWAY_CONFIGS = {
  leftLateral:     { baseVA:20, csDistalOff:0,  csProxOff:40, ablOff:55, hraOff:70, deltaSign:1 },
  leftPosterior:   { baseVA:20, csCenter:2, csStep:10, ablOff:35, hraOff:50, deltaSign:-1 },
  rightPostSeptal: { baseVA:30, csProxOff:0, csDistalOff:60, ablOff:30, hraOff:80, deltaSign:-1 },
  rightLateral:    { baseVA:30, hraOff:0, ablOff:20, csProxOff:40, csDistalOff:100, deltaSign:1 },
  parahisian:      { baseVA:30, ablOff:0, csProxOff:15, csDistalOff:63, hraOff:27, deltaSign:1 },
};
// Polaridad de la onda delta por derivación, según los criterios de localización de vías accesorias
// (delta positiva/negativa/isoeléctrica en cada derivación). La vía lateral izquierda está tomada
// de la literatura (delta positiva en precordiales anteriores, II/III/aVF; positiva o isoeléctrica
// en I/aVL; isoeléctrica o negativa en V5/V6); las demás son aproximaciones razonables del mismo estilo.
export const DELTA_LEAD_SIGNS = {
  leftLateral:     {DI:-1, DII:1, DIII:1, aVR:-1, aVL:-1, aVF:1, V1:1, V2:1, V3:1, V4:1, V5:1, V6:1},
  leftPosterior:   {DI:1, DII:-1, DIII:-1, aVR:1, aVL:1, aVF:-1, V1:1, V2:1, V3:1, V4:1, V5:1, V6:1},
  rightPostSeptal: {DI:1, DII:1, DIII:-1, aVR:1, aVL:1, aVF:-1, V1:-1, V2:1, V3:1, V4:1, V5:1, V6:1},
  rightLateral:    {DI:1, DII:1, DIII:-1, aVR:-1, aVL:1, aVF:1, V1:'none', V2:'none', V3:'none', V4:0.4, V5:1, V6:1},
  parahisian:      {DI:1, DII:1, DIII:1, aVR:-1, aVL:1, aVF:1, V1:-1, V2:0.3, V3:0.5, V4:0.7, V5:0.85, V6:1},
};
// Tiempos locales (A a V) por catéter, específicos de la vía parahisiana en ritmo sinusal: el
// catéter de ablación (muy cerca de la vía) muestra un AH/HV locales muy cortos; la AD alta y el
// CS 9-10 (más lejos) un AV combinado de 100 ms; el resto del CS se va estirando de a 20 ms.
export const PARAHISIAN_SINUS_TIMING = {
  AblD: {ah:10, hv:5},
  AblP: {ah:30, hv:10},
};
export const PARAHISIAN_CS_AV = {0:80, 1:110, 2:120, 3:130, 4:140}; // csIdx: CS9-10(0)=80, CS7-8(1)=110, CS5-6(2)=120, CS3-4(3)=130, CS1-2(4)=140
export const PARAHISIAN_HRA_AV = 80;
// Vía posterior izquierda en ritmo sinusal: el AV más corto es el CS 5-6 (centro), se estira de a
// 10 ms en forma simétrica hacia el CS distal y proximal, luego la ablación, y por último la AD alta.
export const LEFTPOST_CS_CENTER = 2, LEFTPOST_CS_STEP = 10, LEFTPOST_CS_BASE_AV = 20;
export const LEFTPOST_ABL_AV = 55, LEFTPOST_HRA_AV = 70;
// Vía postero septal derecha en ritmo sinusal: CS 9-10 con AV=10 ms, degradé de 10 ms por paso hacia
// el resto del CS (más lejos = más tarde), y la ablación con el mismo AV que el CS 7-8.
export const RIGHTPOSTSEPT_CS_AV = {0:10, 1:30, 2:50, 3:70, 4:90}; // csIdx: CS9-10(0)=10 ... CS1-2(4)=90, paso de 20 ms
export const RIGHTPOSTSEPT_ABL_AV = RIGHTPOSTSEPT_CS_AV[1]; // = CS 7-8
// Vía lateral derecha en ritmo sinusal: ablación con AV=100 ms, y el CS (de proximal a distal) se
// va estirando desde 120 ms, de a 20 ms por paso.
export const RIGHTLATERAL_ABL_AV = 100;
export const RIGHTLATERAL_CS_AV = {0:120, 1:130, 2:140, 3:150, 4:160}; // csIdx: CS9-10(0)=120 ... CS1-2(4)=160, paso de 10 ms
export function leftPostCsAV(csIdx){ return LEFTPOST_CS_BASE_AV + LEFTPOST_CS_STEP*Math.abs(csIdx-LEFTPOST_CS_CENTER); }
// Morfología especial de la segunda mitad (normalizada) del complejo preexcitado, para derivaciones
// puntuales que necesitan un patrón particular (por ahora, 'Rs': R alta + s chica).
export const DELTA_MORPHOLOGY = {
  rightPostSeptal: {DII:'Rs'},
};
// Secuencia auricular genérica: demora aproximada por cada "paso" de distancia entre catéteres.
export const ATRIAL_STEP_MS = 12;
