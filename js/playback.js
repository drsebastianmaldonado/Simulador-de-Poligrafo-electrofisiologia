import { state } from './state.js';
import { mmsToPxPerMs } from './constants.js';
import { getPacingParams, getPhysio } from './params.js';
import { buildSinusOnlyBeats } from './physio-model.js';
import {
  buildOneSyncCycle, buildAsyncLapBeats, buildTachyBeats, buildAVNRTInduction,
  buildOverdriveTermination, buildAVRTOverdriveCapture,
} from './tachycardia-model.js';
import { buildEntrainmentBeats, buildHisRefractoryExtrastim } from './maneuvers.js';
import { buildSvg } from './trace-render.js';
import { refreshEcg12 } from './ecg12-render.js';
import { updateReadout } from './ui-controls.js';

export function getContainerWidth(){
  const el = document.getElementById('traceScrollMain');
  return (el && el.clientWidth) ? Math.max(50, el.clientWidth - 2) : 900;
}

export function currentLapBeats(){
  // Beats para el estado actual, SIN tocar CURRENT_PX/SWEEP_MS (para reusar en el panel de 12 derivaciones
  // sin desincronizar la escala que ya está aplicada al polígrafo principal).
  const p = getPacingParams();
  if (!state.STIMULATING && (p.mode==='ASYNC' || p.mode==='SYNC')) return buildSinusOnlyBeats(state.SWEEP_MS + 500);
  if (state.OVERDRIVE_TERMINATED && (p.mode==='ASYNC' || p.mode==='SYNC')) return buildSinusOnlyBeats(state.SWEEP_MS + 500);
  if (p.mode==='SYNC' && state.AVNRT_INDUCED && !state.SENSING_MODE){
    if (state.INDUCED_TYPE==='AVNRT' && p.s1cl <= state.AVNRT_TCL - 20) return buildOverdriveTermination(p, state.SWEEP_MS + 500, state.AVNRT_TCL);
    if (state.INDUCED_TYPE==='AVRT' && p.s1cl < state.AVNRT_TCL - 30) return buildAVRTOverdriveCapture(p, state.SWEEP_MS + 500);
    return buildTachyBeats(state.INDUCED_TYPE, state.AVNRT_TCL, state.SWEEP_MS + 500);
  }
  if (p.mode==='SYNC') return buildOneSyncCycle(0, p).beats;
  if (p.mode==='MODELS' && !state.STIMULATING) return buildSinusOnlyBeats(state.SWEEP_MS + 500);
  if (p.mode==='MODELS' && (p.tachyType==='AVNRT'||p.tachyType==='AVRT') && state.ACTIVE_MANIOBRA==='entrainment') return buildEntrainmentBeats(p, state.SWEEP_MS + 500).beats;
  if (p.mode==='MODELS' && (p.tachyType==='AVNRT'||p.tachyType==='AVRT') && state.ACTIVE_MANIOBRA==='hisRefr') return buildHisRefractoryExtrastim(p, state.SWEEP_MS + 500).beats;
  if (p.mode==='MODELS' && (p.tachyType==='AVNRT'||p.tachyType==='AVRT') && state.AVNRT_INDUCED) return buildTachyBeats(state.INDUCED_TYPE, p.tachyCL, state.SWEEP_MS + 500);
  if (p.mode==='MODELS' && (p.tachyType==='AVNRT'||p.tachyType==='AVRT')) return buildAVNRTInduction(p, 4000).beats;
  if (p.mode==='MODELS') return buildTachyBeats(p.tachyType, p.tachyCL, state.SWEEP_MS + 500);
  return buildAsyncLapBeats(p);
}
export function rebuildLap(){
  const p = getPacingParams();
  state.CTX = Object.assign(getPhysio(), {s1cl: p.s1cl, site: p.site});
  const containerW = getContainerWidth();
  state.CURRENT_PX = mmsToPxPerMs(+document.getElementById('zoom').value);
  let beats;
  if (!state.STIMULATING && (p.mode==='ASYNC' || p.mode==='SYNC')){
    // Sin estimulación activada: solo ritmo sinusal basal, a pantalla completa.
    state.SWEEP_MS = containerW / state.CURRENT_PX;
    beats = buildSinusOnlyBeats(state.SWEEP_MS + 500);
  } else if (state.OVERDRIVE_TERMINATED && (p.mode==='ASYNC' || p.mode==='SYNC')){
    // Se cortó por sobreestimulación: sinusal estable, en pantalla completa.
    state.SWEEP_MS = containerW / state.CURRENT_PX;
    beats = buildSinusOnlyBeats(state.SWEEP_MS + 500);
  } else if (p.mode==='SYNC' && state.AVNRT_INDUCED && !state.SENSING_MODE){
    // Ya inducida: sigue sostenida en bucle continuo a pantalla completa, salvo que se esté
    // sobreestimulando lo suficientemente rápido, en cuyo caso corta (igual que en asincrónico).
    state.SWEEP_MS = containerW / state.CURRENT_PX;
    if (state.INDUCED_TYPE==='AVNRT' && p.s1cl <= state.AVNRT_TCL - 20) beats = buildOverdriveTermination(p, state.SWEEP_MS + 500, state.AVNRT_TCL);
    else if (state.INDUCED_TYPE==='AVRT' && p.s1cl < state.AVNRT_TCL - 30) beats = buildAVRTOverdriveCapture(p, state.SWEEP_MS + 500);
    else beats = buildTachyBeats(state.INDUCED_TYPE, state.AVNRT_TCL, state.SWEEP_MS + 500);
  } else if (p.mode==='SYNC'){
    // La vuelta dura lo que dura el ciclo completo a la escala elegida — si no entra entero en
    // pantalla, se puede desplazar (scroll) dentro de esa única vuelta; no se recorta ni se auto-ajusta.
    const cycle = buildOneSyncCycle(0, p);
    beats = cycle.beats;
    state.SWEEP_MS = cycle.nextTime;
  } else if (p.mode==='MODELS' && !state.STIMULATING){
    // Cualquier modelo: arranca en ritmo sinusal basal hasta que se apriete "Estimular",
    // sin importar cuál esté seleccionado.
    state.SWEEP_MS = containerW / state.CURRENT_PX;
    beats = buildSinusOnlyBeats(state.SWEEP_MS + 500);
  } else if (p.mode==='MODELS' && (p.tachyType==='AVNRT'||p.tachyType==='AVRT') && state.ACTIVE_MANIOBRA==='entrainment'){
    // Entrainment desde VD: la vuelta dura una pantalla completa, como en asincrónico.
    state.SWEEP_MS = containerW / state.CURRENT_PX;
    beats = buildEntrainmentBeats(p, state.SWEEP_MS + 500).beats;
  } else if (p.mode==='MODELS' && (p.tachyType==='AVNRT'||p.tachyType==='AVRT') && state.ACTIVE_MANIOBRA==='hisRefr'){
    // Extraestímulo con His refractario: pantalla completa.
    state.SWEEP_MS = containerW / state.CURRENT_PX;
    beats = buildHisRefractoryExtrastim(p, state.SWEEP_MS + 500).beats;
  } else if (p.mode==='MODELS' && (p.tachyType==='AVNRT'||p.tachyType==='AVRT') && state.AVNRT_INDUCED){
    // Ya inducida: queda permanente, en bucle continuo, hasta que se realice una maniobra.
    state.SWEEP_MS = containerW / state.CURRENT_PX;
    beats = buildTachyBeats(state.INDUCED_TYPE, p.tachyCL, state.SWEEP_MS + 500);
  } else if (p.mode==='MODELS' && (p.tachyType==='AVNRT'||p.tachyType==='AVRT')){
    // TRNAV o TRAV: arranca en ritmo sinusal basal, con el protocolo S1S1+S2 (salto de vía) que
    // induce la taquicardia sostenida — igual que en sincrónico, puede necesitar desplazarse.
    const ind = buildAVNRTInduction(p, 4000);
    beats = ind.beats;
    state.SWEEP_MS = ind.totalMs;
  } else if (p.mode==='MODELS'){
    // Ritmo sostenido: la vuelta dura una pantalla completa a la escala elegida, igual que en asincrónico.
    state.SWEEP_MS = containerW / state.CURRENT_PX;
    beats = buildTachyBeats(p.tachyType, p.tachyCL, state.SWEEP_MS + 500);
  } else {
    // Pacing continuo: la vuelta dura una pantalla completa a la escala elegida — salvo que haya
    // una inducción S1S1 en curso, en cuyo caso se garantiza espacio para completar el tren de 8
    // latidos y ver el inicio de la taquicardia sostenida (permitiendo scroll si no entra en una pantalla).
    const screenMs = containerW / state.CURRENT_PX;
    const isAtrialSiteNow = (p.site==='HRA' || p.site==='CSprox' || p.site==='CSdist');
    const inducing = isAtrialSiteNow && !state.AVNRT_INDUCED && state.CTX.s1InductionEnabled && p.s1cl <= state.CTX.s1InductionCL && p.s1cl >= state.CTX.s1InductionCL - 30;
    state.SWEEP_MS = inducing ? Math.max(screenMs, p.s1cl*8 + p.tachyCL*3) : screenMs;
    beats = buildAsyncLapBeats(p);
  }
  document.getElementById('traceHost').innerHTML = buildSvg(beats, state.CURRENT_PX, state.SWEEP_MS);
  refreshEcg12(beats);
  const mainScroll = document.getElementById('traceScrollMain');
  if (mainScroll) mainScroll.scrollLeft = 0;
  const ecgScroll = document.getElementById('traceScroll12');
  if (ecgScroll) ecgScroll.scrollLeft = 0;
  updateReadout(beats);
}

