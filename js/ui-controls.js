import { state } from './state.js';
import { CHANNELS } from './constants.js';
import { getPacingParams } from './params.js';
import {
  buildTachyCutAtInstant, buildAsyncCutAtInstant, buildInductionAtInstant,
  buildOverdriveTermination, buildTachyBeats, buildAVRTOverdriveCapture,
} from './tachycardia-model.js';
import { buildEntrainmentBeats } from './maneuvers.js';
import { buildSvg } from './trace-render.js';
import { refreshEcg12 } from './ecg12-render.js';
import { renderAll, pause, rebuildLap } from './playback.js';

export function buildLabelsAndLegend(){
  const labelsCol = document.getElementById('labelsCol');
  labelsCol.innerHTML = '<div class="ruler-spacer"></div>' + CHANNELS.map(ch =>
    `<div class="chan-label"><span class="swatch" style="background:${ch.color}"></span>${ch.label}</div>`
  ).join('');
}

export function centerOnMonitor(){
  const mainTrace = document.getElementById('traceScrollMain');
  const scope = mainTrace ? mainTrace.closest('.scope') : null;
  if (scope && scope.scrollIntoView) scope.scrollIntoView({behavior:'smooth', block:'center'});
}
export function startStimulation(){
  // Activa (o reaplica) el protocolo seleccionado — Asincrónica o Sincrónica — con los parámetros programados.
  if ((state.activeMode==='ASYNC' || state.activeMode==='SYNC') && !state.SENSING_MODE){
    state.AVNRT_INDUCED = false; // arranca limpio: vuelve a mostrar el tren completo antes de inducir
    state.OVERDRIVE_TERMINATED = false;
  }
  if (state.SENSING_MODE) state.SENSED_S2_FRESH = true;
  state.STIMULATING = true;
  renderAll();
  centerOnMonitor();
}
export function stopStimulation(){
  // Termina la estimulación en curso y vuelve al ritmo sinusal basal.
  if (!state.STIMULATING) return; // no había nada corriendo: no tocar el estado de la taquicardia.
  if (state.SENSING_MODE){
    // En Sensado no hay un "tren" que detener: la taquicardia solo se corta por la física del S2
    // (según su prematurez), nunca por apretar este botón. Simplemente se deja de mirar/animar —
    // y se invalida cualquier corte diferido que hubiera quedado pendiente de un S2 anterior.
    state.SENSED_CYCLE_TOKEN++;
    state.STIMULATING = false;
    pause();
    return;
  }
  if ((state.activeMode==='ASYNC' || state.activeMode==='SYNC') && !state.AVNRT_INDUCED){
    const p = getPacingParams();
    const isAtrialSiteNow = (p.site==='HRA' || p.site==='CSprox' || p.site==='CSdist');
    const s1IndEnabled = document.getElementById('s1InductionEnabled').checked;
    const s1IndCL = +document.getElementById('s1InductionCL').value;
    const wenckAntPt = +document.getElementById('wenckAnt').value;
    const canAutoInduce = (state.INDUCE_TARGET==='AVNRT') || (state.INDUCE_TARGET==='AVRT' && !state.PREEXCITATION_ENABLED);
    // Ventana de inducción: desde el ciclo S1S1 programado hasta el punto de Wenckebach anterógrado
    // (mientras la conducción antegrada siga 1:1, aunque decremental, se puede inducir la reentrada;
    // recién al llegar al Wenckebach anterógrado cambia la física y deja de aplicar esta inducción).
    const inInductionWindow = isAtrialSiteNow && s1IndEnabled && canAutoInduce
      && p.s1cl <= s1IndCL && p.s1cl >= wenckAntPt;
    if (inInductionWindow){
      // Este es el momento del corte: el último S1 entregado dispara la reentrada. STIMULATING
      // sigue en true a propósito — así, cuando la vuelta de pantalla termine y se reinicie, el
      // próximo redibujado sigue mostrando la taquicardia sostenida en vez de volver a sinusal.
      const stopAt = state.elapsedMs;
      const beats = buildInductionAtInstant(p, state.SWEEP_MS + 500, stopAt);
      document.getElementById('traceHost').innerHTML = buildSvg(beats, state.CURRENT_PX, state.SWEEP_MS);
      refreshEcg12(beats);
      updateReadout(beats);
      return;
    }
  }
  if ((state.activeMode==='ASYNC' || state.activeMode==='SYNC') && state.AVNRT_INDUCED){
    const p = getPacingParams();
    const wasType = state.INDUCED_TYPE;
    // La misma condición que ya decide, mientras se sigue estimulando, si el ciclo actual alcanza
    // para cortar la reentrada (rebuildLap) o si esta sigue sostenida pese al pacing.
    const cutsIt = (wasType==='AVNRT' && p.s1cl <= state.AVNRT_TCL - 20) || (wasType==='AVRT' && p.s1cl < state.AVNRT_TCL - 30);
    if (!cutsIt){
      // La estimulación actual no alcanza para cortarla: la reentrada es autosostenida y sigue en
      // taquicardia aunque se deje de pacear — no se toca ni se reinicia nada.
      return;
    }
    // Si alcanza para cortarla: se aplica el corte YA, en el instante actual, sin reiniciar el
    // polígrafo — el cursor y el trazado ya dibujado quedan como están, y de acá en más sigue en sinusal.
    const stopAt = state.elapsedMs;
    state.AVNRT_INDUCED = false;
    state.OVERDRIVE_TERMINATED = false;
    state.STIMULATING = false;
    const beats = (wasType==='AVNRT')
      ? buildOverdriveTermination(p, state.SWEEP_MS + 500, state.AVNRT_TCL, stopAt)
      : buildTachyCutAtInstant(wasType, state.AVNRT_TCL, state.SWEEP_MS + 500, stopAt);
    document.getElementById('traceHost').innerHTML = buildSvg(beats, state.CURRENT_PX, state.SWEEP_MS);
    refreshEcg12(beats);
    updateReadout(beats);
    return;
  }
  if (state.activeMode==='ASYNC' || state.activeMode==='SYNC'){
    // Pacing simple (sin taquicardia inducida): igual que arriba, se corta desde el instante
    // actual, conservando lo que ya se venía viendo, sin reiniciar el polígrafo.
    const p = getPacingParams();
    const stopAt = state.elapsedMs;
    state.STIMULATING = false;
    state.AVNRT_INDUCED = false;
    state.OVERDRIVE_TERMINATED = false;
    const beats = buildAsyncCutAtInstant(p, state.SWEEP_MS + 500, stopAt);
    document.getElementById('traceHost').innerHTML = buildSvg(beats, state.CURRENT_PX, state.SWEEP_MS);
    refreshEcg12(beats);
    updateReadout(beats);
    return;
  }
  // Ningún otro caso tiene un "tren" que detener de verdad (p.ej. los modelos simples como
  // Auricular, Flutter, JET, Ventricular, que se muestran como ritmo continuo sin protocolo de
  // sobreestimulación): "Detener" no hace nada acá — no reinicia el polígrafo ni corta la
  // taquicardia, y tampoco toca STIMULATING (para que el próximo redibujado natural no revierta a
  // sinusal por su cuenta).
}
export function onSensingModeChange(){
  state.SENSING_MODE = document.querySelector('input[name=sensingMode]:checked').value === 'sensed';
  const asyncRadio = document.querySelector('input[name=mode][value=ASYNC]');
  const syncRadio = document.querySelector('input[name=mode][value=SYNC]');
  asyncRadio.disabled = state.SENSING_MODE;
  if (state.SENSING_MODE && !syncRadio.checked){ syncRadio.checked = true; }
  state.activeMode = document.querySelector('input[name=mode]:checked').value;
  updateModeVisibility();
  renderAll();
}
export function onModeRadioChange(){
  state.activeMode = document.querySelector('input[name=mode]:checked').value;
  updateModeVisibility();
  renderAll();
}
export function updateModeVisibility(){
  const s2row = document.getElementById('s2row');
  const nbeatsInput = document.getElementById('nbeats');
  const s1clRow = document.getElementById('s1clRow');
  const showS2 = (state.activeMode==='SYNC') || (state.activeMode==='MODELS' && state.MODEL_TACHY_TYPE==='AVNRT');
  s2row.style.display = showS2 ? 'flex' : 'none';
  nbeatsInput.disabled = showS2 || state.SENSING_MODE;
  if (showS2) nbeatsInput.value = 8;
  // Sensado: sin tren de S1 — el ciclo S1 no aplica, solo el S2.
  s1clRow.style.opacity = state.SENSING_MODE ? '0.4' : '1';
  document.getElementById('s1cl').disabled = state.SENSING_MODE;
}
export function onPreexcitationChange(){
  state.PREEXCITATION_ENABLED = document.getElementById('preexcitationEnabled').checked;
  document.getElementById('pathwayAnteERPRow').style.display = state.PREEXCITATION_ENABLED ? 'flex' : 'none';
  document.getElementById('hv0').value = state.PREEXCITATION_ENABLED ? 15 : 35;
  onCycleParamChange();
}
export function selectModelTachy(type){
  state.activeMode = 'MODELS';
  state.MODEL_TACHY_TYPE = type;
  state.ACTIVE_MANIOBRA = null;
  state.AVNRT_INDUCED = false;
  state.STIMULATING = false; // siempre arranca en ritmo sinusal, sin importar el modelo elegido
  document.querySelectorAll('input[name=mode]').forEach(r => { r.checked = false; }); // evita que quede "Asincrónica" marcada mientras se está en un modelo
  document.getElementById('entrainParamsRow').style.display = 'none';
  document.getElementById('pathwayLocRow').style.display = (type==='AVRT') ? 'flex' : 'none';
  document.getElementById('preexcitationRow').style.display = (type==='AVRT') ? 'flex' : 'none';
  document.getElementById('pathwayRetroERPRow').style.display = (type==='AVRT') ? 'flex' : 'none';
  if (type!=='AVRT'){
    document.getElementById('preexcitationEnabled').checked = false;
    state.PREEXCITATION_ENABLED = false;
    document.getElementById('pathwayAnteERPRow').style.display = 'none';
  }
  if (type==='AVNRT'){
    // Activa el salto de vía (umbral 320 ms) y el ciclo de taquicardia sostenida (300 ms) por
    // defecto — el S2 lo programa el usuario con las flechitas, no se fija automáticamente.
    // También activa por defecto el modo Asincrónico con Inducción S1S1 (ciclo 320 ms), listo
    // para inducir con solo presionar "Estimular".
    document.getElementById('jumpEnabled').checked = true;
    document.getElementById('jumpCL').value = 320;
    document.getElementById('tachyCL').value = 300;
    document.getElementById('s1InductionEnabled').checked = true;
    document.getElementById('s1InductionCL').value = 320;
    state.activeMode = 'ASYNC';
    document.querySelector('input[name=mode][value=ASYNC]').checked = true;
    state.INDUCE_TARGET = 'AVNRT';
    document.getElementById('s2InduceLabel').textContent = 'TRNAV';
  } else if (type==='AVRT'){
    state.INDUCE_TARGET = 'AVRT';
    document.getElementById('s2InduceLabel').textContent = 'TRAV';
    document.getElementById('jumpEnabled').checked = true;
    document.getElementById('jumpCL').value = 320;
    document.getElementById('tachyCL').value = 300;
    document.getElementById('s1InductionEnabled').checked = true;
    document.getElementById('s1InductionCL').value = 320;
  }
  updateModelButtons();
  updateModeVisibility();
  renderAll();
}
export function updateModelButtons(){
  document.querySelectorAll('.model-btn').forEach(btn => {
    const selected = btn.dataset.model === state.MODEL_TACHY_TYPE;
    const inTachy = selected && state.AVNRT_INDUCED && state.INDUCED_TYPE === btn.dataset.model;
    if (inTachy){
      btn.style.background = '#0a1257'; // azul oscuro: la taquicardia está efectivamente activa
      btn.style.color = '#ffffff';
      btn.style.fontWeight = '700';
    } else {
      btn.style.background = selected ? '#7fd4f0' : 'var(--panel2)'; // celeste: seleccionada, aún no activa
      btn.style.color = selected ? '#0a2233' : 'var(--text)';
      btn.style.fontWeight = selected ? '600' : '500';
    }
  });
}

