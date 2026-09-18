import { state } from './state.js';
import {
  CHANNELS, ROW_H, TOP_PAD,
  PATHWAY_CONFIGS, PARAHISIAN_SINUS_TIMING, PARAHISIAN_CS_AV, PARAHISIAN_HRA_AV,
  LEFTPOST_ABL_AV, LEFTPOST_HRA_AV, RIGHTPOSTSEPT_CS_AV, RIGHTPOSTSEPT_ABL_AV,
  RIGHTLATERAL_ABL_AV, RIGHTLATERAL_CS_AV, leftPostCsAV,
} from './constants.js';
import { deltaSignForLead, qrsAmplitudeScale, deltaMorphologyForLead, genericAtrialOffset } from './pathway-helpers.js';

export function qrsWideState(b){
  // 'coincide': el QRS estimulado cae junto al QRS propio de la taquicardia — se dibuja uno solo,
  // con la morfología estimulada pero 40 ms más angosto que el ancho pleno.
  if (b.qrsCoincide) return 'coincide';
  return (b.origin==='V' && !b.narrow);
}
export function qrsDurationMs(b){
  if (b.qrsCoincide) return 90;
  return (b.origin==='V' && !b.narrow) ? 130 : 70;
}
export function classifyPQrsOverlap(pCenter, b){
  // Regla general: cualquier actividad auricular (onda P antero o retrógrada) que se superponga
  // -aunque sea parcialmente, no sólo si queda enteramente adentro- con el QRS no se ve como P
  // aparte en el ECG de superficie, sin importar el origen del latido. Si el solapamiento cae en
  // la mitad final del QRS deja una muesca negativa terminal (deformidad visible); si cae en la
  // mitad inicial, se pierde sin dejar rastro.
  if (pCenter == null || b.tv == null) return 'none';
  if (b.hiddenOnSurface) return 'none'; // ya manejada aparte (disociación AV, p. ej. TEJ)
  const qrsStart = b.tv, qrsDur = qrsDurationMs(b), qrsEnd = qrsStart + qrsDur;
  const pStart = pCenter - 40, pEnd = pCenter + 40;
  if (pEnd <= qrsStart || pStart >= qrsEnd) return 'none'; // sin superposición
  return (pCenter >= qrsStart + qrsDur/2) ? 'second' : 'first';
}
export function classifyRetrogradePOverlap(b){
  return classifyPQrsOverlap(b.ta, b);
}
export function terminalNotchFeat(x, cy, px){
  // Muesca terminal post-QRS: asoma la activación auricular retrógrada que quedó completamente
  // oculta dentro del QRS — pequeña deflexión negativa justo después del complejo.
  const halfW = 12*px;
  return {xStart:x, xEnd:x+2*halfW, cmd:`Q ${x+halfW} ${cy+6} ${x+2*halfW} ${cy}`};
}
export function qrsShapeFeat(x, cy, px, type, wide){
  // 'x' es el INICIO del QRS (el intervalo HV llega hasta acá, no hasta el centro del complejo).
  const dur = (wide==='coincide' ? 90 : (wide ? 130 : 70)) * px;
  const h = dur/2;
  const cx = x + h; // centro visual, usado solo para las curvas internas del trazo
  switch(type){
    case 'qR': return {xStart:x, xEnd:x+dur, cmd:`L ${cx-h*0.5} ${cy+4} L ${cx-h*0.15} ${cy-30} L ${cx+h*0.35} ${cy+6} L ${cx+h} ${cy}`};
    case 'Rs':
      if (wide){
        const hw = h*1.15, cxw = x + hw; // este trazo (curva Q) es más ancho que el estándar
        return {xStart:x, xEnd:x+2*hw, cmd:`Q ${cxw-hw*0.4} ${cy-30} ${cxw} ${cy-30} Q ${cxw+hw*0.4} ${cy-30} ${cxw+hw} ${cy}`};
      }
      return {xStart:x, xEnd:x+dur, cmd:`L ${cx-h*0.3} ${cy-28} L ${cx} ${cy+4} L ${cx+h*0.3} ${cy+12} L ${cx+h} ${cy}`};
    case 'rS': return {xStart:x, xEnd:x+dur, cmd:`L ${cx-h*0.5} ${cy-10} L ${cx-h*0.15} ${cy+4} L ${cx+h*0.3} ${cy+28} L ${cx+h} ${cy}`};
    case 'RS': return {xStart:x, xEnd:x+dur, cmd:`L ${cx-h*0.3} ${cy-22} L ${cx} ${cy+4} L ${cx+h*0.3} ${cy+20} L ${cx+h} ${cy}`};
    case 'QS': return {xStart:x, xEnd:x+dur, cmd:`L ${cx-h*0.1} ${cy+4} L ${cx+h*0.15} ${cy+28} L ${cx+h} ${cy}`};
    case 'rs': return {xStart:x, xEnd:x+dur, cmd:`L ${cx-h*0.3} ${cy-8} L ${cx} ${cy+2} L ${cx+h*0.3} ${cy+8} L ${cx+h} ${cy}`};
    case 'neg': return {xStart:x, xEnd:x+dur, cmd:`L ${cx-h*0.45} ${cy+6} L ${cx-h*0.1} ${cy+21} L ${cx+h*0.4} ${cy-15} L ${cx+h} ${cy}`};
    default:    return {xStart:x, xEnd:x+dur, cmd:`L ${cx-h*0.4} ${cy-4} L ${cx} ${cy-26} L ${cx+h*0.4} ${cy+8} L ${cx+h} ${cy}`};
  }
}
export function stimMark(x, cy, label){
  // Artefacto de estimulación como pulso cuadrado (sube, se mantiene arriba, baja) en vez de una
  // espiga fina — más parecido a como se ve el pulso real del estimulador en el canal del sitio pausado.
  const halfW = 3.5;
  return `<path d="M ${x-halfW} ${cy-4} L ${x-halfW} ${cy-20} L ${x+halfW} ${cy-20} L ${x+halfW} ${cy-4}" fill="none" stroke="#ffd166" stroke-width="2"/>`;
}
export function stimTickOverlay(x, cy){
  // Palito recto delante de la P/QRS captada, como overlay aparte — no altera el trazo continuo.
  return `<path d="M ${x} ${cy} L ${x} ${cy-14}" fill="none" stroke="#ffd166" stroke-width="1.8"/>`;
}
export function pWaveFeat(x, cy, inverted, px){
  const dir = inverted ? 1 : -1;
  const halfW = 40*px;
  return {xStart:x-halfW, xEnd:x+halfW, cmd:`Q ${x} ${cy+dir*3} ${x+halfW} ${cy}`};
}
export function buildSawtoothTeeth(beats, px, cy){
  // Serrucho continuo (sin línea isoeléctrica entre un diente y el siguiente): rama descendente
  // lenta (curva) + ascendente rápida (recta). Se corta exactamente en el QRS de cada onda F
  // conducida, para que el QRS quede limpio, y retoma justo después.
  const amp = 9;
  const times = beats.map(b=>b.ta).filter(v=>v!=null).sort((a,b)=>a-b);
  const byTa = new Map();
  beats.forEach(b => { if (b.ta!=null) byTa.set(b.ta, b); });
  const feats = [];
  function tooth(t0, t1){
    if (t1 <= t0) return;
    const x0 = t0*px, x1 = t1*px;
    const xPeak = x0 + (x1-x0)*0.65; // pico bien marcado (más angular, tipo serrucho real)
    feats.push({ xStart:x0, xEnd:x1, cmd:`L ${x0+(xPeak-x0)*0.3} ${cy+amp*1.7} L ${xPeak} ${cy+amp*1.9} L ${x1} ${cy}` });
  }
  for (let i=1; i<times.length-1; i++){
    const t0 = times[i], t1 = times[i+1];
    const b0 = byTa.get(t0);
    if (b0 && b0.tv!=null){
      const qrsStart = b0.th, qrsEnd = b0.tv + state.CTX.hv0;
      if (qrsStart > t0) tooth(t0, Math.min(qrsStart, t1));
      if (t1 > qrsEnd) tooth(Math.max(qrsEnd, t0), t1);
    } else {
      tooth(t0, t1);
    }
  }
  return feats;
}
export function deltaWaveFeat(x, cy, sign, px){
  // Onda delta: empastamiento inicial lento del QRS (preexcitación), justo antes de la deflexión
  // principal. La polaridad (sign) refleja la localización de la vía.
  const w = 25*px;
  return {xStart:x-w, xEnd:x, cmd:`Q ${x-w*0.4} ${cy - sign*7} ${x} ${cy}`};
}
export function preexcitedQrsFeat(pEndTime, cy, sign, px, scale, type){
  // Complejo QRS preexcitado, como un solo trazo continuo: arranca justo donde termina la onda P
  // (sin segmento PR isoeléctrico). Primera mitad = onda delta (empastamiento lento, la polaridad
  // según la vía). Segunda mitad = se normaliza (deflexión más rápida y de mayor amplitud) — 'Rs'
  // agrega una s chica tras el pico principal, antes de volver a la basal.
  scale = scale==null ? 1 : scale;
  const half = 45*px;
  const x0 = pEndTime, xMid = x0+half, xEnd = xMid+half;
  const deltaPeak = cy - sign*7*scale;
  const mainPeak = cy - sign*26*scale;
  if (type==='Rs'){
    return {xStart:x0, xEnd, cmd:`Q ${x0+half*0.5} ${deltaPeak} ${xMid} ${cy-sign*10*scale} L ${xMid+half*0.3} ${mainPeak} L ${xMid+half*0.7} ${cy+sign*6*scale} L ${xEnd} ${cy}`};
  }
  return {xStart:x0, xEnd, cmd:`Q ${x0+half*0.5} ${deltaPeak} ${xMid} ${cy-sign*10*scale} L ${xMid+half*0.4} ${mainPeak} L ${xEnd} ${cy}`};
}
export function qrsFeat(x, cy, wide, px){
  // 'x' es el INICIO del QRS.
  const dur = (wide==='coincide' ? 90 : (wide ? 130 : 70)) * px;
  const h = dur/2, cx = x + h;
  if (!wide) return {xStart:x, xEnd:x+dur, cmd:`L ${cx-h*0.4} ${cy-4} L ${cx} ${cy-26} L ${cx+h*0.4} ${cy+8} L ${cx+h} ${cy}`};
  return {xStart:x, xEnd:x+dur, cmd:`L ${cx-h*0.45} ${cy-6} L ${cx-h*0.1} ${cy-21} L ${cx+h*0.4} ${cy+15} L ${cx+h} ${cy}`};
}
export function qrsFusionFeat(x, cy, px){
  // Fusión manifiesta: QRS de ancho intermedio, algo menos ancho que el de la taquicardia (que
  // sería 'wide') pero más ancho que el latido puramente estimulado angosto. 'x' es el inicio.
  const dur = 100 * px;
  const h = dur/2, cx = x + h;
  return {xStart:x, xEnd:x+dur, cmd:`L ${cx-h*0.42} ${cy-5} L ${cx-h*0.05} ${cy-24} L ${cx+h*0.4} ${cy+11} L ${cx+h} ${cy}`};
}
export function qrsFeatNeg(x, cy, px, wide){
  // QRS ancho y predominantemente negativo (estimulación en VD apical: eje superior, negativo en DII).
  // 'x' es el inicio del QRS.
  const dur = (wide==='coincide' ? 90 : 130) * px;
  const h = dur/2, cx = x + h;
  return {xStart:x, xEnd:x+dur, cmd:`L ${cx-h*0.45} ${cy+6} L ${cx-h*0.1} ${cy+21} L ${cx+h*0.4} ${cy-15} L ${cx+h} ${cy}`};
}
export function spikeFeat(x, cy, amp, px){
  const halfW = Math.max(2, 6*px);
  return {xStart:x-halfW, xEnd:x+halfW, cmd:`L ${x} ${cy-amp} L ${x+halfW} ${cy}`};
}
export function hOverlay(x, cy, amp){
  return `<path d="M ${x} ${cy} L ${x} ${cy-amp}" fill="none" stroke="#ffffff" stroke-width="1.8"/>`;
}
export function letterLabel(x, cy, amp, color, letter){
  return `<text x="${x-3}" y="${cy-amp-3}" font-size="9" fill="${color}" font-family="'IBM Plex Mono',monospace">${letter}</text>`;
}
export function measurementAnnotation(b, cy, px){
  if (b.ah==null && b.va==null) return '';
  let text, mid;
  if (b.ah!=null){ text = `AH ${Math.round(b.ah)}`; mid = b.ta!=null ? (b.ta + b.th)/2 : (b.th - b.ah/2); }
  else { text = `VA ${Math.round(b.va)}`; mid = (b.tv + b.ta)/2; }
  const x = mid*px;
  return `<text x="${x-14}" y="${cy+30}" font-size="9.5" fill="#9be8b4" font-family="'IBM Plex Mono',monospace">${text}</text>`;
}
export function buildContinuousPath(features, cy, width){
  features.sort((a,b) => a.xStart - b.xStart);
  let d = `M 0 ${cy}`;
  features.forEach(f => { d += ` L ${f.xStart} ${cy} ${f.cmd}`; });
  d += ` L ${width} ${cy}`;
  return d;
}