function autoScroll(x){
  const el = document.getElementById('traceScrollMain');
  if (!el) return;
  const margin = 90;
  if (x > el.scrollLeft + el.clientWidth - margin){
    el.scrollLeft = Math.min(x - el.clientWidth + margin, Math.max(0, el.scrollWidth - el.clientWidth));
  } else if (x < el.scrollLeft){
    el.scrollLeft = Math.max(0, x - margin);
  }
}
function autoScroll12(x){
  const el = document.getElementById('traceScroll12');
  if (!el) return;
  const margin = 90;
  if (x > el.scrollLeft + el.clientWidth - margin){
    el.scrollLeft = Math.min(x - el.clientWidth + margin, Math.max(0, el.scrollWidth - el.clientWidth));
  } else if (x < el.scrollLeft){
    el.scrollLeft = Math.max(0, x - margin);
  }
}
export function updateCursor(ms){
  const x = ms*state.CURRENT_PX;
  const clipRect = document.getElementById('clipRect');
  const cursorLine = document.getElementById('cursorLine');
  if (clipRect && cursorLine){
    clipRect.setAttribute('width', Math.max(0,x));
    cursorLine.setAttribute('x1', x);
    cursorLine.setAttribute('x2', x);
    autoScroll(x);
  }
  const clipRect12 = document.getElementById('clipRect12');
  const cursorLine12 = document.getElementById('cursorLine12');
  if (clipRect12 && cursorLine12){
    clipRect12.setAttribute('width', Math.max(0,x));
    cursorLine12.setAttribute('x1', x);
    cursorLine12.setAttribute('x2', x);
    autoScroll12(x);
  }
}
function tick(ts){
  if (!state.playing) return;
  if (state.lastTs==null) state.lastTs = ts;
  let dt = ts - state.lastTs;
  state.lastTs = ts;
  if (dt > 150) dt = 150; // si el navegador pausó la pestaña, no intentar recuperar todo de golpe
  const speed = +document.getElementById('speed').value;
  state.elapsedMs += dt*speed;

  try {
    if (state.elapsedMs >= state.SWEEP_MS){
      state.elapsedMs = state.elapsedMs % state.SWEEP_MS;
      rebuildLap(); // pantalla completa: vuelve al inicio y arranca una vuelta nueva (con los valores actuales)
    }
    updateCursor(state.elapsedMs);
  } catch (e){
    console.error('Error en el tick del simulador (se ignora para no congelar el trazado):', e);
  }
  state.rafId = requestAnimationFrame(tick);
}
function setPlayBtn(){
  const btn = document.getElementById('playBtn');
  if (btn) btn.textContent = state.playing ? '⏸ Pausar' : '▶ Reproducir';
}
export function play(){
  if (state.playing) return;
  state.playing = true; state.lastTs = null; setPlayBtn();
  state.rafId = requestAnimationFrame(tick);
}
export function pause(){
  state.playing = false; setPlayBtn();
  if (state.rafId) cancelAnimationFrame(state.rafId);
  clearTimeout(state.loopTimeoutId);
}
export function playPause(){ state.playing ? pause() : play(); }
export function restart(){
  pause();
  state.elapsedMs = 0;
  rebuildLap();
  updateCursor(0);
  play();
}

export function renderAll(){
  pause();
  state.elapsedMs = 0;
  rebuildLap();
  updateCursor(0);
  play();
}
