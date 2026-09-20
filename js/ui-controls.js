import { state } from './state.js';
import { CHANNELS } from './constants.js';
import { getPacingParams } from './params.js';
import {
  buildTachyCutAtInstant, buildAsyncCutAtInstant, buildInductionAtInstant,
  buildOverdriveTermination, buildTachyBeats, buildAVRTOverdriveCapture,
} from './tachycardia-model.js';
import { buildEntrainmentBeats, buildHisRefractoryExtrastim, buildAtrialExtrastimJunctional } from './maneuvers.js';
import { buildSvg } from './trace-render.js';
import { refreshEcg12 } from './ecg12-render.js';
import { renderAll, pause, play, rebuildLap } from './playback.js';

// Qué canal de la columna de etiquetas corresponde a cada sitio de estimulación real — los
// bipolos intermedios del CS (CS 3-4, 5-6, 7-8) y el proximal de ablación son solo de registro,
// no hay un sitio de estimulación para ellos; y VD no distingue ápex/basal por catéter, así que su
// botón elige VD apical por defecto.
const CHANNEL_TO_SITE = {
  HRA: 'HRA',
  CS910: 'CSprox',
  CS12: 'CSdist',
  AblD: 'AblD',
  VD: 'VDapex',
};
export function buildLabelsAndLegend(){
  const labelsCol = document.getElementById('labelsCol');
  labelsCol.innerHTML = '<div class="ruler-spacer"></div>' + CHANNELS.map(ch => {
    const swatch = `<span class="swatch" style="background:${ch.color}"></span>${ch.label}`;
    if (ch.kind==='surface' || !CHANNEL_TO_SITE[ch.key]){
      return `<div class="chan-label">${swatch}</div>`;
    }
    return `<button type="button" class="chan-label chan-label-btn" data-key="${ch.key}" onclick="selectSiteFromChannel('${ch.key}')" title="Usar como sitio de estimulación">${swatch}<span class="site-dot"></span></button>`;
  }).join('');
  updateChannelSiteHighlight();
}
export function selectSiteFromChannel(channelKey){
  const site = CHANNEL_TO_SITE[channelKey];
  if (!site) return false;
  const radio = document.querySelector(`input[name=site][value="${site}"]`);
  if (!radio) return false;
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
  return true;
}
export function updateChannelSiteHighlight(){
  const currentSite = document.querySelector('input[name=site]:checked')?.value;
  document.querySelectorAll('.chan-label-btn').forEach(btn => {
    const isActive = CHANNEL_TO_SITE[btn.dataset.key] === currentSite;
    btn.classList.toggle('chan-label-btn-active', isActive);
  });
}