export function renderChannelTrace(ch, beats, cy, px, width){
  const CTX = state.CTX;
  const features = [];
  let overlays = '';
  let stimOverlays = ''; // aparte del resto: se agrega al final para quedar siempre por delante del trazo
  let prevTv = null; // para anotar el ciclo (ms) entre QRS consecutivos, sólo en D2
  const isFlutter = ch.kind==='surface' && beats.some(b => b.sawtooth);
  if (isFlutter) buildSawtoothTeeth(beats, px, cy).forEach(f => features.push(f));
  beats.forEach(b => {
    if (b.stimTime!=null){
      let stimChannel;
      if (CTX.site==='HRA') stimChannel = 'HRA';
      else if (CTX.site==='CSprox') stimChannel = 'CS910';
      else if (CTX.site==='CSdist') stimChannel = 'CS12';
      else if (CTX.site==='AblD') stimChannel = 'AblD';
      else stimChannel = 'VD';
      if (ch.key===stimChannel) stimOverlays += stimMark(b.stimTime*px, cy, b.label);
    }
    if (b.blocked==='local') return;
    if (ch.kind==='surface'){
      if (b.stimTime!=null){ const stimOff = b.origin==='A' ? 0 : 65; overlays += stimTickOverlay((b.stimTime-stimOff)*px, cy); }
      const retroPOverlap = classifyRetrogradePOverlap(b);
      const hideRetroP = retroPOverlap !== 'none';
      if (b.ta!=null && !b.sawtooth && !b.hiddenOnSurface && !hideRetroP){
        let pInv = b.origin==='V';
        if (ch.key==='D2' && b.origin==='A' && b.isPaced && (CTX.site==='CSprox' || CTX.site==='CSdist')) pInv = true;
        if (b.abnormalP) pInv = true;
        features.push(pWaveFeat(b.ta*px, cy, pInv, px));
      }
      const echoPCenter = b.echoVisible ? (b.surfaceP ?? b.echoTa) : null;
      const echoOverlap = classifyPQrsOverlap(echoPCenter, b);
      if (b.echoVisible && echoOverlap==='none') features.push(pWaveFeat(echoPCenter*px, cy, true, px));
      if (b.tv!=null){
        const dSign = b.hasDelta ? deltaSignForLead(b.deltaPathway, ch.key) : null;
        if (b.fusionQRS){
          features.push(qrsFusionFeat(b.tv*px, cy, px));
        } else if (b.hasDelta && dSign !== 'none'){
          features.push(preexcitedQrsFeat((b.ta+40)*px, cy, dSign, px, qrsAmplitudeScale(ch.key), deltaMorphologyForLead(b.deltaPathway, ch.key)));
        } else if (b.hasDelta && ch.key==='V1'){
          features.push(qrsShapeFeat((b.ta+75)*px, cy, px, 'rS', false));
        } else if (b.hasDelta){
          features.push(qrsFeat((b.ta+75)*px, cy, false, px));
        } else if (ch.key==='D2' && b.origin==='V' && CTX.site==='VDapex' && !b.narrow){
          features.push(qrsFeatNeg(b.tv*px, cy, px, b.qrsCoincide ? 'coincide' : true));
        } else if (ch.key==='D2' && b.origin==='V' && !b.narrow){
          features.push(qrsShapeFeat(b.tv*px, cy, px, 'Rs', b.qrsCoincide ? 'coincide' : true));
        } else if (ch.key==='V1'){
          features.push(qrsShapeFeat(b.tv*px, cy, px, 'rS', qrsWideState(b)));
        } else {
          features.push(qrsFeat(b.tv*px, cy, qrsWideState(b), px));
        }
        if (ch.key==='D2' && (retroPOverlap==='second' || echoOverlap==='second')){
          features.push(terminalNotchFeat((b.tv + qrsDurationMs(b))*px, cy, px));
        }
        if (ch.key==='D2'){
          if (prevTv!=null){
            const mid = (prevTv + b.tv)/2 * px;
            overlays += `<text x="${mid}" y="${cy-18}" font-size="9.5" fill="#6f8288" font-family="'IBM Plex Mono',monospace" text-anchor="middle">${Math.round(b.tv-prevTv)} ms</text>`;
          }
          prevTv = b.tv;
        }
      }
    } else if (ch.kind==='ablation'){
      const aT = b.egmTa ?? b.ta;
      const parahisTiming = (b.hasDelta && b.deltaPathway==='parahisian') ? PARAHISIAN_SINUS_TIMING[ch.key] : null;
      const isLeftPost = b.hasDelta && b.deltaPathway==='leftPosterior';
      const isRightPostSept = b.hasDelta && b.deltaPathway==='rightPostSeptal';
      const isRightLateral = b.hasDelta && b.deltaPathway==='rightLateral';
      const localTh = parahisTiming ? aT + parahisTiming.ah : (isLeftPost ? aT + (LEFTPOST_ABL_AV - 20) : (isRightPostSept ? aT + (RIGHTPOSTSEPT_ABL_AV - 10) : (isRightLateral ? aT + (RIGHTLATERAL_ABL_AV - 20) : b.th)));
      const localTv = parahisTiming ? localTh + parahisTiming.hv : (isLeftPost ? aT + LEFTPOST_ABL_AV : (isRightPostSept ? aT + RIGHTPOSTSEPT_ABL_AV : (isRightLateral ? aT + RIGHTLATERAL_ABL_AV : b.tv)));
      const isVDretro = b.origin==='V' && !!b.pathway;
      if (aT!=null && !isVDretro){ const x=aT*px; features.push(spikeFeat(x,cy,10,px)); overlays += letterLabel(x,cy,10,ch.color,'A'); }
      if (localTh!=null){ const x=localTh*px; overlays += hOverlay(x,cy,7) + letterLabel(x,cy,7,'#ffffff','H'); }
      if (localTv!=null){ const x=localTv*px; features.push(spikeFeat(x,cy,15,px)); overlays += letterLabel(x,cy,15,ch.color,'V'); }
      if (b.echoTa!=null){
        const echoDisplayT = b.ablationP ?? b.echoTa;
        const x=echoDisplayT*px;
        if (echoDisplayT !== b.tv && echoDisplayT !== aT) features.push(spikeFeat(x,cy,10,px));
        overlays += letterLabel(x,cy,10,'#9be8b4','A\'');
      }
      overlays += measurementAnnotation(b, cy, px);
    } else if (ch.kind==='cs'){
      const pwCfg = PATHWAY_CONFIGS[b.pathway];
      let off;
      if (pwCfg && pwCfg.csCenter != null){
        off = pwCfg.csStep * Math.abs(ch.csIdx - pwCfg.csCenter); // en V: más temprano en el centro, se abre hacia ambos lados
      } else if (pwCfg){
        const frac=(4-ch.csIdx)/4; off = pwCfg.csDistalOff + (pwCfg.csProxOff-pwCfg.csDistalOff)*frac;
      } else off = (b.label==='TRNAV' || b.noAtrialSpread) ? ch.csIdx * 2 : genericAtrialOffset('cs', ch.csIdx, b); // TRNAV: retroconducción por la vía rápida, casi simultánea — pequeño decremento real (2 ms por electrodo) del CS proximal (csIdx=0, más cerca del septo/nodo AV) al distal (csIdx=4)
      const aT = b.egmTa ?? b.ta;
      if (aT!=null) features.push(spikeFeat(aT*px + off*px, cy, 12, px));
      if (b.echoTa!=null) features.push(spikeFeat(b.echoTa*px + off*px, cy, 12, px));
      if (b.hasDelta && b.deltaPathway==='parahisian'){
        const localAV = PARAHISIAN_CS_AV[ch.csIdx] ?? 80;
        features.push(spikeFeat((aT+off+localAV)*px, cy, 5, px));
      } else if (b.hasDelta && b.deltaPathway==='leftPosterior'){
        features.push(spikeFeat((aT+off+leftPostCsAV(ch.csIdx))*px, cy, 5, px));
      } else if (b.hasDelta && b.deltaPathway==='rightPostSeptal'){
        features.push(spikeFeat((aT+off+(RIGHTPOSTSEPT_CS_AV[ch.csIdx]??10))*px, cy, 5, px));
      } else if (b.hasDelta && b.deltaPathway==='rightLateral'){
        features.push(spikeFeat((aT+off+(RIGHTLATERAL_CS_AV[ch.csIdx]??120))*px, cy, 5, px));
      } else if (b.tv!=null) features.push(spikeFeat(b.tv*px, cy, 5, px));
    } else if (ch.kind==='vd'){
      if (b.tv!=null) features.push(spikeFeat(b.tv*px, cy, 16, px));
    } else if (ch.kind==='hra'){
      const aT = b.egmTa ?? b.ta;
      const hraOwnOff = (PATHWAY_CONFIGS[b.pathway] || b.label==='TRNAV' || b.noAtrialSpread) ? 0 : genericAtrialOffset('hra', null, b);
      if (aT!=null) features.push(spikeFeat((aT+hraOwnOff)*px, cy, 14, px));
      if (b.hasDelta && b.deltaPathway==='parahisian'){
        features.push(spikeFeat((aT+hraOwnOff+PARAHISIAN_HRA_AV)*px, cy, 6, px));
      } else if (b.hasDelta && b.deltaPathway==='leftPosterior'){
        features.push(spikeFeat((aT+hraOwnOff+LEFTPOST_HRA_AV)*px, cy, 6, px));
      }
      if (b.echoTa!=null){
        const pwCfg2 = PATHWAY_CONFIGS[b.pathway];
        const hraDelay = pwCfg2 ? pwCfg2.hraOff : ((b.pathway==='left') ? 90 : hraOwnOff);
        features.push(spikeFeat((b.echoTa+hraDelay)*px, cy, 14, px));
      }
    }
  });
  const path = `<path d="${buildContinuousPath(features, cy, width)}" fill="none" stroke="${ch.color}" stroke-width="1.6"/>`;
  return path + overlays + stimOverlays;
}

