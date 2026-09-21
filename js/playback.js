import { state } from './state.js';
import { mmsToPxPerMs } from './constants.js';
import { getPacingParams, getPhysio } from './params.js';
import { buildSinusOnlyBeats } from './physio-model.js';
import {
  buildOneSyncCycle, buildAsyncLapBeats, buildTachyBeats, buildAVNRTInduction,
  resolveSustainedTachyBeats, jetRetro11,
} from './tachycardia-model.js';
import { buildEntrainmentBeats, buildHisRefractoryExtrastim, buildAtrialExtrastimJunctional } from './maneuvers.js';
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
  if (!state.STIMULATING && !state.AVNRT_INDUCED && (p.mode==='ASYNC' || p.mode==='SYNC')) return buildSinusOnlyBeats(state.SWEEP_MS + 500);
  if (state.OVERDRIVE_TERMINATED && (p.mode==='ASYNC' || p.mode==='SYNC')) return buildSinusOnlyBeats(state.SWEEP_MS + 500);
  // El extraestímulo auricular a la refractariedad juncional (TRNAV vs JET) aplica apenas la TRNAV
  // esté realmente inducida (sin importar el modo activo — "TRNAV típica" induce vía Asincrónica,
  // no se queda en modo Modelos) o, para JET, con el modelo activo y ya estimulando.
  if (state.ACTIVE_MANIOBRA==='atrialExtra' && ((state.AVNRT_INDUCED && (state.INDUCED_TYPE==='AVNRT' || state.INDUCED_TYPE==='JET')) || (p.mode==='MODELS' && p.tachyType==='JET' && state.STIMULATING))){
    return buildAtrialExtrastimJunctional(p, state.SWEEP_MS + 500).beats;
  }
  if (p.mode==='SYNC' && state.AVNRT_INDUCED && !state.SENSING_MODE){
    return resolveSustainedTachyBeats(p);
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
// Duración mínima de cada vuelta del barrido "en bucle" (ritmo sinusal, pacing continuo, taquicardia
// sostenida). Antes cada vuelta duraba exactamente una pantalla (~1.5-2 s a 50 mm/s) y se reiniciaba
// todo el tiempo, sin dejar margen para repasar hacia atrás. Con este mínimo, el barrido se comporta
// como un registro continuo real: dura bastante más que una pantalla, así que el contenedor del
// trazado queda con scroll horizontal (barra inferior) y hay margen de sobra para "10 s atrás".
const CONTINUOUS_MIN_MS = 20000;

export function rebuildLap(opts){
  const p = getPacingParams();
  state.CTX = Object.assign(getPhysio(), {s1cl: p.s1cl, site: p.site});
  const containerW = getContainerWidth();
  state.CURRENT_PX = mmsToPxPerMs(+document.getElementById('zoom').value);
  const screenMs = containerW / state.CURRENT_PX;
  const loopMs = Math.max(screenMs, CONTINUOUS_MIN_MS);
  let beats;
  if (state.ACTIVE_MANIOBRA==='atrialExtra' && ((state.AVNRT_INDUCED && (state.INDUCED_TYPE==='AVNRT' || state.INDUCED_TYPE==='JET')) || (p.mode==='MODELS' && p.tachyType==='JET' && state.STIMULATING))){
    // Extraestímulo auricular a la refractariedad juncional (TRNAV vs JET): aplica apenas la TRNAV
    // esté realmente inducida, sin importar el modo activo ("TRNAV típica" induce vía Asincrónica).
    state.SWEEP_MS = loopMs;
    beats = buildAtrialExtrastimJunctional(p, state.SWEEP_MS + 500).beats;
  } else if (!state.STIMULATING && !state.AVNRT_INDUCED && (p.mode==='ASYNC' || p.mode==='SYNC')){
    // Sin estimulación activada (y sin taquicardia sostenida en curso): solo ritmo sinusal basal.
    state.SWEEP_MS = loopMs;
    beats = buildSinusOnlyBeats(state.SWEEP_MS + 500);
  } else if (state.OVERDRIVE_TERMINATED && (p.mode==='ASYNC' || p.mode==='SYNC')){
    // Se cortó por sobreestimulación: sinusal estable.
    state.SWEEP_MS = loopMs;
    beats = buildSinusOnlyBeats(state.SWEEP_MS + 500);
  } else if (p.mode==='SYNC' && state.AVNRT_INDUCED && !state.SENSING_MODE){
    // Ya inducida: sigue sostenida en bucle continuo, salvo que el ciclo comprometido al presionar
    // "Estimular" alcance para cortarla por sobreestimulación (igual que en asincrónico).
    state.SWEEP_MS = loopMs;
    beats = resolveSustainedTachyBeats(p);
  } else if (p.mode==='SYNC'){
    // La vuelta dura lo que dura el ciclo completo a la escala elegida — si no entra entero en
    // pantalla, se puede desplazar (scroll) dentro de esa única vuelta; no se recorta ni se auto-ajusta.
    const cycle = buildOneSyncCycle(0, p);
    beats = cycle.beats;
    state.SWEEP_MS = cycle.nextTime;
  } else if (p.mode==='MODELS' && !state.STIMULATING){
    // Cualquier modelo: arranca en ritmo sinusal basal hasta que se apriete "Estimular",
    // sin importar cuál esté seleccionado.
    state.SWEEP_MS = loopMs;
    beats = buildSinusOnlyBeats(state.SWEEP_MS + 500);
  } else if (p.mode==='MODELS' && (p.tachyType==='AVNRT'||p.tachyType==='AVRT') && state.ACTIVE_MANIOBRA==='entrainment'){
    // Entrainment desde VD: la vuelta dura el bucle continuo, como en asincrónico.
    state.SWEEP_MS = loopMs;
    beats = buildEntrainmentBeats(p, state.SWEEP_MS + 500).beats;
  } else if (p.mode==='MODELS' && (p.tachyType==='AVNRT'||p.tachyType==='AVRT') && state.ACTIVE_MANIOBRA==='hisRefr'){
    // Extraestímulo con His refractario.
    state.SWEEP_MS = loopMs;
    beats = buildHisRefractoryExtrastim(p, state.SWEEP_MS + 500).beats;
  } else if (p.mode==='MODELS' && (p.tachyType==='AVNRT'||p.tachyType==='AVRT') && state.AVNRT_INDUCED){
    // Ya inducida: queda permanente, en bucle continuo, hasta que se realice una maniobra.
    state.SWEEP_MS = loopMs;
    beats = buildTachyBeats(state.INDUCED_TYPE, p.tachyCL, state.SWEEP_MS + 500);
  } else if (p.mode==='MODELS' && (p.tachyType==='AVNRT'||p.tachyType==='AVRT')){
    // TRNAV o TRAV: arranca en ritmo sinusal basal, con el protocolo S1S1+S2 (salto de vía) que
    // induce la taquicardia sostenida — igual que en sincrónico, puede necesitar desplazarse.
    const ind = buildAVNRTInduction(p, 4000);
    beats = ind.beats;
    state.SWEEP_MS = ind.totalMs;
  } else if (p.mode==='MODELS'){
    // Ritmo sostenido: bucle continuo a la escala elegida, igual que en asincrónico.
    state.SWEEP_MS = loopMs;
    beats = buildTachyBeats(p.tachyType, p.tachyCL, state.SWEEP_MS + 500);
  } else {
    // Pacing continuo: bucle continuo a la escala elegida — salvo que haya una inducción S1S1 en
    // curso, en cuyo caso se garantiza espacio para completar el tren de 8 latidos y ver el inicio
    // de la taquicardia sostenida.
    const isAtrialSiteNow = (p.site==='HRA' || p.site==='CSprox' || p.site==='CSdist');
    const inducing = isAtrialSiteNow && !state.AVNRT_INDUCED && state.CTX.s1InductionEnabled && p.s1cl <= state.CTX.s1InductionCL && p.s1cl >= state.CTX.s1InductionCL - 30;
    state.SWEEP_MS = inducing ? Math.max(loopMs, p.s1cl*8 + p.tachyCL*3) : loopMs;
    beats = buildAsyncLapBeats(p);
  }
  showBeats(beats, opts);
}

// Instante de comienzo de un latido (el primer evento que tenga) — para saber de qué lado de un
// corte cae.
function beatKey(b){
  const ts = [b.stimTime, b.ta, b.th, b.tv, b.egmTa].filter(v => typeof v === 'number');
  return ts.length ? Math.min(...ts) : null;
}
// Empalma el trazado ya dibujado (todo lo anterior al instante actual, tal cual estaba) con el
// que corresponde al estado nuevo (todo lo posterior) — así estimular, detener o cambiar S1/S2 no
// borra ni redibuja lo que ya se registró: el registro sigue continuo. Para no duplicar latidos
// pegados al corte, un latido nuevo debe empezar al menos 120 ms después del último viejo del
// mismo origen (aurícula / ventrículo).
function spliceBeats(oldBeats, newBeats, cut){
  const past = oldBeats.filter(b => { const k = beatKey(b); return k != null && k < cut; });
  const lastKey = {};
  past.forEach(b => { lastKey[b.origin] = Math.max(lastKey[b.origin] ?? -Infinity, beatKey(b)); });
  const fut = newBeats.filter(b => {
    const k = beatKey(b);
    return k != null && k >= Math.max(cut, (lastKey[b.origin] ?? -Infinity) + 120);
  });
  return past.concat(fut);
}
// Dibuja los latidos y sincroniza cursor, ECG de 12 derivaciones y panel de estado. Con
// opts.splice conserva lo ya registrado (ver spliceBeats) y no mueve el scroll.
export function showBeats(beats, opts){
  const canSplice = opts && opts.splice && state.LAP_BEATS && state.LAP_PX === state.CURRENT_PX
    && state.SWEEP_MS > state.elapsedMs;
  if (canSplice) beats = spliceBeats(state.LAP_BEATS, beats, state.elapsedMs);
  state.LAP_BEATS = beats;
  state.LAP_PX = state.CURRENT_PX;
  document.getElementById('traceHost').innerHTML = buildSvg(beats, state.CURRENT_PX, state.SWEEP_MS);
  refreshEcg12(beats);
  // Si la vuelta nueva quedó más corta que la posición actual del cursor (p.ej. al pasar de un
  // bucle sinusal largo a una secuencia de inducción corta), hay que encajarlo en el rango válido
  // ANTES de dibujar el cursor — si no, el clip-path queda más ancho que el trazado nuevo entero y
  // se revela todo de golpe (incluida la taquicardia) en vez de ir apareciendo con la barrida.
  if (state.elapsedMs >= state.SWEEP_MS) state.elapsedMs = state.elapsedMs % state.SWEEP_MS;
  if (!canSplice){
    const mainScroll = document.getElementById('traceScrollMain');
    if (mainScroll) mainScroll.scrollLeft = 0;
    const ecgScroll = document.getElementById('traceScroll12');
    if (ecgScroll) ecgScroll.scrollLeft = 0;
  }
  updateCursor(state.elapsedMs);
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
export function rewind10s(){
  // Retrocede el cursor del barrido 10 s dentro de la misma vuelta ya dibujada (sin recalcular el
  // trazado ni tocar el estado de estimulación) — pensado para usarse en pausa y después, si se
  // quiere, volver a darle Play para repasar cómo se dibujó ese tramo.
  state.elapsedMs = Math.max(0, state.elapsedMs - 10000);
  updateCursor(state.elapsedMs);
}
function tick(ts){
  if (!state.playing) return;
  if (state.lastTs==null) state.lastTs = ts;
  let dt = ts - state.lastTs;
  state.lastTs = ts;
  if (dt > 150) dt = 150; // si el navegador pausó la pestaña, no intentar recuperar todo de golpe
  const speed = +document.getElementById('speed').value;
  state.elapsedMs += dt*speed;
  if (state.AVNRT_INDUCED && state.INDUCED_TYPE==='JET'){
    // La JET automática no dura para siempre: con disociación VA revierte sola a sinusal a los 5 s;
    // con retroconducción 1:1 (imita TRNAV) tarda 30 s, para dar tiempo a hacer maniobras.
    // reloj de pared: no depende de cuántos cuadros logre dibujar el navegador
    // En Sensado (haciendo la maniobra con S2) el reloj se congela: no revierte mientras se opera.
    if (state.SENSING_MODE) state.JET_INDUCED_AT = performance.now() - state.JET_SUSTAINED_MS;
    state.JET_SUSTAINED_MS = performance.now() - state.JET_INDUCED_AT;
    const limit = jetRetro11() ? 30000 : 5000;
    if (state.JET_SUSTAINED_MS >= limit){
      state.AVNRT_INDUCED = false;
      state.JET_REVERTED_MSG = true;
      rebuildLap();
    }
  }

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