function setStimBtn(){
  const btn = document.getElementById('stimBtn');
  if (!btn) return;
  if (state.STIMULATING){
    btn.textContent = 'Detener estimulación';
    btn.style.background = '#e5484d';
    btn.style.color = '#2a0a0a';
  } else {
    btn.textContent = 'Estimular';
    btn.style.background = '#3fcf6e';
    btn.style.color = '#0a2410';
  }
}
export function toggleStimulation(){
  if (state.STIMULATING) stopStimulation(); else startStimulation();
}
export function startStimulation(){
  // Activa (o reaplica) el protocolo seleccionado — Asincrónica o Sincrónica — con los parámetros
  // programados, SIEMPRE continuando el mismo registro en curso (nunca reinicia el barrido a cero
  // ni el cursor): como en un polígrafo real, "Estimular" no borra lo que ya se venía grabando, ni
  // siquiera la primera vez que se aprieta tras un "Detener" — solo agrega la estimulación desde
  // el instante actual en adelante.
  if ((state.activeMode==='ASYNC' || state.activeMode==='SYNC') && !state.SENSING_MODE && !state.AVNRT_INDUCED){
    // Arranca limpio (vuelve a mostrar el tren completo antes de inducir) solo si no hay ya una
    // taquicardia sostenida — si la hay, "Estimular" la pacea con el ciclo actual (p.ej. para
    // intentar sobreestimularla), sin reiniciar la inducción.
    state.OVERDRIVE_TERMINATED = false;
  }
  if (state.SENSING_MODE) state.SENSED_S2_FRESH = true;
  // El ciclo S1 recién queda "comprometido" contra una taquicardia sostenida al presionar este
  // botón — tocar el campo sin apretar "Estimular" no debe arrancar una sobreestimulación por su cuenta.
  state.APPLIED_S1CL = getPacingParams().s1cl;
  state.STIMULATING = true;
  rebuildLap();
  play(); // por si estaba pausado (p.ej. tras "Pausar"); si ya estaba reproduciendo, no hace nada.
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
  if ((state.activeMode==='ASYNC' || state.activeMode==='SYNC') && !state.AVNRT_INDUCED && !state.OVERDRIVE_TERMINATED){
    // El !OVERDRIVE_TERMINATED evita que, justo después de cortar una taquicardia por
    // sobreestimulación (donde se sigue paceando 1:1 al mismo ciclo rápido), "Detener" se
    // interprete como el disparo de una NUEVA inducción en vez de simplemente dejar de estimular.
    const p = getPacingParams();
    const isAtrialSiteNow = (p.site==='HRA' || p.site==='CSprox' || p.site==='CSdist');
    const s1IndEnabled = document.getElementById('s1InductionEnabled').checked;
    const s1IndCL = +document.getElementById('s1InductionCL').value;
    const wenckAntPt = +document.getElementById('wenckAnt').value;
    const canAutoInduce = (state.INDUCE_TARGET==='AVNRT') || (state.INDUCE_TARGET==='AVRT' && !state.PREEXCITATION_ENABLED) || state.INDUCE_TARGET==='AT';
    // Ventana de inducción: desde el ciclo S1S1 programado hasta el punto de Wenckebach anterógrado
    // (mientras la conducción antegrada siga 1:1, aunque decremental, se puede inducir la reentrada;
    // recién al llegar al Wenckebach anterógrado cambia la física y deja de aplicar esta inducción).
    const inInductionWindow = isAtrialSiteNow && s1IndEnabled && canAutoInduce
      && p.s1cl <= s1IndCL && p.s1cl >= wenckAntPt;
    if (inInductionWindow){
      // Este es el momento del corte: el último S1 entregado dispara la reentrada. AVNRT_INDUCED
      // (seteado dentro de buildInductionAtInstant) es lo que hace que el próximo redibujado siga
      // mostrando la taquicardia sostenida en vez de volver a sinusal — STIMULATING ya no necesita
      // quedar en true para eso, así que se suelta a false acá mismo: "Detener" deja el botón listo
      // para volver a decir "Estimular" de una sola vez, sin un segundo click extra.
      const stopAt = state.elapsedMs;
      const beats = buildInductionAtInstant(p, state.SWEEP_MS + 500, stopAt);
      state.STIMULATING = false;
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
    const cutsIt = (wasType==='AVNRT' && p.s1cl <= state.AVNRT_TCL - 20) || (wasType==='AVRT' && p.s1cl < state.AVNRT_TCL - 30) || (wasType==='AT' && p.s1cl <= state.AVNRT_TCL - 20);
    if (!cutsIt){
      // La estimulación actual no alcanza para cortarla: la reentrada es autosostenida y sigue en
      // taquicardia aunque se deje de pacear (AVNRT_INDUCED se mantiene, rebuildLap sigue mostrándola
      // sin importar STIMULATING). Pero "Detener" tiene que dejar de comandar la estimulación, si no
      // el botón queda trabado en "Detener" para siempre y nunca se puede volver a apretar "Estimular"
      // con un ciclo más rápido para reintentar el corte.
      state.STIMULATING = false;
      rebuildLap();
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
  if (state.activeMode==='MODELS'){
    if (!state.AVNRT_INDUCED){
      // Ritmos continuos simples (Auricular, Flutter, JET, Ventricular) o TRNAV/TRAV del modelo que
      // todavía no se indujeron con el tren S1S1+S2: no hay un "tren" que detener de verdad acá
      // — no reinicia el polígrafo, y tampoco toca STIMULATING (para que el próximo redibujado
      // natural no revierta a sinusal por su cuenta).
      return;
    }
    // TRNAV/TRAV ya inducida en el modelo (sin protocolo de sobreestimulación disponible acá, a
    // diferencia de Asincrónica/Sincrónica: acá se corta con una maniobra de entrainment o
    // extraestímulo His-refractario, no con "Estimular"/"Detener"): "Detener" termina la
    // demostración y vuelve a ritmo sinusal basal, sin reiniciar el barrido (mismo registro continuo).
    // Antes esta rama no existía y el botón quedaba trabado en "Detener estimulación" para siempre.
    state.AVNRT_INDUCED = false;
    state.STIMULATING = false;
    rebuildLap();
    return;
  }
  // Ningún otro caso (fuera de Asincrónica/Sincrónica/Modelos) tiene un "tren" que detener de
  // verdad: "Detener" no hace nada acá.
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
  } else if (type==='AT'){
    // Foco automático/ectópico: no hay doble vía nodal que "saltar" (sin salto de vía), se induce
    // parando dentro de la ventana S1S1 — igual mecanismo de disparo que TRNAV/TRAV, pero el
    // resultado "calienta" progresivamente en vez de saltar de golpe (ver buildInductionAtInstant).
    state.INDUCE_TARGET = 'AT';
    document.getElementById('s2InduceLabel').textContent = 'TAE';
    document.getElementById('jumpEnabled').checked = false;
    document.getElementById('tachyCL').value = 300;
    document.getElementById('s1InductionEnabled').checked = true;
    document.getElementById('s1InductionCL').value = 380;
    state.activeMode = 'ASYNC';
    document.querySelector('input[name=mode][value=ASYNC]').checked = true;
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
  // Maniobras diagnósticas: solo tienen sentido sobre TRNAV/TRAV (encarrilamiento, extraestímulo
  // ventricular) o TRNAV/JET (extraestímulo auricular a la refractariedad juncional).
  const type = state.MODEL_TACHY_TYPE;
  const maniobraRow = document.getElementById('maniobraRow');
  // "TRNAV típica" induce vía modo Asincrónica (no se queda en modo Modelos), así que esto se
  // basa en MODEL_TACHY_TYPE (persiste sin importar el modo activo), no en state.activeMode.
  const showManiobras = (type==='AVNRT' || type==='AVRT' || type==='JET');
  if (maniobraRow) maniobraRow.style.display = showManiobras ? 'flex' : 'none';
  document.querySelectorAll('.avnrt-avrt-maniobra').forEach(btn => {
    btn.style.display = (type==='AVNRT' || type==='AVRT') ? 'inline-block' : 'none';
  });
  document.querySelectorAll('.avnrt-jet-maniobra').forEach(btn => {
    btn.style.display = (type==='AVNRT' || type==='JET') ? 'inline-block' : 'none';
  });
  document.querySelectorAll('.maniobra-btn').forEach(btn => {
    const selected = (btn.dataset.maniobra || null) === state.ACTIVE_MANIOBRA;
    btn.style.background = selected ? '#7fd4f0' : 'var(--panel2)';
    btn.style.color = selected ? '#0a2233' : 'var(--text)';
    btn.style.fontWeight = selected ? '600' : '500';
  });
}

export function updateReadout(beats){
  updateModelButtons();
  setStimBtn();
  const box = document.getElementById('readout');
  const mode = state.activeMode;
  const CTX = state.CTX;
  if (!state.STIMULATING && !state.AVNRT_INDUCED && (mode==='ASYNC' || mode==='SYNC')){
    box.textContent = 'Ritmo sinusal basal, sin estimulación (75/min). Programá el protocolo y apretá "Estimular" para empezar.';
    return;
  }
  if (state.AVNRT_INDUCED && state.INDUCED_TYPE==='AVNRT' && state.ACTIVE_MANIOBRA==='atrialExtra'){
    // "TRNAV típica" induce vía Asincrónica (mode!=='MODELS'), así que esto se chequea antes del
    // mensaje genérico de abajo para que la maniobra se pueda leer sin importar el modo activo.
    const p = getPacingParams();
    const r = buildAtrialExtrastimJunctional(p, 1);
    if (r.affected){
      box.innerHTML = `<strong>Extraestímulo auricular a la refractariedad juncional</strong> — acoplamiento ${Math.round(r.s2)} ms: activó la vía lenta (AH ${Math.round(r.ah)} ms) y <strong>reinició</strong> el reloj de la taquicardia → compatible con <strong>TRNAV</strong>.`;
    } else {
      box.innerHTML = `<strong>Extraestímulo auricular a la refractariedad juncional</strong> — acoplamiento ${Math.round(r.s2)} ms: bloqueó en el nodo AV (por debajo del PRE, ≈${CTX.ERP} ms), sin efecto sobre la taquicardia. Probá con un acoplamiento mayor.`;
    }
    return;
  }
  if (mode==='ASYNC' && state.AVNRT_INDUCED){
    // Muestra el estado según el ciclo REALMENTE comprometido (APPLIED_S1CL) — no el que esté
    // escrito ahora mismo en el campo si todavía no se volvió a apretar "Estimular". El label y el
    // detalle del intento de corte dependen del tipo realmente inducido (TRNAV/TRAV/TAE) — antes
    // esto decía siempre "TRNAV", incluso estando inducida una TRAV o (ahora) una TAE.
    const indLabel = {AVNRT:'TRNAV', AVRT:'TRAV', AT:'TAE'}[state.INDUCED_TYPE] || state.INDUCED_TYPE;
    const cutDetail = state.INDUCED_TYPE==='AVNRT' ? ' (Wenckebach hasta 50 ms, 2:1 más allá)' : '';
    box.innerHTML = `<strong>${indLabel} inducida — sostenida en forma permanente</strong> (ciclo ${Math.round(state.AVNRT_TCL)} ms). Programá un Ciclo S1 ≥20 ms más rápido y apretá "Estimular" para intentar cortarla${cutDetail}.`;
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
    if ((state.MODEL_TACHY_TYPE==='AVNRT' || state.MODEL_TACHY_TYPE==='AVRT') && state.ACTIVE_MANIOBRA==='hisRefr'){
      const p = getPacingParams();
      const r = buildHisRefractoryExtrastim(p, 1);
      if (!r.ready){
        box.innerHTML = `Programá arriba, en "Polígrafo": Sitio = VD apical o basal, para entregar el extraestímulo con His refractario.`;
        return;
      }
      const label = r.prematurity < 20 ? 'no captura (dentro del período refractario ventricular)'
        : (r.prematurity <= (state.MODEL_TACHY_TYPE==='AVRT' ? 40 : 30) ? 'fusión manifiesta' : (r.prematurity <= 60 ? 'QRS puro, sigue conduciendo' : 'corta la taquicardia sin conducir a la aurícula'));
      box.innerHTML = `<strong>Extraestímulo ventricular His-refractario</strong> — prematurez ${Math.round(r.prematurity)} ms → ${label}.`;
      return;
    }
    if (state.MODEL_TACHY_TYPE==='JET' && state.ACTIVE_MANIOBRA==='atrialExtra'){
      const p = getPacingParams();
      const r = buildAtrialExtrastimJunctional(p, 1);
      box.innerHTML = `<strong>Extraestímulo auricular a la refractariedad juncional</strong> — acoplamiento ${Math.round(r.s2)} ms: sin ningún efecto sobre el ritmo ventricular (foco de la unión disociado de la aurícula) → compatible con <strong>JET</strong>.`;
      return;
    }
    if (state.MODEL_TACHY_TYPE==='AVNRT' && state.ACTIVE_MANIOBRA==='atrialExtra'){
      // Caso borde: MODEL_TACHY_TYPE=AVNRT en modo Modelos sin haber inducido todavía vía
      // Asincrónica (la rama de arriba, antes del "if (mode==='MODELS')", cubre el caso real).
      box.innerHTML = 'Primero inducí la TRNAV con el tren S1S1 + S2 para poder aplicar el extraestímulo auricular.';
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
  onCycleParamChange();
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
export function onCycleParamChange(){
  // Con el modelo de barrido por vueltas, un cambio de S1/S2 se aplica solo en la próxima vuelta si
  // no se fuerza — pero mientras se está reproduciendo (por ejemplo, ajustando la velocidad de
  // sobreestimulación en vivo), lo aplicamos ya mismo, sin resetear el cursor ni reiniciar el polígrafo.
  if (state.SENSING_MODE) state.SENSED_S2_FRESH = true; // cambiar S2 a propósito SÍ cuenta como una nueva entrega
  if (state.SENSING_MODE || !state.playing){ renderAll(); return; } // Sensado: el S2 es un evento único —
                                                                     // siempre se vuelve a mostrar completo desde el inicio.
  rebuildLap();
}
