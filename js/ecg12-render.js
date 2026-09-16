import { state } from './state.js';
import { LEADS12, ROW_H, TOP_PAD } from './constants.js';
import { deltaSignForLead, qrsAmplitudeScale, deltaMorphologyForLead } from './pathway-helpers.js';
import {
  qrsWideState, qrsShapeFeat, buildContinuousPath, buildSawtoothTeeth,
  stimTickOverlay, pWaveFeat, preexcitedQrsFeat, qrsFeatNeg, qrsFeat,
  hiddenRetrogradePInQRS, terminalNotchFeat, qrsDurationMs,
} from './trace-render.js';
import { currentLapBeats } from './playback.js';

function leadQRSConfig(cfg, beatOrigin, site, narrow){
  if (beatOrigin !== 'V' || narrow) return {type: cfg.type, wide:false};
  // Estimulación desde VD: QRS ancho, patrón de bloqueo de rama izquierda (BRI). El eje frontal
  // cambia según el sitio de origen (apical = eje superior, basal = eje conservado/positivo en cara inferior).
  const inferiorLeads = ['DII','DIII','aVF'];
  if (site==='VDapex'){
    if (inferiorLeads.includes(cfg.name)) return {type:'neg', wide:true};
    if (cfg.name==='aVR') return {type:'rs', wide:true};   // eje superior: aVR casi isoeléctrico
    if (cfg.name==='DI' || cfg.name==='aVL') return {type:'up', wide:true};
  } else if (site==='VDbasal'){
    if (inferiorLeads.includes(cfg.name)) return {type: cfg.type, wide:true}; // eje positivo en cara inferior
    if (cfg.name==='aVR') return {type:'QS', wide:true};
  }
  // Precordiales — patrón de BRI verdadero: S profunda en V1-V2, transición en V3,
  // y R ancha y predominante (no pequeña) en V4-V6, sin onda Q.
  if (['V1','V2'].includes(cfg.name)) return {type:'rS', wide:true};
  if (cfg.name==='V3') return {type:'RS', wide:true};
  if (['V4','V5','V6'].includes(cfg.name)) return {type:'qR', wide:true};
  if (inferiorLeads.includes(cfg.name)) return {type:'Rs', wide:true}; // por defecto (p. ej. TV): R alta con s terminal
  return {type: cfg.type, wide:true};
}
function renderLead12Trace(cfg, beats, cy, px, width){
  const features = [];
  let overlays = '';
  // DI, DII y V1 son exactamente los mismos canales que ya se ven en el polígrafo intracavitario
  // (misma morfología, incluida la inversión en DII con VD apical) — no una aproximación aparte.
  const mirrorMain = (cfg.name==='DI' || cfg.name==='DII' || cfg.name==='V1');
  const inferior12 = (cfg.name==='DII' || cfg.name==='DIII' || cfg.name==='aVF');
  const isFlutter = beats.some(b => b.sawtooth);
  if (isFlutter) buildSawtoothTeeth(beats, px, cy).forEach(f => features.push(f));
  beats.forEach(b => {
    if (b.blocked==='local') return;
    if (b.stimTime!=null){ const stimOff = b.origin==='A' ? 40 : 65; overlays += stimTickOverlay((b.stimTime-stimOff)*px, cy); }
    const hideRetroP = hiddenRetrogradePInQRS(b);
    if (b.ta!=null && !b.sawtooth && !b.hiddenOnSurface && !hideRetroP){
      let pInv = b.origin==='V';
      if (inferior12 && b.origin==='A' && b.isPaced && (state.CTX.site==='CSprox' || state.CTX.site==='CSdist')) pInv = true;
      if (b.abnormalP) pInv = true;
      features.push(pWaveFeat(b.ta*px, cy, pInv, px));
    }
    if (b.echoVisible) features.push(pWaveFeat((b.surfaceP ?? b.echoTa)*px, cy, true, px));
    if (b.tv!=null){
      const dSign = b.hasDelta ? deltaSignForLead(b.deltaPathway, cfg.name) : null;
      if (b.hasDelta && dSign !== 'none'){
        features.push(preexcitedQrsFeat((b.ta+40)*px, cy, dSign, px, qrsAmplitudeScale(cfg.name), deltaMorphologyForLead(b.deltaPathway, cfg.name)));
      } else if (b.hasDelta){
        // Esta derivación no muestra onda delta (vector isoeléctrico): QRS normal, sin ensanchar,
        // pero igual sin segmento PR (arranca justo donde termina la P).
        features.push(qrsShapeFeat((b.ta+75)*px, cy, px, cfg.type, false));
      } else if (mirrorMain){
        if (cfg.name==='DII' && b.origin==='V' && state.CTX.site==='VDapex' && !b.narrow){
          features.push(qrsFeatNeg(b.tv*px, cy, px, b.qrsCoincide ? 'coincide' : true));
        } else if (cfg.name==='V1'){
          features.push(qrsShapeFeat(b.tv*px, cy, px, 'rS', qrsWideState(b)));
        } else {
          features.push(qrsFeat(b.tv*px, cy, qrsWideState(b), px));
        }
      } else {
        const qc = leadQRSConfig(cfg, b.origin, state.CTX.site, b.narrow);
        features.push(qrsShapeFeat(b.tv*px, cy, px, qc.type, b.qrsCoincide ? 'coincide' : qc.wide));
      }
      if (inferior12 && hideRetroP){
        features.push(terminalNotchFeat((b.tv + qrsDurationMs(b))*px, cy, px));
      }
    }
  });
  return `<path d="${buildContinuousPath(features, cy, width)}" fill="none" stroke="#d7dee0" stroke-width="1.4"/>` + overlays;
}
export function buildSvg12(beats, px, fixedDurationMs){
  let maxT = fixedDurationMs;
  if (maxT == null){
    maxT = 0;
    beats.forEach(b => { maxT = Math.max(maxT, b.ta||0, b.tv||0, b.th||0); });
    maxT += 500;
    maxT = Math.max(maxT, 900/px);
  }
  const width = Math.round(maxT*px);
  const height = TOP_PAD + LEADS12.length*ROW_H + 20;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  s += `<rect width="100%" height="100%" fill="#05080a"/>`;
  for (let tms=0; tms*px<width; tms+=200){
    const x = tms*px, major = tms%1000===0;
    s += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${major?'#1c2b30':'#0f1a1d'}" stroke-width="1"/>`;
    if (major) s += `<text x="${x+4}" y="${height-6}" fill="#3d5a61" font-size="10" font-family="'IBM Plex Mono',monospace">${(tms/1000).toFixed(1)}s</text>`;
  }
  LEADS12.forEach((cfg,i) => {
    const cy = TOP_PAD + i*ROW_H + ROW_H/2;
    s += `<line x1="0" y1="${cy}" x2="${width}" y2="${cy}" stroke="#0d1518" stroke-width="1"/>`;
  });
  s += `<defs><clipPath id="revealClip12"><rect id="clipRect12" x="0" y="0" width="0" height="${height}"/></clipPath></defs>`;
  s += `<g clip-path="url(#revealClip12)">`;
  LEADS12.forEach((cfg,i) => {
    const cy = TOP_PAD + i*ROW_H + ROW_H/2;
    s += renderLead12Trace(cfg, beats, cy, px, width);
  });
  s += `</g>`;
  s += `<line id="cursorLine12" x1="0" y1="0" x2="0" y2="${height}" stroke="#ffffff" stroke-width="1.5" opacity="0.85"/>`;
  s += `</svg>`;
  return s;
}
export function buildLabels12(){
  const col = document.getElementById('labelsCol12');
  if (!col) return;
  col.innerHTML = '<div class="ruler-spacer"></div>' + LEADS12.map(cfg =>
    `<div class="chan-label">${cfg.name}</div>`
  ).join('');
}
export function refreshEcg12(beats){
  const panel = document.getElementById('ecg12Panel');
  if (!panel || panel.style.display === 'none') return; // oculto: no vale la pena reconstruirlo
  const host = document.getElementById('traceHost12');
  if (host) host.innerHTML = buildSvg12(beats, state.CURRENT_PX, state.SWEEP_MS);
}
export function toggleEcg12(){
  const panel = document.getElementById('ecg12Panel');
  const btn = document.getElementById('ecg12Btn');
  const show = panel.style.display === 'none';
  panel.style.display = show ? 'block' : 'none';
  btn.textContent = show ? 'Ocultar ECG 12 derivaciones' : 'ECG 12 derivaciones';
  if (show){
    refreshEcg12(currentLapBeats());
  }
}