export function updateReadout(beats){
  updateModelButtons();
  const box = document.getElementById('readout');
  const mode = state.activeMode;
  const CTX = state.CTX;
  if (!state.STIMULATING && (mode==='ASYNC' || mode==='SYNC')){
    box.textContent = 'Ritmo sinusal basal, sin estimulación (75/min). Programá el protocolo y apretá "Estimular" para empezar.';
    return;
  }
  if (mode==='ASYNC' && state.AVNRT_INDUCED){
    const p = getPacingParams();
    if (p.s1cl <= state.AVNRT_TCL - 20){
      const fasterBy = state.AVNRT_TCL - p.s1cl;
      const zone = fasterBy > 50 ? 'Bloqueo AV 2:1' : 'Wenckebach anterógrado 3:2';
      box.innerHTML = `<strong>${zone}</strong> — sobreestimulando la TRNAV (TCL ${Math.round(state.AVNRT_TCL)} ms) con S1 ${Math.round(p.s1cl)} ms (${Math.round(fasterBy)} ms más rápido). Apretá "Detener estimulación" para revertir a ritmo sinusal.`;
    } else {
      box.innerHTML = `<strong>TRNAV inducida — sostenida en forma permanente</strong> (ciclo ${Math.round(state.AVNRT_TCL)} ms). Estimulá desde auricular ≥20 ms más rápido para cortarla (Wenckebach hasta 50 ms, 2:1 más allá).`;
    }
    return;
  }
  if (mode==='MODELS'){
    if (state.MODEL_TACHY_TYPE==='AVNRT' && state.ACTIVE_MANIOBRA==='entrainment'){
      const p = getPacingParams();
      const r = buildEntrainmentBeats(p, 1);
      if (!r.ready){
        box.innerHTML = `TRNAV basal (TCL ${Math.round(r.TCL)} ms). Programá arriba, en "Polígrafo": Sitio = VD apical o basal, y más abajo, en "Modo de estimulación": Ciclo S1 &lt; ${Math.round(r.TCL)} ms, para encarrilar.`;
        return;
      }
      box.innerHTML = `<strong>Entrainment desde VD</strong> — TCL basal ${Math.round(r.TCL)} ms · CL de estimulación ${Math.round(r.entrainCL)} ms (programado por vos) · QRS estimulado puro (misma morfología angosta) · VA estirado 30 ms durante la estimulación · tren de 6 latidos · PPI ${Math.round(r.PPI)} ms → <strong>PPI − TCL = ${Math.round(r.ppiMinusTCL)} ms</strong> (${r.ppiMinusTCL>125 ? 'compatible' : 'no compatible'}: debe dar > 125 ms).`;
      return;
    }
    if (state.MODEL_TACHY_TYPE==='AVNRT'){
      const p = getPacingParams();
      if (state.AVNRT_INDUCED){ box.innerHTML = `<strong>TRNAV inducida — sostenida en forma permanente</strong> (ciclo ${Math.round(p.tachyCL)} ms) hasta que realices una maniobra.`; return; }
      const s2Beat = beats.find(b => b.isExtra);
      if (!s2Beat){ box.textContent = 'TRNAV típica: ritmo sinusal basal. Programá el tren S1S1 (cualquier ciclo) y el S2 para intentar inducirla.'; return; }
      const induced = CTX.jumpEnabled && p.ci2 <= CTX.jumpCL && s2Beat.ah != null;
      if (!CTX.jumpEnabled){
        box.innerHTML = `S2 ${Math.round(p.ci2)} ms — activá "Salto de vía" en parámetros fisiológicos para poder inducir la TRNAV.`;
      } else if (induced){
        box.innerHTML = `<strong>¡TRNAV inducida!</strong> S2 ${Math.round(p.ci2)} ms ≤ umbral de salto (${Math.round(CTX.jumpCL)} ms) — eco auricular (VA simultáneo) y taquicardia sostenida a ${Math.round(p.tachyCL)} ms.`;
      } else if (s2Beat.ah != null){
        box.innerHTML = `No se indujo. S2 ${Math.round(p.ci2)} ms — todavía por encima del umbral de salto (${Math.round(CTX.jumpCL)} ms). AH = ${Math.round(s2Beat.ah)} ms.`;
      } else {
        box.innerHTML = `No se indujo. S2 ${Math.round(p.ci2)} ms bloqueó en el nodo AV (por debajo del PRE, ≈${CTX.ERP} ms) antes de poder saltar.`;
      }
      return;
    }
    const labels = {
      AVRT: 'TRAV ortodrómica: conducción anterógrada casi normal, P retrógrado visible después del QRS, 1:1.',
      PJRT: 'Septal de RP largo (tipo PJRT): vía accesoria posteroseptal decremental, RP > PR, incesante.',
      IRP: 'Septal de RP intermedio: VA entre el corto (TRNAV/TRAV típica) y el largo (PJRT).',
      JET: 'Ectópica de la unión: foco automático juncional, QRS angosto, disociación A-V con la aurícula siguiendo su propio ritmo sinusal.',
      AT: 'Auricular: foco ectópico auricular con conducción AV normal decremental.',
      AFL: 'Flutter auricular: actividad auricular rápida y regular con conducción 2:1 al ventrículo.',
      VT: 'Ventricular (QRS ancho): disociación A-V, la aurícula sigue su propio ritmo sinusal, más lento e independiente.',
    };
    box.textContent = labels[state.MODEL_TACHY_TYPE] || '';
    return;
  }
  const extras = beats.filter(b=>b.isExtra);
  if (extras.length===0){ box.textContent = 'Modo asincrónico (S1S1): pacing continuo a ciclo fijo, sin extraestímulo.'; return; }
  const t = extras[extras.length-1];
  let html = `<strong>${t.label}</strong> — acoplamiento ${Math.round(t.CI)} ms. `;
  if (t.blocked==='local') html += 'No captura local (estímulo dentro del período refractario miocárdico).';
  else if (t.blocked==='AV') html += `Bloqueo AV nodal — se alcanzó el PRE anterógrado (≈${CTX.ERP} ms).`;
  else if (t.blocked==='VA') html += `Bloqueo V-A retrógrado — se alcanzó el PRE retrógrado (≈${CTX.VERP} ms).`;
  else if (t.origin==='A') html += `Conducido: AH = ${Math.round(t.ah)} ms · HV = ${Math.round(CTX.hv0)} ms.`;
  else html += `Conducido en retrógrado: VA = ${Math.round(t.va)} ms (VH≈${Math.round(CTX.hv0)} ms + HA≈${Math.round(t.va-CTX.hv0)} ms).`;
  box.innerHTML = html;
}

