import { state } from './state.js';
import { DELTA_LEAD_SIGNS, DELTA_MORPHOLOGY, ATRIAL_STEP_MS } from './constants.js';

export function deltaSignForLead(pathway, leadKey){
  const map = DELTA_LEAD_SIGNS[pathway];
  if (!map) return 1;
  const key = (leadKey==='D1') ? 'DI' : (leadKey==='D2') ? 'DII' : leadKey;
  const v = map[key];
  return (v==null) ? 1 : v;
}
export function qrsAmplitudeScale(leadKey){
  // Progresión normal de precordiales: V1 de menor amplitud que V2-V6 (que crecen y se mantienen altas).
  const key = (leadKey==='D1') ? 'DI' : (leadKey==='D2') ? 'DII' : leadKey;
  if (key==='V1') return 0.6;
  return 1;
}
export function deltaMorphologyForLead(pathway, leadKey){
  const map = DELTA_MORPHOLOGY[pathway];
  if (!map) return null;
  const key = (leadKey==='D1') ? 'DI' : (leadKey==='D2') ? 'DII' : leadKey;
  return map[key] || null;
}
// Secuencia auricular genérica: dónde arranca la activación real según el sitio de estimulación
// (o la AD alta, si es ritmo sinusal — origen natural en el nodo sinusal), y desde ahí se ordena
// el resto de los catéteres por lejanía real a ese punto.
export function atrialChannelPos(kind, csIdx, retrograde){
  if (retrograde){
    // Conducción retrógrada (estimulando desde ventrículo): arranca cerca del nodo AV/septo
    // (CS9-10) y la AD alta, al ser la más lejana, es la última en activarse — más tardía
    // incluso que el CS distal.
    if (kind==='hra') return 5;
    if (kind==='cs') return csIdx; // CS9-10 (csIdx=0, cerca del septo)=0 ... CS1-2 (csIdx=4)=4
    return null;
  }
  if (kind==='hra') return 0;
  if (kind==='cs') return 1 + csIdx; // CS9-10 (prox., csIdx=0)=1 ... CS1-2 (dist., csIdx=4)=5
  return null;
}
export function pacingOriginPos(site){
  if (site==='HRA') return 0;
  if (site==='CSprox') return 1; // CS9-10
  if (site==='CSdist') return 5; // CS1-2
  return 0;
}
export function genericAtrialOffset(kind, csIdx, beat){
  const retrograde = (state.CTX.site==='VDapex' || state.CTX.site==='VDbasal' || state.CTX.site==='AblD');
  const chPos = atrialChannelPos(kind, csIdx, retrograde);
  const originPos = retrograde ? 0 : (beat.isPaced ? pacingOriginPos(state.CTX.site) : 0); // sinusal: arranca en la AD alta
  return Math.abs(chPos - originPos) * ATRIAL_STEP_MS;
}
