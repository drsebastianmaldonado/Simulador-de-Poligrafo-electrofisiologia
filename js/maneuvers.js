import { state } from './state.js';
import { PATHWAY_CONFIGS } from './constants.js';
import { makeAtrialBeat, makeSustainedTachyBeat } from './physio-model.js';
import { renderAll } from './playback.js';

export function buildHisRefractoryExtrastim(p, upToMs){
  // Extraestímulo con His refractario: los primeros 8 latidos son SENSADOS (no estimulados) —
  // reflejan la taquicardia sostenida tal cual. Después se entrega un único extraestímulo
  // ventricular (S2) desde el sitio elegido (VD apical o basal), tomando como referencia la
  // activación ventricular más precoz (el último latido sensado).
  //  - Prematurez < 20 ms: el ventrículo sigue refractario, no captura (sin efecto).
  //  TRAV: 20–40 ms fusión manifiesta (VA se acorta 20 ms cada 20 ms de prematurez); 40–60 ms QRS
  //  puro (VA propio de la vía, sigue conduciendo); > 60 ms termina.
  //  TRNAV: 20–30 ms fusión manifiesta (VA SIN cambios); 30–60 ms QRS puro (VA se acorta lo mismo
  //  que la diferencia entre el ciclo de la taquicardia y el del extraestímulo); > 60 ms termina.
  const CTX = state.CTX;
  const TCL = state.AVNRT_TCL || p.tachyCL;
  const type = state.INDUCED_TYPE || p.tachyType;
  const label = (type==='AVRT') ? 'TRAV' : 'TRNAV';
  const isVD = (p.site==='VDapex' || p.site==='VDbasal');
  const s2 = +document.getElementById('hisRefrS2').value;
  const beats = [];
  let th = 0;
  for (let i=0; i<8; i++){ beats.push(makeSustainedTachyBeat(th, type, label)); th += TCL; }

  if (!isVD){
    while (th < upToMs){ beats.push(makeSustainedTachyBeat(th, type, label)); th += TCL; }
    return {beats, ready:false};
  }

  const lastVTime = (th - TCL) + CTX.hv0; // activación ventricular más precoz (última sensada)
  const stimTime = lastVTime + s2;
  const prematurity = TCL - s2;
  const baseVA = Math.max(30, TCL - CTX.hv0);
  const fusionUpper = (type==='AVRT') ? 40 : 30;
  let vpbBeat, terminated = false, continues = false;

  if (prematurity < 20){
    vpbBeat = {origin:'V', label:'VPB', isPaced:true, isExtra:true, CI:s2, stimTime, blocked:'refr'};
  } else if (prematurity <= fusionUpper){
    const va = (type==='AVRT') ? Math.max(10, baseVA - prematurity) : baseVA; // TRNAV: VA sin cambios
    vpbBeat = {origin:'V', label:'VPB', isPaced:true, isExtra:true, CI:s2, tv:stimTime, stimTime, fusionQRS:true, echoTa: stimTime + va};
    continues = true;
  } else if (prematurity <= 60){
    let va;
    if (type==='AVRT'){
      const locKey = document.getElementById('pathwayLoc').value;
      const pwCfg = PATHWAY_CONFIGS[locKey] || PATHWAY_CONFIGS.leftLateral;
      const csMinOff = (pwCfg.csCenter != null) ? 0 : Math.min(pwCfg.csDistalOff, pwCfg.csProxOff);
      va = (pwCfg.baseVA ?? 20) + Math.min(csMinOff, pwCfg.hraOff, pwCfg.ablOff);
    } else {
      va = Math.max(10, baseVA - prematurity); // TRNAV: se acorta lo mismo que TCL-S2
    }
    vpbBeat = {origin:'V', label:'VPB', isPaced:true, isExtra:true, CI:s2, tv:stimTime, stimTime, narrow:true, echoTa: stimTime + va};
    continues = true;
  } else {
    terminated = true;
    vpbBeat = {origin:'V', label:'VPB', isPaced:true, isExtra:true, CI:s2, tv:stimTime, stimTime, narrow:true};
  }
  beats.push(vpbBeat);

  if (terminated){
    state.AVNRT_INDUCED = false;
    state.OVERDRIVE_TERMINATED = true;
    let ts = stimTime + CTX.sinusCL;
    while (ts < upToMs){ beats.push(makeAtrialBeat(ts, CTX.sinusCL, false, 'Sinus')); ts += CTX.sinusCL; }
  } else if (continues){
    let th2 = (vpbBeat.echoTa ?? stimTime) + baseVA;
    while (th2 < upToMs){ beats.push(makeSustainedTachyBeat(th2, type, label)); th2 += TCL; }
  } else {
    let th2 = lastVTime + TCL;
    while (th2 < upToMs){ beats.push(makeSustainedTachyBeat(th2, type, label)); th2 += TCL; }
  }
  return {beats, ready:true, prematurity};
}
export function buildEntrainmentBeats(p, upToMs){
  // Encarrilamiento (entrainment) desde VD durante TRNAV típica — usa el Ciclo S1 y el Sitio de
  // estimulación reales que el usuario programa en "Modo de estimulación" (VD apical o basal),
  // no un valor separado: así se reproduce la maniobra estimulando desde el propio polígrafo.
  // - TCL basal = ciclo de la taquicardia (p.tachyCL).
  // - Estimulación en VD al ciclo (p.s1cl) que el usuario elija — debe ser más corto que la TCL.
  // - QRS estimulado puro: mantiene la misma morfología angosta que en taquicardia.
  // - VA estirado 30 ms durante la estimulación ventricular (vs. VA≈0 de la TRNAV basal).
  // - Al detener la estimulación, la taquicardia retorna con PPI − TCL esperado (configurable, >125 ms).
  const CTX = state.CTX;
  const TCL = p.tachyCL;
  const ppiMinusTCL = +document.getElementById('entrainPPIminusTCL').value;
  const entrainCL = p.s1cl;
  const isVD = (p.site==='VDapex' || p.site==='VDbasal');
  const beats = [];

  let th = 0;
  for (let i=0; i<3; i++){
    const tv = th + CTX.hv0;
    beats.push({origin:'A', label:'TRNAV', isPaced:false, isExtra:false, CI:TCL, ah:Math.max(30,TCL-CTX.hv0), th, tv, echoTa:tv+35});
    th += TCL;
  }

  if (!isVD || entrainCL >= TCL){
    // Sin estimulación válida programada (falta sitio VD, o el ciclo no es más corto que la TCL):
    // se sigue viendo la TRNAV basal, a la espera de que el usuario programe la estimulación.
    while (th < upToMs){
      const tv = th + CTX.hv0;
      beats.push({origin:'A', label:'TRNAV', isPaced:false, isExtra:false, CI:TCL, ah:Math.max(30,TCL-CTX.hv0), th, tv, echoTa:tv+35});
      th += TCL;
    }
    return {beats, TCL, entrainCL, PPI:null, ppiMinusTCL:null, ready:false};
  }

  let stim = th;
  let lastStim = stim;
  for (let i=0; i<6; i++){
    // VA durante la estimulación ventricular estirado 30 ms (vs. VA≈0 de la TRNAV basal) —
    // el eco auricular retrógrado no es simultáneo con la V estimulada, sino 30 ms después.
    beats.push({origin:'V', label:'VD'+(i+1), isPaced:true, isExtra:false, CI:entrainCL, tv:stim, stimTime:stim, blocked:'VA', narrow:true, echoTa:stim+30});
    lastStim = stim;
    stim += entrainCL;
  }

  const PPI = TCL + ppiMinusTCL;
  let returnTh = lastStim + PPI - CTX.hv0;
  while (returnTh < upToMs){
    const tv = returnTh + CTX.hv0;
    beats.push({origin:'A', label:'TRNAV', isPaced:false, isExtra:false, CI:TCL, ah:Math.max(30,TCL-CTX.hv0), th:returnTh, tv, echoTa:tv+35});
    returnTh += TCL;
  }
  return {beats, TCL, entrainCL, PPI, ppiMinusTCL, ready:true};
}
export function selectManiobra(maniobra){
  state.ACTIVE_MANIOBRA = maniobra;
  state.AVNRT_INDUCED = false; // realizar una maniobra termina el estado de "inducida permanente"
  document.getElementById('entrainParamsRow').style.display = (maniobra==='entrainment') ? 'flex' : 'none';
  document.getElementById('hisRefrParamsRow').style.display = (maniobra==='hisRefr') ? 'flex' : 'none';
  renderAll();
}