export function stepInput(id, delta){
  const el = document.getElementById(id);
  let v = (+el.value || 0) + delta;
  const min = +el.min, max = +el.max;
  if (!isNaN(min)) v = Math.max(min, v);
  if (!isNaN(max)) v = Math.min(max, v);
  el.value = v;
  onCycleParamChange(id);
}
export function applyS1InductionCLChange(){
  const cl = +document.getElementById('s1InductionCL').value;
  document.getElementById('wenckAnt').value = cl + 10; // el Wenckebach aparece 10 ms antes de la zona de inducción
  onCycleParamChange();
}
export function applyS2InduceField(){
  const jumpCL = +document.getElementById('jumpCL').value;
  const field = document.getElementById('s2InduceCL');
  const clamped = Math.min(+field.value, jumpCL - 10); // siempre por debajo del umbral de salto
  field.value = Math.max(150, clamped);
  document.getElementById('s2').value = field.value;
  onCycleParamChange();
}
export function onCycleParamChange(fieldId){
  // Con el modelo de barrido por vueltas, un cambio de S1/S2 se aplica solo en la próxima vuelta si
  // no se fuerza — pero mientras se está reproduciendo (por ejemplo, ajustando la velocidad de
  // sobreestimulación en vivo), lo aplicamos ya mismo, sin resetear el cursor ni reiniciar el polígrafo.
  if (state.SENSING_MODE) state.SENSED_S2_FRESH = true; // cambiar S2 a propósito SÍ cuenta como una nueva entrega
  // Mientras se está estimulando, centrar el trazado en pantalla al tocar el ciclo que rige el modo
  // activo (S1 en asincrónica, S2 en sincrónica), para que el efecto del ajuste quede siempre a la vista.
  if (state.STIMULATING && (
    (fieldId === 's1cl' && state.activeMode === 'ASYNC') ||
    (fieldId === 's2' && state.activeMode === 'SYNC')
  )) centerOnMonitor();
  if (state.SENSING_MODE || !state.playing){ renderAll(); return; } // Sensado: el S2 es un evento único —
                                                                     // siempre se vuelve a mostrar completo desde el inicio.
  rebuildLap();
}