export function buildSvg(beats, px, fixedDurationMs){
  let maxT = fixedDurationMs;
  if (maxT == null){
    maxT = 0;
    beats.forEach(b => { maxT = Math.max(maxT, b.ta||0, b.tv||0, b.th||0); });
    maxT += 500;
    maxT = Math.max(maxT, 900/px); // sin ancho fijo (compatibilidad): imponemos un mínimo razonable
  }
  const width = Math.round(maxT*px);
  const height = TOP_PAD + CHANNELS.length*ROW_H + 20;

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  s += `<rect width="100%" height="100%" fill="#05080a"/>`;
  for (let tms=0; tms*px<width; tms+=200){
    const x = tms*px, major = tms%1000===0;
    s += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${major?'#1c2b30':'#0f1a1d'}" stroke-width="1"/>`;
    if (major) s += `<text x="${x+4}" y="${height-6}" fill="#3d5a61" font-size="10" font-family="'IBM Plex Mono',monospace">${(tms/1000).toFixed(1)}s</text>`;
  }
  CHANNELS.forEach((ch,i) => {
    const cy = TOP_PAD + i*ROW_H + ROW_H/2;
    s += `<line x1="0" y1="${cy}" x2="${width}" y2="${cy}" stroke="#0d1518" stroke-width="1"/>`;
  });
  s += `<defs><clipPath id="revealClip"><rect id="clipRect" x="0" y="0" width="0" height="${height}"/></clipPath></defs>`;
  s += `<g clip-path="url(#revealClip)">`;
  CHANNELS.forEach((ch,i) => {
    const cy = TOP_PAD + i*ROW_H + ROW_H/2;
    s += renderChannelTrace(ch, beats, cy, px, width);
  });
  s += `</g>`;
  s += `<line id="cursorLine" x1="0" y1="0" x2="0" y2="${height}" stroke="#ffffff" stroke-width="1.5" opacity="0.85"/>`;
  s += `</svg>`;
  state.CURRENT_MAX_T = maxT;
  return s;
}
