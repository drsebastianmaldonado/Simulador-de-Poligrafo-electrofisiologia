import { state } from './state.js';
import { LOCAL_ERP, PATHWAY_CONFIGS } from './constants.js';

export function computeAH(CI){
  const CTX = state.CTX;
  if (CI <= CTX.ERP) return null;
  const margin = 15, k = 1800;
  let value;
  if (CI >= CTX.wenckAnt){
    // Decremento progresivo y ya notorio a medida que la FC de estimulación aumenta, antes de llegar al Wenckebach
    const span = Math.max(1, CTX.sinusCL - CTX.wenckAnt);
    const frac = Math.min(1, Math.max(0, (CTX.sinusCL - CI) / span));
    value = CTX.AH0 + frac*30;
  } else {
    // Por debajo del punto de Wenckebach, el AH se prolonga en forma marcada a medida que se acerca al PRE
    const dec = k/(CI-CTX.ERP+margin) - k/(CTX.wenckAnt-CTX.ERP+margin);
    value = Math.max(CTX.AH0+30, (CTX.AH0+30) + dec);
  }
  // Salto de vía (doble vía nodal): al llegar al S2 configurado, la vía rápida se bloquea y la
  // conducción pasa a la vía lenta — un salto brusco de AH (>50 ms), no una prolongación gradual.
  if (CTX.jumpEnabled && CI <= CTX.jumpCL && state.MODEL_TACHY_TYPE!=='AVRT'){
    value += 70;
  }
  return value;
}
export function computeVA(CI){
  const CTX = state.CTX;
  if (CI <= CTX.VERP) return null;
  const margin = 15, k = 1800;
  let value;
  if (CI >= CTX.wenckRetro){
    const span = Math.max(1, CTX.sinusCL - CTX.wenckRetro);
    const frac = Math.min(1, Math.max(0, (CTX.sinusCL - CI) / span));
    value = CTX.VA0 + frac*30;
  } else {
    const dec = k/(CI-CTX.VERP+margin) - k/(CTX.wenckRetro-CTX.VERP+margin);
    value = Math.max(CTX.VA0+30, (CTX.VA0+30) + dec);
  }
  // Salto de vía retrógrado (doble vía nodal en sentido V-A): al llegar al V2 configurado, la vía
  // rápida retrógrada se bloquea y la conducción retrógrada pasa a la vía lenta — salto brusco de VA.
  if (CTX.jumpRetroEnabled && CI <= CTX.jumpRetroCL){
    value += 70;
  }
  return value;
}

// Periodicidad de Wenckebach: devuelve N (conducción N:N-1) o null si no aplica (1:1 o bloqueo fijo)
export function wenckPeriod(cl, erp, wenckPoint){
  if (!(wenckPoint > erp)) return null;
  if (cl >= wenckPoint) return null;
  if (cl <= erp) return null;
  const ratio = (wenckPoint - cl) / (wenckPoint - erp);
  let N = Math.round(8 - ratio*6);
  return Math.min(8, Math.max(2, N));
}
export function makeAtrialBeatWithAH(refTime, CI, label, ah){
  const CTX = state.CTX;
  const beat = {origin:'A', label, isPaced:true, isExtra:false, CI, stimTime:refTime, ta:refTime};
  beat.ah = ah; beat.th = refTime + ah; beat.tv = beat.th + CTX.hv0;
  if (CTX.jumpEnabled && CI <= CTX.jumpCL && state.MODEL_TACHY_TYPE!=='AVRT') beat.echoTa = beat.tv + 35;
  return beat;
}
export function makeAtrialBeatBlockedWenck(refTime, CI, label){
  return {origin:'A', label, isPaced:true, isExtra:false, CI, stimTime:refTime, ta:refTime, blocked:'AV'};
}
export function makeVentricularBeatWithVA(refTime, CI, label, va){
  const CTX = state.CTX;
  const beat = {origin:'V', label, isPaced:true, isExtra:false, CI, stimTime:refTime, tv:refTime};
  beat.va = va; beat.th = refTime + CTX.hv0; beat.ta = refTime + va;
  return beat;
}
export function makeVentricularBeatBlockedWenck(refTime, CI, label){
  return {origin:'V', label, isPaced:true, isExtra:false, CI, stimTime:refTime, tv:refTime, blocked:'VA'};
}

