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
  return {
    sinusCL: +document.getElementById('sinusCL').value,
    AH0: +document.getElementById('ah0').value,
    hv0: +document.getElementById('hv0').value,
    ERP: +document.getElementById('erp').value,
    VA0: +document.getElementById('va0').value,
    VERP: +document.getElementById('verp').value,
    wenckAnt: +document.getElementById('wenckAnt').value,
    wenckRetro: +document.getElementById('wenckRetro').value,
    jumpEnabled: document.getElementById('jumpEnabled').checked,
    jumpCL: +document.getElementById('jumpCL').value,
    jumpRetroEnabled: document.getElementById('jumpRetroEnabled').checked,
    jumpRetroCL: +document.getElementById('jumpRetroCL').value,
    s1InductionEnabled: document.getElementById('s1InductionEnabled').checked,
    s1InductionCL: +document.getElementById('s1InductionCL').value,
  };
}
