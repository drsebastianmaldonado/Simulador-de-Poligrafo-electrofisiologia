import { state } from './state.js';
import { PATHWAY_CONFIGS } from './constants.js';
import { makeAtrialBeat, makeSustainedTachyBeat, computeAH } from './physio-model.js';
import { renderAll } from './playback.js';
import { jetRetro11 } from './tachycardia-model.js';

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
export function buildAtrialExtrastimJunctional(p, upToMs){
  // Extraestímulo auricular con refractariedad juncional ("PAC a la refractariedad del His"):
  // distingue TRNAV de taquicardia ectópica de la unión (JET) — ver maniobra 6 de
  // docs/maniobras-diagnosticas-svt.md. Los primeros latidos son sensados (la taquicardia
  // sostenida tal cual); después se entrega un único extraestímulo auricular (S2), acoplado
  // desde la última activación auricular.
  //  - TRNAV: el extra alcanza a activar la vía lenta (mismo computeAH decremental que un S2
  //    normal) y REINICIA el reloj de la taquicardia — el próximo His se adelanta/atrasa según el
  //    AH resultante (o queda sin efecto si cae dentro del período refractario auricular).
  //  - JET: el foco de la unión está disociado de la aurícula — el extra no tiene ningún efecto
  //    sobre el ritmo ventricular, que sigue exactamente en su ciclo propio.
  const CTX = state.CTX;
  const type = state.MODEL_TACHY_TYPE;
  const s2 = +document.getElementById('atrialExtraS2').value;
  const beats = [];
  const nSensed = 4;

  if (type === 'JET' && jetRetro11()){
    // Retroconducción 1:1: se ve como una TRNAV, pero el foco de la unión no se reinicia con el
    // extraestímulo auricular — el ritmo V/A acoplado sigue en su ciclo, y el extra queda como un
    // latido auricular aislado (por eso esta maniobra la distingue de la TRNAV).
    const cycleMs = state.AVNRT_TCL || p.tachyCL;
    let th = 0;
    while (th < upToMs){
      const tv = th + CTX.hv0;
      beats.push({origin:'A', label:'JET', isPaced:false, isExtra:false, CI:cycleMs, th, tv, echoTa:tv+35, noAtrialSpread:true});
      th += cycleMs;
    }
    const stimTime = 3*cycleMs + s2;
    beats.push({origin:'A', label:'APB', isPaced:true, isExtra:true, CI:s2, ta:stimTime, stimTime});
    return {beats, type, s2, affected:false, ready:true, retro11:true};
  }
  if (type === 'JET'){
    const cycleMs = p.tachyCL;
    const jetBeats = [];
    let t = 0;
    while (t < upToMs){ jetBeats.push({origin:'V', label:'JET', isPaced:false, isExtra:false, CI:cycleMs, tv:t, blocked:'VA', narrow:true}); t += cycleMs; }
    const sinusCLUsed = CTX.sinusCL * 1.037;
    const hiddenAt = (ta) => jetBeats.some(v => ta >= v.tv - 5 && ta <= v.tv + 75);
    let ts = 0, i = 0;
    while (i < nSensed){
      beats.push({origin:'A', label:'Sinus', isPaced:false, isExtra:false, CI:CTX.sinusCL, ta:ts, hiddenOnSurface:hiddenAt(ts)});
      ts += sinusCLUsed; i++;
    }
    const lastTs = ts - sinusCLUsed;
    const stimTime = lastTs + s2;
    beats.push({origin:'A', label:'APB', isPaced:true, isExtra:true, CI:s2, ta:stimTime, stimTime, hiddenOnSurface:hiddenAt(stimTime)});
    let ts2 = stimTime + CTX.sinusCL;
    while (ts2 < upToMs){
      beats.push({origin:'A', label:'Sinus', isPaced:false, isExtra:false, CI:CTX.sinusCL, ta:ts2, hiddenOnSurface:hiddenAt(ts2)});
      ts2 += sinusCLUsed;
    }
    beats.push(...jetBeats);
    return {beats, type, s2, affected:false, ready:true};
  }

  // TRNAV
  const TCL = state.AVNRT_TCL || p.tachyCL;
  let th = 0;
  for (let i=0; i<nSensed; i++){ beats.push(makeSustainedTachyBeat(th, 'AVNRT', 'TRNAV')); th += TCL; }
  const lastTh = th - TCL;
  const stimTime = lastTh + s2;
  const ah = computeAH(s2); // reutiliza el mismo modelo de conducción decremental por la vía lenta que un S2 normal
  let affected;
  if (ah == null){
    beats.push({origin:'A', label:'APB', isPaced:true, isExtra:true, CI:s2, ta:stimTime, stimTime, blocked:'AV'});
    let th2 = lastTh + TCL;
    while (th2 < upToMs){ beats.push(makeSustainedTachyBeat(th2, 'AVNRT', 'TRNAV')); th2 += TCL; }
    affected = false;
  } else {
    const resetTh = stimTime + ah;
    beats.push({origin:'A', label:'APB', isPaced:true, isExtra:true, CI:s2, ta:stimTime, stimTime, ah, th:resetTh, tv:resetTh+CTX.hv0, echoTa:(resetTh+CTX.hv0)+35});
    let th2 = resetTh + TCL;
    while (th2 < upToMs){ beats.push(makeSustainedTachyBeat(th2, 'AVNRT', 'TRNAV')); th2 += TCL; }
    affected = true;
  }
  return {beats, type, s2, ah, affected, ready:true};
}
export function selectManiobra(maniobra){
  state.ACTIVE_MANIOBRA = maniobra;
  // Encarrilamiento y extraestímulo ventricular arman su propia secuencia sostenida, así que
  // realizar esas maniobras termina el estado de "inducida permanente". El extraestímulo auricular
  // es distinto: necesita saber si la TRNAV sigue realmente inducida para dar la respuesta correcta
  // (la reinicia si lo está, no hace nada si el mecanismo es JET), así que no toca esta bandera.
  if (maniobra !== 'atrialExtra') state.AVNRT_INDUCED = false;
  document.getElementById('entrainParamsRow').style.display = (maniobra==='entrainment') ? 'flex' : 'none';
  document.getElementById('hisRefrParamsRow').style.display = (maniobra==='hisRefr') ? 'flex' : 'none';
  document.getElementById('atrialExtraParamsRow').style.display = (maniobra==='atrialExtra') ? 'flex' : 'none';
  renderAll();
}