export function makeAtrialBeat(refTime, CI, isPaced, label, isExtra){
  const CTX = state.CTX;
  const beat = {origin:'A', label, isPaced, isExtra:!!isExtra, CI, stimTime: isPaced?refTime:undefined};
  if (CI < LOCAL_ERP){ beat.blocked='local'; return beat; }
  beat.ta = refTime;
  const ah = computeAH(CI);
  if (ah==null){ beat.blocked='AV'; return beat; }
  beat.ah = ah;
  beat.th = refTime + ah;
  if (state.PREEXCITATION_ENABLED && !isPaced && CI >= (+document.getElementById('pathwayAnteERP').value)){
    // Preexcitación manifiesta: la vía activa el ventrículo antes que el sistema His-Purkinje —
    // HV negativo (-10 ms) y onda delta, con polaridad según la localización de la vía.
    beat.tv = beat.th + 15;
    beat.hasDelta = true;
    beat.deltaPathway = document.getElementById('pathwayLoc').value;
  } else {
    beat.tv = beat.th + CTX.hv0;
  }
  if (CTX.jumpEnabled && CI <= CTX.jumpCL && state.MODEL_TACHY_TYPE!=='AVRT'){
    // Eco auricular: retorno retrógrado por la vía rápida tras el salto a la vía lenta,
    // cae dentro del QRS de este mismo latido (VA simultáneo), no en su borde de entrada.
    beat.echoTa = beat.tv + 35;
  }
  return beat;
}
export function makeVentricularBeat(refTime, CI, isPaced, label, isExtra){
  const CTX = state.CTX;
  const beat = {origin:'V', label, isPaced, isExtra:!!isExtra, CI, stimTime: isPaced?refTime:undefined};
  if (CI < LOCAL_ERP){ beat.blocked='local'; return beat; }
  beat.tv = refTime;
  if (CTX.site==='AblD') beat.narrow = true; // captura directa del His: QRS angosto, a diferencia de la captura miocárdica (ancha) desde VD apical/basal
  if (state.MODEL_TACHY_TYPE==='AVRT'){
    const pathwayRetroERP = +document.getElementById('pathwayRetroERP').value;
    if (CI < pathwayRetroERP){
      // La vía no llega a conducir en sentido retrógrado a este ciclo: sin retroconducción por
      // ella (puede seguir habiendo conducción V-A por el nodo AV, según el modelo general).
      const vaApex = computeVA(CI);
      const vaNode = (vaApex==null) ? null : vaApex + (CTX.site==='VDbasal' ? 40 : 0);
      if (vaNode==null){ beat.blocked='VA'; return beat; }
      beat.va = vaNode;
      // Retroconducción V→H más corta que el HV anterógrado fijo: acerca la deflexión His a la
      // espiga ventricular en vez de dejarla a mitad de camino hacia la A retrógrada.
      const retroVH = (CTX.site==='VDapex' || CTX.site==='VDbasal') ? 20 : CTX.hv0;
      beat.th = refTime + retroVH;
      beat.ta = refTime + vaNode;
      return beat;
    }
    // Preexcitación manifiesta: la vía también conduce en sentido retrógrado, con la misma
    // secuencia (VA por catéter) que se ve durante la TRAV sostenida.
    const locKey = document.getElementById('pathwayLoc').value;
    const pwCfg = PATHWAY_CONFIGS[locKey] || PATHWAY_CONFIGS.leftLateral;
    const csMinOff = (pwCfg.csCenter != null) ? 0 : Math.min(pwCfg.csDistalOff, pwCfg.csProxOff);
    const earliestOff = Math.min(csMinOff, pwCfg.hraOff, pwCfg.ablOff);
    const va = (pwCfg.baseVA ?? 20) + earliestOff;
    beat.va = va;
    beat.th = refTime + CTX.hv0;
    beat.ta = refTime + va;
    beat.echoTa = refTime + va;
    beat.ablationP = refTime + va + pwCfg.ablOff;
    beat.pathway = locKey;
    beat.hiddenOnSurface = true; // la P retrógrada no se ve en el ECG de superficie, solo en los catéteres
    return beat;
  }
  const vaApex = computeVA(CI);
  const va = (vaApex==null) ? null : vaApex + (CTX.site==='VDbasal' ? 40 : 0);
  if (va==null){ beat.blocked='VA'; return beat; }
  beat.va = va;
  // Retroconducción V→H más corta que el HV anterógrado fijo: acerca la deflexión His a la
  // espiga ventricular en vez de dejarla a mitad de camino hacia la A retrógrada.
  const retroVH = (CTX.site==='VDapex' || CTX.site==='VDbasal') ? 20 : CTX.hv0;
  beat.th = refTime + retroVH;
  beat.ta = refTime + va;
  return beat;
}
export function buildSinusOnlyBeats(upToMs){
  const beats = [];
  let t = 0;
  while (t < upToMs){ beats.push(makeAtrialBeat(t, state.CTX.sinusCL, false, 'Sinus')); t += state.CTX.sinusCL; }
  return beats;
}
export function makeSustainedTachyBeat(th, type, label){
  // Un latido de la taquicardia sostenida (TRNAV o TRAV), reutilizando la misma secuencia de la
  // vía que en buildTachyBeats — usado como bloque común por varias maniobras.
  const CTX = state.CTX;
  const tv = th + CTX.hv0;
  const beat = {origin:'A', label, isPaced:false, isExtra:false, ah:th, th, tv};
  if (type==='AVRT'){
    const locKey = document.getElementById('pathwayLoc').value;
    const pwCfg = PATHWAY_CONFIGS[locKey] || PATHWAY_CONFIGS.leftLateral;
    const csMinOff = (pwCfg.csCenter != null) ? 0 : Math.min(pwCfg.csDistalOff, pwCfg.csProxOff);
    const earliestOff = Math.min(csMinOff, pwCfg.hraOff, pwCfg.ablOff);
    const va = (pwCfg.baseVA ?? 20) + earliestOff;
    beat.echoTa = tv + va;
    beat.surfaceP = tv + 115;
    beat.ablationP = tv + va + pwCfg.ablOff;
    beat.echoVisible = true;
    beat.pathway = locKey;
  } else {
    beat.echoTa = tv + 35;
  }
  return beat;
}
