// Punto de entrada: conecta los módulos ES con los atributos onclick/onchange del HTML (que
// necesitan las funciones colgadas de `window`, ya que un módulo no las expone globalmente por sí
// solo) y dispara el arranque inicial del simulador.
import { buildLabels12, toggleEcg12 } from './ecg12-render.js';
import { buildLabelsAndLegend, updateModeVisibility, startStimulation, stopStimulation, onSensingModeChange, onModeRadioChange, onPreexcitationChange, onCycleParamChange, applyS1InductionCLChange, applyS2InduceField, selectModelTachy, stepInput } from './ui-controls.js';
import { renderAll, playPause, restart } from './playback.js';

Object.assign(window, {
  stepInput,
  selectModelTachy,
  renderAll,
  onPreexcitationChange,
  onCycleParamChange,
  applyS2InduceField,
  applyS1InductionCLChange,
  onSensingModeChange,
  startStimulation,
  stopStimulation,
  onModeRadioChange,
  playPause,
  restart,
  toggleEcg12,
});

buildLabelsAndLegend();
buildLabels12();
updateModeVisibility();
renderAll();
document.querySelectorAll('input[name=site]').forEach(el=>el.addEventListener('change', renderAll));
document.querySelectorAll('#sinusCL,#ah0,#hv0,#erp,#va0,#verp,#wenckAnt,#wenckRetro,#jumpEnabled,#jumpRetroEnabled,#jumpRetroCL,#s1InductionEnabled,#s1InductionCL').forEach(el=>el.addEventListener('change', renderAll));
document.getElementById('jumpCL').addEventListener('change', () => { applyS2InduceField(); renderAll(); });
document.querySelectorAll('#s1cl,#s2').forEach(el=>el.addEventListener('change', onCycleParamChange));
