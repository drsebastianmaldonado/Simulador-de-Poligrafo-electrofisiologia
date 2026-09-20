import { state } from './state.js';

export function getPacingParams(){
  const mode = state.activeMode;
  return {
    site: document.querySelector('input[name=site]:checked').value,
    mode: mode,
    s1cl: +document.getElementById('s1cl').value,
    n: mode==='SYNC' ? 8 : +document.getElementById('nbeats').value,
    ci2: +document.getElementById('s2').value,
    tachyType: state.MODEL_TACHY_TYPE,
    tachyCL: +document.getElementById('tachyCL').value,
  };
}
export function getPhysio(){
  // Isoproterenol: efecto cronotrópico e hiperconductor — acelera el ciclo sinusal basal (según
  // el % que se programe, hasta el que el usuario elija) y acorta 50 ms los PRE del nodo AV
  // (anterógrado y retrógrado) y de la vía accesoria (ver los dos puntos de lectura en
  // physio-model.js). No toca los puntos de Wenckebach ni el resto de la fisiología.
  const isoproterenolEnabled = document.getElementById('isoproterenolEnabled').checked;
  const isoproterenolPct = +document.getElementById('isoproterenolPct').value;
  const sinusCLBase = +document.getElementById('sinusCL').value;
  const erpBase = +document.getElementById('erp').value;
  const verpBase = +document.getElementById('verp').value;
  return {
    sinusCL: isoproterenolEnabled ? Math.round(sinusCLBase * (1 - isoproterenolPct/100)) : sinusCLBase,
    AH0: +document.getElementById('ah0').value,
    hv0: +document.getElementById('hv0').value,
    ERP: isoproterenolEnabled ? erpBase - 50 : erpBase,
    VA0: +document.getElementById('va0').value,
    VERP: isoproterenolEnabled ? verpBase - 50 : verpBase,
    wenckAnt: +document.getElementById('wenckAnt').value,
    wenckRetro: +document.getElementById('wenckRetro').value,
    jumpEnabled: document.getElementById('jumpEnabled').checked,
    jumpCL: +document.getElementById('jumpCL').value,
    jumpRetroEnabled: document.getElementById('jumpRetroEnabled').checked,
    jumpRetroCL: +document.getElementById('jumpRetroCL').value,
    s1InductionEnabled: document.getElementById('s1InductionEnabled').checked,
    s1InductionCL: +document.getElementById('s1InductionCL').value,
    isoproterenolEnabled,
  };
}
