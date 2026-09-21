import { state } from './state.js';
import { PATHWAY_CONFIGS } from './constants.js';
import {
  computeAH, computeVA, wenckPeriod,
  makeAtrialBeat, makeVentricularBeat,
  makeAtrialBeatWithAH, makeAtrialBeatBlockedWenck,
  makeVentricularBeatWithVA, makeVentricularBeatBlockedWenck,
  buildSinusOnlyBeats, makeSustainedTachyBeat,
} from './physio-model.js';

export function jetRetro11(){
  const el = document.getElementById('jetVAMode');
  return !!el && el.value === 'retro11';
}

export function buildSensedS2Cycle(startTime, p){
  // Sensado: sin tren de S1 — se sensa el ritmo real del momento (la taquicardia sostenida si la
  // hay, o el sinusal si no) y se entrega un único S2 desde el sitio elegido, sin resetear nada —
  // después del S2 se continúa en ese mismo ritmo (si estaba en taquicardia, sigue en taquicardia).
  const CTX = state.CTX;
  const beats = [];
  const isAtrialSite = (p.site==='HRA' || p.site==='CSprox' || p.site==='CSdist');
  const inTachy = state.AVNRT_INDUCED;
  const cl = inTachy ? state.AVNRT_TCL : CTX.sinusCL;
  const tachyLabel = (state.INDUCED_TYPE==='AVRT') ? 'TRAV' : 'TRNAV';
  let t = startTime, lastEventTime = startTime, lastAtrialTh = startTime;
  for (let i=0; i<8; i++){
    const b = inTachy ? makeSustainedTachyBeat(t, state.INDUCED_TYPE, tachyLabel) : makeAtrialBeat(t, cl, false, 'Sinus');
    beats.push(b);
    lastEventTime = isAtrialSite ? t : (b.tv ?? t);
    lastAtrialTh = t;
    t += cl;
  }
  const stimTime = lastEventTime + p.ci2;
  let s2Beat;
  if (isAtrialSite) s2Beat = makeAtrialBeat(stimTime, p.ci2, true, 'S2', true);
  else s2Beat = makeVentricularBeat(stimTime, p.ci2, true, 'S2', true);
  beats.push(s2Beat);

  const isTRNAVwithS2 = inTachy && state.INDUCED_TYPE==='AVNRT';
  const fresh = state.SENSED_S2_FRESH;
  state.SENSED_S2_FRESH = false;
  if (fresh) state.SENSED_CYCLE_TOKEN++;
  if (isTRNAVwithS2 && !fresh){
    // Redibujo pasivo (p.ej. cambiar el sitio de estimulación) sin haber presionado "Estimular" de
    // nuevo: no se entrega ningún S2 "de prueba" con el valor vigente — se sigue mostrando la TRNAV
    // sostenida tal cual, sin cortarla.
    const beats2 = [];
    let th = startTime;
    for (let i=0; i<10; i++){ beats2.push(makeSustainedTachyBeat(th, state.INDUCED_TYPE, tachyLabel)); th += cl; }
    return {beats: beats2, nextTime: th};
  }
  if (isTRNAVwithS2){
    // Secuencia específica: S2 (auricular o ventricular) durante TRNAV, según la prematurez
    // respecto del ciclo de la taquicardia.
    //  - < 30 ms más precoz: el intervalo AA no se modifica, la TRNAV sigue igual — si el S2 es
    //    ventricular, se disocia (no retroconduce, no muestra P asociada).
    //  - 30–40 ms más precoz: el S2 sí retroconduce, con el intervalo VA acortado 20 ms — el
    //    intervalo AA que contiene al S2 se acorta 29 ms — y se ve como QRS puro estimulado (no
    //    se fusiona con el QRS propio de la taquicardia aunque caigan cerca).
    //  - >= 40 ms más precoz: se bloquea en la aurícula (no retroconduce) y corta automáticamente
    //    la TRNAV, quedando en ritmo sinusal — recién DESPUÉS de que se vea entregado el estímulo
    //    (no en el instante de apretar "Estimular").
    const prematurity = cl - p.ci2;
    const inVAshortZone = (prematurity >= 30 && prematurity < 40);
    const terminated = (prematurity >= 40);
    let nextDelay = cl;
    if (inVAshortZone){ nextDelay = cl - 29; }
    if (!isAtrialSite && prematurity < 30){
      // Disociado: el S2 ventricular no retroconduce a la aurícula (la TRNAV sigue intacta).
      delete s2Beat.ta; delete s2Beat.th; delete s2Beat.ah; s2Beat.blocked = 'VA';
    } else if (!isAtrialSite && inVAshortZone){
      // El S2 retroconduce con VA acortado 20 ms (respecto del VA simultáneo — VA=0 — de la
      // TRNAV sostenida): la A' retrógrada cae 20 ms antes del propio QRS del S2. QRS puro
      // estimulado: no se fusiona con el latido propio de la taquicardia.
      s2Beat.va = -20;
      s2Beat.ta = s2Beat.tv - 20;
      delete s2Beat.th; delete s2Beat.ah; delete s2Beat.blocked;
      s2Beat.noFuse = true;
    } else if (!isAtrialSite && terminated){
      // Bloqueo en la aurícula: el S2 no retroconduce, y esto corta la TRNAV.
      delete s2Beat.ta; delete s2Beat.th; delete s2Beat.ah; s2Beat.blocked = 'VA';
    }
    if (terminated){
      // El corte se aplica de verdad recién cuando, en tiempo real, el cursor llega al punto donde
      // arranca el sinusal — no en el instante de presionar "Estimular" — así se ve entregado el
      // estímulo antes de que la taquicardia se dé por cortada.
      const token = state.SENSED_CYCLE_TOKEN;
      const speed = +document.getElementById('speed').value || 0.5;
      const commitAtSimMs = stimTime + nextDelay;
      setTimeout(() => {
        if (state.SENSED_CYCLE_TOKEN === token){
          state.AVNRT_INDUCED = false;
          state.OVERDRIVE_TERMINATED = true;
        }
      }, Math.max(0, commitAtSimMs / speed));
      let ts = stimTime + nextDelay;
      for (let i=0; i<3; i++){ beats.push(makeAtrialBeat(ts, CTX.sinusCL, false, 'Sinus')); ts += CTX.sinusCL; }
      return {beats, nextTime: ts};
    }
    // En la zona sin cambios (prematurity<30), el latido auricular propio de la TRNAV sigue en su
    // horario nativo (lastAtrialTh + cl), sin desplazarse por el S2 — en la zona 30-40 el intervalo
    // que lo contiene se acorta 29 ms.
    let th2 = (prematurity < 30) ? (lastAtrialTh + cl) : (lastAtrialTh + nextDelay);
    for (let i=0; i<6; i++){ beats.push(makeSustainedTachyBeat(th2, state.INDUCED_TYPE, tachyLabel)); th2 += cl; }
    // Si el QRS estimulado (S2) cae junto al QRS propio de la taquicardia (dentro de 60 ms), se
    // dibuja uno solo — salvo en la zona 30-40 (QRS puro estimulado, nunca se fusiona).
    if (!isAtrialSite && s2Beat.tv!=null && !s2Beat.noFuse){
      const coincident = beats.find(b => b!==s2Beat && b.tv!=null && Math.abs(b.tv - s2Beat.tv) <= 60);
      if (coincident){ delete coincident.tv; s2Beat.qrsCoincide = true; }
    }
    return {beats, nextTime: th2};
  }

  let resume = stimTime + Math.max(cl*1.6, 900);
  for (let i=0;i<2;i++){
    beats.push(inTachy ? makeSustainedTachyBeat(resume, state.INDUCED_TYPE, tachyLabel) : makeAtrialBeat(resume, cl, false, 'Sinus'));
    resume += cl;
  }
  return {beats, nextTime: resume};
}
export function buildOneSyncCycle(startTime, p){
  if (state.SENSING_MODE) return buildSensedS2Cycle(startTime, p);
  const CTX = state.CTX;
  const beats = [];
  const isAtrialSite = (p.site==='HRA' || p.site==='CSprox' || p.site==='CSdist');
  const wenckN = isAtrialSite ? wenckPeriod(p.s1cl, CTX.ERP, CTX.wenckAnt) : wenckPeriod(p.s1cl, CTX.VERP, CTX.wenckRetro);
  const wenckTarget = isAtrialSite ? computeAH(p.s1cl) : computeVA(p.s1cl);
  let t = startTime;
  const s1Times = [];
  for (let i=0;i<8;i++){ s1Times.push(t); t += p.s1cl; }
  const lastS1 = s1Times[s1Times.length-1];
  s1Times.forEach((stim,i) => {
    if (isAtrialSite){
      if (wenckN==null || wenckTarget==null){
        beats.push(makeAtrialBeat(stim, p.s1cl, true, 'S1'+(i+1)));
      } else {
        const pos = i % wenckN;
        if (pos === wenckN-1) beats.push(makeAtrialBeatBlockedWenck(stim, p.s1cl, 'S1'+(i+1)));
        else {
          const ah = CTX.AH0 + (wenckTarget-CTX.AH0)*((pos+1)/(wenckN-1));
          beats.push(makeAtrialBeatWithAH(stim, p.s1cl, 'S1'+(i+1), ah));
        }
      }
    } else {
      if (wenckN==null || wenckTarget==null){
        beats.push(makeVentricularBeat(stim, p.s1cl, true, 'S1'+(i+1)));
      } else {
        const pos = i % wenckN;
        if (pos === wenckN-1) beats.push(makeVentricularBeatBlockedWenck(stim, p.s1cl, 'S1'+(i+1)));
        else {
          const va = CTX.VA0 + (wenckTarget-CTX.VA0)*((pos+1)/(wenckN-1));
          beats.push(makeVentricularBeatWithVA(stim, p.s1cl, 'S1'+(i+1), va));
        }
      }
    }
  });
  const s2Time = lastS1 + p.ci2;
  let s2Beat;
  if (isAtrialSite) s2Beat = makeAtrialBeat(s2Time, p.ci2, true, 'S2', true);
  else s2Beat = makeVentricularBeat(s2Time, p.ci2, true, 'S2', true);
  beats.push(s2Beat);
  const induced = isAtrialSite && CTX.jumpEnabled && p.ci2 <= CTX.jumpCL && s2Beat.ah != null;
  if (induced){
    state.AVNRT_INDUCED = true; state.AVNRT_TCL = p.tachyCL; state.INDUCED_TYPE = state.INDUCE_TARGET;
    state.APPLIED_S1CL = p.tachyCL; // recién inducida: todavía no se está sobreestimulando
    const sustainedCL = p.tachyCL;
    if (state.INDUCE_TARGET === 'AVRT'){
      const locKey = document.getElementById('pathwayLoc').value;
      const pwCfg = PATHWAY_CONFIGS[locKey] || PATHWAY_CONFIGS.leftLateral;
      const csMinOff = (pwCfg.csCenter != null) ? 0 : Math.min(pwCfg.csDistalOff, pwCfg.csProxOff);
      const earliestOff = Math.min(csMinOff, pwCfg.hraOff, pwCfg.ablOff);
      const s2VA = (pwCfg.baseVA ?? 20) + earliestOff;
      s2Beat.echoTa = s2Beat.tv + s2VA;
      s2Beat.surfaceP = s2Beat.tv + 115;
      s2Beat.ablationP = s2Beat.tv + s2VA + pwCfg.ablOff;
      s2Beat.echoVisible = true;
      s2Beat.pathway = locKey;
      let th = s2Beat.tv + Math.max(60, sustainedCL - CTX.hv0);
      const stopAt = s2Time + Math.max(CTX.sinusCL*1.6, 2500);
      while (th < stopAt){
        const tv = th + CTX.hv0, va = (pwCfg.baseVA ?? 20) + earliestOff, echoTa = tv + va;
        const surfaceP = tv + 115, ablationP = tv + va + pwCfg.ablOff;
        beats.push({origin:'A', label:'TRAV', isPaced:false, isExtra:false, CI:sustainedCL, ah:95, th, tv, echoTa, surfaceP, ablationP, echoVisible:true, pathway:locKey});
        th += sustainedCL;
      }
      return {beats, nextTime: stopAt};
    }
    const sustainedAH = Math.max(30, sustainedCL - CTX.hv0);
    let th = s2Beat.tv + sustainedAH;
    const stopAt = s2Time + Math.max(CTX.sinusCL*1.6, 2500);
    while (th < stopAt){
      const tv = th + CTX.hv0;
      beats.push({origin:'A', label:'TRNAV', isPaced:false, isExtra:false, CI:sustainedCL, ah:sustainedAH, th, tv, echoTa:tv+35});
      th += sustainedCL;
    }
    return {beats, nextTime: stopAt};
  }
  let resume = s2Time + Math.max(CTX.sinusCL*1.6, 900);
  for (let i=0;i<2;i++){ beats.push(makeAtrialBeat(resume, CTX.sinusCL, false, 'Sinus')); resume += CTX.sinusCL; }
  return {beats, nextTime: resume};
}

export function buildTachyBeats(type, cycleMs, upToMs){
  const CTX = state.CTX;
  const beats = [];
  if (type==='AVNRT'){
    // Reentrada intranodal típica: circuito sostenido, una sola activación auricular por ciclo
    // (el eco retrógrado, simultáneo con V) — no una "A" de entrada aparte cada vez.
    let th = 0;
    while (th < upToMs){
      const ah = 165, tv = th+CTX.hv0;
      beats.push({origin:'A', label:'TRNAV', isPaced:false, isExtra:false, CI:cycleMs, ah, th, tv, echoTa:tv+35});
      th += cycleMs;
    }
  } else if (type==='AVRT'){
    // Ortodrómica por vía accesoria: circuito sostenido, una sola activación auricular por ciclo
    // (el eco retrógrado), separado de la V (a diferencia del VA simultáneo de la TRNAV).
    const locKey = document.getElementById('pathwayLoc').value;
    const pwCfg = PATHWAY_CONFIGS[locKey] || PATHWAY_CONFIGS.leftLateral;
    const csMinOff = (pwCfg.csCenter != null) ? 0 : Math.min(pwCfg.csDistalOff, pwCfg.csProxOff);
    const earliestOff = Math.min(csMinOff, pwCfg.hraOff, pwCfg.ablOff);
    let th = 0;
    while (th < upToMs){
      const ah = 95, tv = th+CTX.hv0, va = (pwCfg.baseVA ?? 20) + earliestOff, echoTa = tv+va; // el VA más corto = el sitio más temprano según la vía
      const surfaceP = tv + 115; // onda P visible en el ECG de superficie: ~45 ms después del final del QRS
      const ablationP = tv + va + pwCfg.ablOff; // catéter de ablación, según su distancia a la vía
      beats.push({origin:'A', label:'TRAV', isPaced:false, isExtra:false, CI:cycleMs, ah, th, tv, echoTa, surfaceP, ablationP, echoVisible:true, pathway:locKey});
      th += cycleMs;
    }
  } else if (type==='PJRT'){
    // Taquicardia septal de RP largo (tipo PJRT): vía accesoria posteroseptal, decremental y lenta
    // en sentido retrógrado — RP más largo que el PR, incesante. Activación septal (no eccéntrica).
    let th = 0;
    while (th < upToMs){
      const ah = 90, tv = th+CTX.hv0, va = 220, echoTa = tv+va; // VA largo: RP > PR
      const surfaceP = tv + 190; // P visible, bien alejada del QRS (RP largo)
      beats.push({origin:'A', label:'RP largo', isPaced:false, isExtra:false, CI:cycleMs, ah, th, tv, echoTa, surfaceP, echoVisible:true, pathway:'septal'});
      th += cycleMs;
    }
  } else if (type==='IRP'){
    // Taquicardia septal de RP intermedio: VA entre el corto (TRNAV/TRAV típica) y el largo (PJRT).
    let th = 0;
    while (th < upToMs){
      const ah = 90, tv = th+CTX.hv0, va = 150, echoTa = tv+va;
      const surfaceP = tv + 130;
      beats.push({origin:'A', label:'RP interm.', isPaced:false, isExtra:false, CI:cycleMs, ah, th, tv, echoTa, surfaceP, echoVisible:true, pathway:'septal'});
      th += cycleMs;
    }
  } else if (type==='JET'){
    // Taquicardia ectópica de la unión: foco automático juncional, QRS angosto, con disociación
    // A-V (la aurícula sigue su ritmo sinusal propio, habitualmente más lento que la unión).
    // Con "Retroconducción 1:1" cada latido de la unión activa la aurícula en forma simultánea con
    // el V (VA≈0), o sea que imita una TRNAV típica — por eso hace falta una maniobra para distinguirlas.
    if (jetRetro11()){
      let th = 0;
      while (th < upToMs){
        const tv = th + CTX.hv0;
        beats.push({origin:'A', label:'JET', isPaced:false, isExtra:false, CI:cycleMs, th, tv, echoTa:tv+35, noAtrialSpread:true});
        th += cycleMs;
      }
      return beats;
    }
    let t = 0;
    const jetBeats = [];
    while (t < upToMs){
      jetBeats.push({origin:'V', label:'JET', isPaced:false, isExtra:false, CI:cycleMs, tv:t, blocked:'VA', narrow:true});
      t += cycleMs;
    }
    let ts = 0;
    const sinusCLUsed = CTX.sinusCL * 1.037;
    while (ts < upToMs){
      const hiddenOnSurface = jetBeats.some(v => ts >= v.tv - 5 && ts <= v.tv + 75);
      beats.push({origin:'A', label:'Sinus', isPaced:false, isExtra:false, CI:CTX.sinusCL, ta:ts, hiddenOnSurface});
      ts += sinusCLUsed;
    }
    beats.push(...jetBeats);
  } else if (type==='AT'){
    // Foco auricular ectópico con conducción AV normal (decremental habitual).
    let t = 0;
    while (t < upToMs){
      const ah = computeAH(cycleMs) ?? CTX.AH0, th = t+ah, tv = th+CTX.hv0;
      beats.push({origin:'A', label:'TA', isPaced:false, isExtra:false, CI:cycleMs, ta:t, ah, th, tv, abnormalP:true});
      t += cycleMs;
    }
  } else if (type==='AFL'){
    // Flutter auricular con conducción 2:1 — el ciclo auricular es la mitad del ciclo de la
    // taquicardia (que representa el ciclo ventricular/clínicamente visible).
    const atrialCL = cycleMs/2;
    const sawAhVal = computeAH(atrialCL) ?? CTX.AH0;
    let t = 0, i = 0;
    while (t < upToMs){
      const egmTa = t + atrialCL/2; // el EGM intracavitario se marca en la mitad de la onda, no en el borde
      if (i % 2 === 0){
        const ah = sawAhVal, th = t+ah, tv = th+CTX.hv0;
        beats.push({origin:'A', label:'F', isPaced:false, isExtra:false, CI:atrialCL, ta:t, egmTa, ah, th, tv, sawtooth:true, sawAh:sawAhVal});
      } else {
        beats.push({origin:'A', label:'F', isPaced:false, isExtra:false, CI:atrialCL, ta:t, egmTa, blocked:'AV', sawtooth:true, sawAh:sawAhVal});
      }
      t += atrialCL; i++;
    }
  } else if (type==='VT'){
    // Origen ventricular, QRS ancho, con bloqueo V-A (disociación): la aurícula sigue su
    // propio ritmo sinusal, más lento e independiente del ritmo ventricular.
    let t = 0;
    const vtBeats = [];
    while (t < upToMs){
      vtBeats.push({origin:'V', label:'VT', isPaced:false, isExtra:false, CI:cycleMs, tv:t, blocked:'VA'});
      t += cycleMs;
    }
    let ts = 0;
    const sinusCLUsed = CTX.sinusCL * 1.037; // pequeño desfasaje: evita que quede enganchada en armónico exacto con el ciclo de la TV
    while (ts < upToMs){
      // Si la P disociada coincide con un QRS ancho, se oculta en el ECG de superficie —
      // pero sigue viéndose en los catéteres intracavitarios (AD alta, SC, ablación).
      const hiddenOnSurface = vtBeats.some(v => ts >= v.tv - 5 && ts <= v.tv + 135);
      beats.push({origin:'A', label:'Sinus', isPaced:false, isExtra:false, CI:CTX.sinusCL, ta:ts, hiddenOnSurface});
      ts += sinusCLUsed;
    }
    beats.push(...vtBeats);
  }
  return beats;
}
export function buildAVNRTInduction(p, extraMs){
  // TRNAV típica: arranca en ritmo sinusal. El usuario programa el tren S1S1 + extraestímulo S2;
  // si el S2 cae en la zona de "salto de vía" (con el salto activado), el AH salta a la vía lenta
  // y se induce la taquicardia sostenida a partir de ahí. Si no, vuelve a ritmo sinusal.
  const CTX = state.CTX;
  const beats = [];
  let t = 0;
  for (let i=0; i<3; i++){ beats.push(makeAtrialBeat(t, CTX.sinusCL, false, 'Sinus')); t += CTX.sinusCL; }
  const s1Times = [];
  for (let i=0; i<8; i++){ s1Times.push(t); t += p.s1cl; }
  s1Times.forEach((stim,i) => {
    const beat = makeAtrialBeat(stim, p.s1cl, true, 'S1'+(i+1));
    delete beat.echoTa; // el tren nunca muestra eco: un solo A por cada V
    beats.push(beat);
  });
  const lastS1 = s1Times[s1Times.length-1];
  const s2Time = lastS1 + p.ci2;
  const s2Beat = makeAtrialBeat(s2Time, p.ci2, true, 'S2', true);
  beats.push(s2Beat);

  const induced = CTX.jumpEnabled && p.ci2 <= CTX.jumpCL && s2Beat.ah != null;
  if (induced){ state.AVNRT_INDUCED = true; state.AVNRT_TCL = p.tachyCL; state.INDUCED_TYPE = p.tachyType; state.APPLIED_S1CL = p.tachyCL; }
  let totalMs;
  if (induced && p.tachyType==='AVRT'){
    const locKey = document.getElementById('pathwayLoc').value;
    const pwCfg = PATHWAY_CONFIGS[locKey] || PATHWAY_CONFIGS.leftLateral;
    const csMinOff = (pwCfg.csCenter != null) ? 0 : Math.min(pwCfg.csDistalOff, pwCfg.csProxOff);
    const earliestOff = Math.min(csMinOff, pwCfg.hraOff, pwCfg.ablOff);
    const sustainedCL = p.tachyCL;
    // El propio S2 que induce ya muestra la retroconducción por la vía seleccionada (no solo los
    // latidos sostenidos que le siguen).
    const s2VA = (pwCfg.baseVA ?? 20) + earliestOff;
    s2Beat.echoTa = s2Beat.tv + s2VA;
    s2Beat.surfaceP = s2Beat.tv + 115;
    s2Beat.ablationP = s2Beat.tv + s2VA + pwCfg.ablOff;
    s2Beat.echoVisible = true;
    s2Beat.pathway = locKey;
    const ahFirst = Math.max(60, sustainedCL - CTX.hv0);
    let th = s2Beat.tv + ahFirst;
    const stopAt = s2Beat.tv + extraMs;
    while (th < stopAt){
      const tv = th + CTX.hv0, va = (pwCfg.baseVA ?? 20) + earliestOff, echoTa = tv + va;
      const surfaceP = tv + 115, ablationP = tv + va + pwCfg.ablOff;
      beats.push({origin:'A', label:'TRAV', isPaced:false, isExtra:false, CI:sustainedCL, ah:95, th, tv, echoTa, surfaceP, ablationP, echoVisible:true, pathway:locKey});
      th += sustainedCL;
    }
    totalMs = stopAt;
  } else if (induced){
    // El ciclo de la taquicardia sostenida es configurable (p.tachyCL), no derivado del AH del S2.
    const sustainedCL = p.tachyCL, sustainedAH = Math.max(30, sustainedCL - CTX.hv0);
    // El eco de S2 (VA simultáneo, dentro de su propio QRS) dispara el reingreso: el próximo H
    // llega recién tras conducir por la vía lenta, no en el mismo instante que ese eco.
    s2Beat.echoTa = s2Beat.tv + 35;
    let th = s2Beat.tv + sustainedAH;
    const stopAt = s2Beat.tv + extraMs;
    while (th < stopAt){
      const tv = th + CTX.hv0;
      beats.push({origin:'A', label:'TRNAV', isPaced:false, isExtra:false, CI:sustainedCL, ah:sustainedAH, th, tv, echoTa:tv+35});
      th += sustainedCL;
    }
    totalMs = stopAt;
  } else {
    let resume = s2Time + Math.max(CTX.sinusCL*1.6, 900);
    const stopAt = s2Time + extraMs;
    while (resume < stopAt){ beats.push(makeAtrialBeat(resume, CTX.sinusCL, false, 'Sinus')); resume += CTX.sinusCL; }
    totalMs = stopAt;
  }
  return {beats, totalMs, induced};
}
export function buildS1InducedAVNRT(p, upToMs){
  // S1S1 continuo a ciclo suficientemente corto: tras unos latidos de tren, el nodo AV
  // conduce por la vía lenta y queda inducida la TRNAV sostenida — sin necesidad de extraestímulo.
  const CTX = state.CTX;
  const beats = [];
  let t = 0;
  const leadIn = 8;
  let lastBeat = null;
  for (let i=0; i<leadIn; i++){
    const beat = makeAtrialBeat(t, p.s1cl, true, 'S1'+(i+1));
    if (i < leadIn-1 || state.INDUCE_TARGET==='AVRT') delete beat.echoTa; // los primeros 7 no muestran eco (A simultánea con V); en TRAV, tampoco el 8vo
    beats.push(beat);
    if (beat.tv != null) lastBeat = beat;
    t += p.s1cl;
  }
  if (!lastBeat){
    // Ningún latido del tren condujo: no hay forma de inducir, seguir con pacing normal
    while (t < upToMs){ beats.push(makeAtrialBeat(t, p.s1cl, true, 'S1')); t += p.s1cl; }
    return beats;
  }
  // Ciclo sostenido = el programado en "Ciclo de la taquicardia", igual que con el otro método de
  // inducción (no el que resultaría de la conducción natural al ritmo de estimulación).
  const sustainedCL = +document.getElementById('tachyCL').value;
  state.AVNRT_INDUCED = true;
  state.AVNRT_TCL = sustainedCL;
  state.INDUCED_TYPE = state.INDUCE_TARGET;
  state.APPLIED_S1CL = sustainedCL; // recién inducida: todavía no se está sobreestimulando
  if (state.INDUCE_TARGET === 'AVRT'){
    const locKey = document.getElementById('pathwayLoc').value;
    const pwCfg = PATHWAY_CONFIGS[locKey] || PATHWAY_CONFIGS.leftLateral;
    const csMinOff = (pwCfg.csCenter != null) ? 0 : Math.min(pwCfg.csDistalOff, pwCfg.csProxOff);
    const earliestOff = Math.min(csMinOff, pwCfg.hraOff, pwCfg.ablOff);
    // El último S1 (el que dispara la reentrada) ya muestra la retroconducción por la vía
    // seleccionada, no solo los latidos sostenidos que le siguen.
    const s1VA = (pwCfg.baseVA ?? 20) + earliestOff;
    lastBeat.echoTa = lastBeat.tv + s1VA;
    lastBeat.surfaceP = lastBeat.tv + 115;
    lastBeat.ablationP = lastBeat.tv + s1VA + pwCfg.ablOff;
    lastBeat.echoVisible = true;
    lastBeat.pathway = locKey;
    const ahFirst = Math.max(60, sustainedCL - CTX.hv0); // el primer latido sostenido respeta el ciclo (no queda pegado al último S1)
    let th = lastBeat.tv + ahFirst;
    while (th < upToMs){
      const tv = th + CTX.hv0, va = (pwCfg.baseVA ?? 20) + earliestOff, echoTa = tv + va;
      const surfaceP = tv + 115, ablationP = tv + va + pwCfg.ablOff;
      beats.push({origin:'A', label:'TRAV', isPaced:false, isExtra:false, CI:sustainedCL, ah:95, th, tv, echoTa, surfaceP, ablationP, echoVisible:true, pathway:locKey});
      th += sustainedCL;
    }
    return beats;
  }
  const sustainedAH = Math.max(30, sustainedCL - CTX.hv0);
  // Mismo criterio: el eco del último S1 dispara el reingreso, y el próximo H llega tras
  // conducir por la vía lenta, no en el mismo instante que ese eco.
  let th = lastBeat.tv + sustainedAH;
  while (th < upToMs){
    const tv = th + CTX.hv0;
    beats.push({origin:'A', label:'TRNAV', isPaced:false, isExtra:false, CI:sustainedCL, ah:sustainedAH, th, tv, echoTa:tv+35});
    th += sustainedCL;
  }
  return beats;
}
export function buildOverdriveTermination(p, upToMs, TCL, stopAtMs, continuePacing){
  // Sobreestimulación auricular continua durante TRNAV sostenida: corta la taquicardia apenas se
  // estimula ≥20 ms más rápido que la TCL. Entre 20 y 50 ms más rápido: Wenckebach anterógrado 3:2.
  // Más de 50 ms más rápido: bloqueo AV 2:1. Si se pasa stopAtMs, a partir de ese instante la serie
  // continúa — con ritmo sinusal si se presionó "Detener" (ya no se está paceando), o con captura
  // auricular 1:1 al ritmo de estimulación si `continuePacing` es true (el corte fue automático,
  // en pleno "Estimular", y la estimulación en sí sigue activa hasta que se presione "Detener").
  const CTX = state.CTX;
  const beats = [];
  const fasterBy = TCL - p.s1cl;
  const veryFast = fasterBy > 100; // zona extrema: la P vuelve a caer delante del QRS con AV de 30 ms
  const wenckN = fasterBy > 50 ? 2 : 3; // 2:1 más allá de 50 ms más rápido, 3:2 entre 20 y 50 ms
  // El AH de base es el mismo que tenía la TRNAV al inducirse (TCL - HV), con una prolongación
  // moderada (hasta 40 ms extra) a medida que se estimula más rápido dentro de la zona de Wenckebach —
  // así la aurícula le sigue ganando claramente al QRS, con un intervalo AH parecido al de la inducción.
  const baselineAH = Math.max(30, TCL - CTX.hv0);
  const prolongFrac = Math.min(1, Math.max(0, fasterBy/50));
  const target = baselineAH + 40*prolongFrac;
  const stimStop = (stopAtMs!=null) ? stopAtMs : upToMs;
  // El ciclo se mide QRS a QRS (como en un registro real), espaciados exactamente al ritmo de
  // estimulación (p.s1cl). La P se calcula hacia atrás desde cada QRS, así siempre cae claramente
  // antes del QRS (nunca después ni encima), con una separación AV parecida a la de la inducción.
  let tv = target + CTX.hv0, i = 0;
  while (tv - target - CTX.hv0 < stimStop){
    const pos = i % wenckN;
    let beat;
    if (pos === wenckN-1){
      beat = {origin:'A', label:'S1'+(i+1), isPaced:true, isExtra:false, CI:p.s1cl, ta:tv, stimTime:tv, blocked:'AV', noAtrialSpread:true};
    } else if (veryFast){
      const ta = tv - 30 - CTX.hv0;
      beat = {origin:'A', label:'S1'+(i+1), isPaced:true, isExtra:false, CI:p.s1cl, ta, stimTime:ta, ah:30, th:ta+30, tv, noAtrialSpread:true};
    } else {
      const ah = baselineAH + (target-baselineAH)*((pos+1)/(wenckN-1));
      const ta = tv - ah - CTX.hv0;
      beat = {origin:'A', label:'S1'+(i+1), isPaced:true, isExtra:false, CI:p.s1cl, ta, stimTime:ta, ah, th:ta+ah, tv, noAtrialSpread:true};
    }
    delete beat.echoTa; // estos latidos nunca muestran eco: un solo A por cada V
    beats.push(beat);
    tv += p.s1cl; i++;
  }
  if (stopAtMs != null){
    let ts = stopAtMs;
    if (continuePacing){
      // El corte fue automático mientras se seguía estimulando (no se presionó "Detener"): la
      // aurícula queda capturada 1:1 al ritmo de estimulación — no vuelve sola a ritmo sinusal.
      while (ts < upToMs){
        const beat = makeAtrialBeat(ts, p.s1cl, true, 'S1');
        delete beat.echoTa; // captura 1:1 ya establecida: sin eco retrógrado
        beats.push(beat);
        ts += p.s1cl;
      }
    } else {
      // Corte manual en un instante puntual (se presionó "Detener"): sigue con ritmo sinusal a
      // partir de ahí, en la misma serie continua (sin reiniciar el polígrafo).
      while (ts < upToMs){ beats.push(makeAtrialBeat(ts, CTX.sinusCL, false, 'Sinus')); ts += CTX.sinusCL; }
    }
  }
  // Sin corte manual: la sobreestimulación (Wenckebach 3:2 o 2:1) sigue en forma continua mientras
  // se la siga pacenado — no se autolimita a un número de latidos ni corta sola ni marca
  // OVERDRIVE_TERMINATED.
  // La P se oculta en el ECG de superficie SOLO si realmente se solapa con SU PROPIO QRS (el de ese
  // mismo latido, no el de uno vecino) — sigue viéndose en los catéteres intracavitarios.
  const P_HALF = 40; // ancho de la onda P (pWaveFeat)
  const QRS_WIDTH = 70; // ancho del QRS angosto (conducción normal, qrsFeat) — tv es su inicio
  beats.forEach(b => {
    if (b.ta == null || b.tv == null || veryFast) return; // zona extrema: la P siempre se ve, delante del QRS con AV=30 ms
    const pStart = b.ta - P_HALF, pEnd = b.ta + P_HALF;
    const qStart = b.tv, qEnd = b.tv + QRS_WIDTH;
    const overlap = Math.min(pEnd, qEnd) - Math.max(pStart, qStart);
    if (overlap > 0) b.hiddenOnSurface = true; // cualquier solapamiento, por mínimo que sea
  });
  return beats;
}
export function buildFailedInductionCapture(p, upToMs){
  // Estimulando demasiado rápido para inducir (más de 30 ms por fuera de la ventana de inducción,
  // tanto para TRNAV como para TRAV): captura 1:1 normal, sin arritmia, y pasa a ritmo sinusal en
  // forma estable e inmediata tras el tren programado (Nº S1) — sin reiniciar el polígrafo. El AH
  // de captura queda fijo y seguro (no depende del período refractario) para garantizar 1:1 limpio.
  const CTX = state.CTX;
  state.OVERDRIVE_TERMINATED = true;
  const beats = [];
  const n = Math.max(1, p.n || 8);
  const ah = Math.max(30, Math.min(CTX.AH0, p.s1cl - 40));
  let t = state.elapsedMs;
  for (let i=0; i<n; i++){
    const tv = t + ah + CTX.hv0;
    beats.push({origin:'A', label:'S1'+(i+1), isPaced:true, isExtra:false, CI:p.s1cl, ta:t, ah, th:t+ah, tv});
    t += p.s1cl;
  }
  let ts = t;
  while (ts < upToMs){ beats.push(makeAtrialBeat(ts, CTX.sinusCL, false, 'Sinus')); ts += CTX.sinusCL; }
  return beats;
}
export function buildAVRTOverdriveCapture(p, upToMs){
  // Sobreestimulación auricular ≥30 ms más rápida que la TRAV: el estímulo auricular captura de
  // inmediato al ventrículo (conducción antegrada normal), y el EGM auricular retroconducido por
  // la vía desaparece de inmediato (no gradual, a diferencia del Wenckebach de la TRNAV). Tras el
  // tren programado (Nº S1), pasa a ritmo sinusal — la taquicardia queda cortada, en forma definitiva.
  // El tren arranca justo en el instante actual (no en 0), para no generar un salto en el trazado.
  // Si el ciclo de estimulación cae en o por debajo de 260 ms (cerca del período refractario), la
  // conducción 1:1 fallaría (solo P sin QRS) — en ese caso se muestra un bloqueo AV 2:1 limpio en
  // vez de bloqueo completo, y la taquicardia igual queda cortada.
  const CTX = state.CTX;
  state.OVERDRIVE_TERMINATED = true;
  const beats = buildTachyBeats('AVRT', state.AVNRT_TCL, state.elapsedMs);
  const n = Math.max(1, p.n || 8);
  const force2to1 = p.s1cl <= 260 || p.s1cl <= CTX.ERP;
  let t = state.elapsedMs;
  if (force2to1){
    const refCL = Math.max(p.s1cl, CTX.ERP + 15);
    const ah = computeAH(refCL) ?? CTX.AH0 + 30;
    for (let i=0; i<n; i++){
      if (i % 2 === 1) beats.push(makeAtrialBeatBlockedWenck(t, p.s1cl, 'S1'+(i+1)));
      else {
        const beat = makeAtrialBeatWithAH(t, p.s1cl, 'S1'+(i+1), ah);
        delete beat.echoTa;
        beats.push(beat);
      }
      t += p.s1cl;
    }
  } else {
    for (let i=0; i<n; i++){
      const beat = makeAtrialBeat(t, p.s1cl, true, 'S1'+(i+1));
      delete beat.echoTa; // captura inmediata: sin eco retrógrado
      beats.push(beat);
      t += p.s1cl;
    }
  }
  let ts = t;
  while (ts < upToMs){ beats.push(makeAtrialBeat(ts, CTX.sinusCL, false, 'Sinus')); ts += CTX.sinusCL; }
  return beats;
}
export function resolveSustainedTachyBeats(p){
  // Hay una taquicardia sostenida (AVNRT_INDUCED). Se compara contra el ciclo REALMENTE
  // comprometido al presionar "Estimular" (APPLIED_S1CL) — no el valor que esté escrito ahora
  // mismo en el campo Ciclo S1, que puede haberse tocado sin volver a apretar el botón — y si
  // alcanza para cortarla, el corte se aplica ya (Wenckebach/2:1 y unos pocos latidos después
  // pasa a captura auricular 1:1 (sigue estimulando: no vuelve solo a sinusal), sin esperar a que
  // se presione "Detener estimulación".
  if (state.INDUCED_TYPE==='AVNRT' && state.APPLIED_S1CL <= state.AVNRT_TCL - 20){
    const pApplied = {...p, s1cl: state.APPLIED_S1CL};
    const cutAt = state.APPLIED_S1CL * 3; // deja ver un ciclo completo de Wenckebach/2:1 antes de cortar
    state.AVNRT_INDUCED = false;
    state.OVERDRIVE_TERMINATED = true;
    return buildOverdriveTermination(pApplied, state.SWEEP_MS + 500, state.AVNRT_TCL, cutAt, true);
  }
  if (state.INDUCED_TYPE==='AVRT' && state.APPLIED_S1CL < state.AVNRT_TCL - 30){
    const pApplied = {...p, s1cl: state.APPLIED_S1CL};
    state.AVNRT_INDUCED = false; // buildAVRTOverdriveCapture ya marca OVERDRIVE_TERMINATED por su cuenta
    return buildAVRTOverdriveCapture(pApplied, state.SWEEP_MS + 500);
  }
  // Ya inducida y el ciclo comprometido no alcanza para cortarla: sigue sostenida, sin repetir el
  // tren cada vuelta.
  return buildTachyBeats(state.INDUCED_TYPE, state.AVNRT_TCL, state.SWEEP_MS + 500);
}
export function buildAsyncLapBeats(p){
  const CTX = state.CTX;
  if (state.OVERDRIVE_TERMINATED) return buildSinusOnlyBeats(state.SWEEP_MS + 500);
  const isAtrialSite = (p.site==='HRA' || p.site==='CSprox' || p.site==='CSdist');
  if (isAtrialSite && state.AVNRT_INDUCED){
    return resolveSustainedTachyBeats(p);
  }
  // Nota: dentro de la ventana de inducción (s1InductionCL-30 a s1InductionCL) ya NO se induce
  // automáticamente mientras se sigue estimulando — captura 1:1 en forma continua, y la inducción
  // (el último S1 disparando la reentrada, con la activación retroconducida) ocurre recién al
  // presionar "Detener estimulación" (ver stopStimulation).
  const beats = [];
  const force2to1 = p.s1cl <= (isAtrialSite ? CTX.ERP : CTX.VERP); // solo al llegar al PRE (bloqueo
                                                                    // completo matemático): se muestra
                                                                    // un 2:1 estable en vez de asistolia,
                                                                    // sin pisar el Wenckebach progresivo
                                                                    // real por encima del PRE.
  let wenckN, wenckTarget;
  if (force2to1){
    wenckN = 2;
    const refCL = isAtrialSite ? Math.max(p.s1cl, CTX.ERP+15) : Math.max(p.s1cl, CTX.VERP+15);
    wenckTarget = isAtrialSite ? (computeAH(refCL) ?? CTX.AH0+30) : (computeVA(refCL) ?? CTX.VA0+30);
  } else {
    wenckN = isAtrialSite ? wenckPeriod(p.s1cl, CTX.ERP, CTX.wenckAnt) : wenckPeriod(p.s1cl, CTX.VERP, CTX.wenckRetro);
    wenckTarget = isAtrialSite ? computeAH(p.s1cl) : computeVA(p.s1cl);
  }
  let t = 0, i = 0;
  while (t < state.SWEEP_MS + 500){
    const stim = t;
    let beat;
    if (isAtrialSite){
      if (wenckN==null || wenckTarget==null){
        beat = makeAtrialBeat(stim, p.s1cl, true, 'S1'+(i+1));
      } else {
        const pos = i % wenckN;
        if (pos === wenckN-1) beat = makeAtrialBeatBlockedWenck(stim, p.s1cl, 'S1'+(i+1));
        else {
          const ah = CTX.AH0 + (wenckTarget-CTX.AH0)*((pos+1)/(wenckN-1));
          beat = makeAtrialBeatWithAH(stim, p.s1cl, 'S1'+(i+1), ah);
        }
      }
    } else {
      if (wenckN==null || wenckTarget==null){
        beat = makeVentricularBeat(stim, p.s1cl, true, 'S1'+(i+1));
      } else {
        const pos = i % wenckN;
        if (pos === wenckN-1) beat = makeVentricularBeatBlockedWenck(stim, p.s1cl, 'S1'+(i+1));
        else {
          const va = CTX.VA0 + (wenckTarget-CTX.VA0)*((pos+1)/(wenckN-1));
          beat = makeVentricularBeatWithVA(stim, p.s1cl, 'S1'+(i+1), va);
        }
      }
    }
    beats.push(beat);
    if (beat.origin === 'A'){
      delete beat.echoTa; // mientras se sigue estimulando desde la aurícula: solo la aurícula
                           // estimulada, nunca el eco retroconducido — ese solo aparece en el
                           // último latido, al detener. (No aplica a la estimulación ventricular:
                           // ahí el eco es la retroconducción real por la vía, latido a latido.)
    }
    t += p.s1cl; i++;
  }
  return beats;
}
export function buildTachyCutAtInstant(type, cycleMs, upToMs, stopAtMs){
  // Genera la taquicardia sostenida (TRNAV o TRAV) normalmente hasta el instante del corte, y
  // continúa con ritmo sinusal desde ahí — sin reiniciar el polígrafo ni mostrar latidos residuales.
  const beats = buildTachyBeats(type, cycleMs, stopAtMs);
  // El primer latido sinusal respeta el ciclo sinusal desde el último latido ya mostrado — no
  // arranca pegado al instante exacto del clic, que podría caer justo después de ese latido y
  // mostrar dos latidos casi simultáneos.
  const last = beats[beats.length-1];
  const lastT = last ? (last.ta ?? last.th ?? last.tv ?? stopAtMs) : stopAtMs;
  let ts = Math.max(stopAtMs, lastT + state.CTX.sinusCL);
  while (ts < upToMs){ beats.push(makeAtrialBeat(ts, state.CTX.sinusCL, false, 'Sinus')); ts += state.CTX.sinusCL; }
  return beats;
}
export function buildAsyncCutAtInstant(p, upToMs, stopAtMs){
  // Conserva el pacing (con o sin Wenckebach) tal cual se venía viendo hasta el instante del
  // corte, y continúa con ritmo sinusal desde ahí — sin reiniciar el polígrafo.
  const beats = buildAsyncLapBeats(p).filter(b => {
    const t0 = b.stimTime ?? b.ta ?? b.tv;
    return t0 != null && t0 < stopAtMs;
  });
  // Igual que arriba: el primer latido sinusal espera un ciclo sinusal completo desde el último
  // latido estimulado ya mostrado, para no caer casi encima de él.
  const last = beats[beats.length-1];
  const lastT = last ? (last.stimTime ?? last.ta ?? last.tv ?? stopAtMs) : stopAtMs;
  let ts = Math.max(stopAtMs, lastT + state.CTX.sinusCL);
  while (ts < upToMs){ beats.push(makeAtrialBeat(ts, state.CTX.sinusCL, false, 'Sinus')); ts += state.CTX.sinusCL; }
  return beats;
}
export function buildInductionAtInstant(p, upToMs, stopAtMs){
  // Se estaba paceando 1:1 a un ciclo dentro de la ventana de inducción; al presionar "Detener",
  // el último S1 entregado (justo en el instante del corte) es el que dispara la reentrada,
  // mostrando ahí la activación auricular retroconducida — y de ahí en más sigue en taquicardia
  // sostenida, sin reiniciar el polígrafo.
  const CTX = state.CTX;
  const beats = buildAsyncLapBeats(p).filter(b => {
    const t0 = b.stimTime ?? b.ta ?? b.tv;
    return t0 != null && t0 < stopAtMs;
  });
  let lastBeat = null;
  for (let i=beats.length-1; i>=0; i--){ if (beats[i].tv!=null){ lastBeat = beats[i]; break; } }
  if (!lastBeat) return beats; // no hubo ningún latido capturado: no hay nada que dispare
  const sustainedCL = +document.getElementById('tachyCL').value;
  state.AVNRT_INDUCED = true;
  state.AVNRT_TCL = sustainedCL;
  state.INDUCED_TYPE = state.INDUCE_TARGET;
  // Recién inducida: todavía no se está sobreestimulando. Ya no hace falta forzar el campo Ciclo
  // S1 al valor sostenido (como antes) — el chequeo de sobreestimulación compara contra
  // APPLIED_S1CL, que solo se actualiza al presionar "Estimular", así que un valor rápido que haya
  // quedado en el campo (el mismo que se usó para inducir) no se interpreta como pacing en curso.
  state.APPLIED_S1CL = sustainedCL;
  if (state.INDUCE_TARGET === 'AVRT'){
    const locKey = document.getElementById('pathwayLoc').value;
    const pwCfg = PATHWAY_CONFIGS[locKey] || PATHWAY_CONFIGS.leftLateral;
    const csMinOff = (pwCfg.csCenter != null) ? 0 : Math.min(pwCfg.csDistalOff, pwCfg.csProxOff);
    const earliestOff = Math.min(csMinOff, pwCfg.hraOff, pwCfg.ablOff);
    const s1VA = (pwCfg.baseVA ?? 20) + earliestOff;
    lastBeat.echoTa = lastBeat.tv + s1VA;
    lastBeat.surfaceP = lastBeat.tv + 115;
    lastBeat.ablationP = lastBeat.tv + s1VA + pwCfg.ablOff;
    lastBeat.echoVisible = true;
    lastBeat.pathway = locKey;
    const ahFirst = Math.max(60, sustainedCL - CTX.hv0);
    let th = lastBeat.tv + ahFirst;
    while (th < upToMs){
      const tv = th + CTX.hv0, va = (pwCfg.baseVA ?? 20) + earliestOff, echoTa = tv + va;
      const surfaceP = tv + 115, ablationP = tv + va + pwCfg.ablOff;
      beats.push({origin:'A', label:'TRAV', isPaced:false, isExtra:false, CI:sustainedCL, ah:95, th, tv, echoTa, surfaceP, ablationP, echoVisible:true, pathway:locKey});
      th += sustainedCL;
    }
    return beats;
  }
  if (state.INDUCE_TARGET === 'AT'){
    // Foco automático/ectópico auricular: a diferencia de la reentrada (que salta de golpe al
    // ciclo sostenido), el foco se "calienta" progresivamente — el ciclo se acorta latido a latido
    // desde el ciclo del propio tren S1S1 hasta el ciclo propio del foco (tachyCL), en vez de
    // aparecer de una vez a ciclo fijo. Es el rasgo clásico que distingue una TA automática de una
    // reentrada (TRNAV/TRAV saltan; una TA automática "calienta").
    const lastCL = lastBeat.CI || sustainedCL;
    const warmupBeats = 5;
    let prevTa = lastBeat.ta;
    for (let i=1; i<=warmupBeats; i++){
      const cl = lastCL + (sustainedCL - lastCL) * (i/warmupBeats);
      const ta = prevTa + cl;
      const ah = computeAH(cl) ?? CTX.AH0, th = ta+ah, tv = th+CTX.hv0;
      beats.push({origin:'A', label:'TA', isPaced:false, isExtra:false, CI:cl, ta, ah, th, tv, abnormalP:true});
      prevTa = ta;
    }
    let t = prevTa + sustainedCL;
    while (t < upToMs){
      const ah = computeAH(sustainedCL) ?? CTX.AH0, th = t+ah, tv = th+CTX.hv0;
      beats.push({origin:'A', label:'TA', isPaced:false, isExtra:false, CI:sustainedCL, ta:t, ah, th, tv, abnormalP:true});
      t += sustainedCL;
    }
    return beats;
  }
  if (state.INDUCE_TARGET === 'JET'){
    // Foco automático de la unión (solo con isoproterenol): igual que la TAE, se "calienta" desde el
    // ciclo del tren hasta su ciclo propio. Con retroconducción 1:1 cada latido activa V y A juntos
    // (imita TRNAV); con disociación VA la aurícula sigue su ritmo sinusal aparte.
    const lastCL = lastBeat.CI || sustainedCL;
    const warmupBeats = 5;
    const clAt = i => lastCL + (sustainedCL - lastCL) * (Math.min(i, warmupBeats)/warmupBeats);
    if (jetRetro11()){
      let th = lastBeat.th ?? (lastBeat.tv - CTX.hv0);
      for (let i=1; th < upToMs; i++){
        const cl = clAt(i);
        th += cl;
        const tv = th + CTX.hv0;
        beats.push({origin:'A', label:'JET', isPaced:false, isExtra:false, CI:cl, th, tv, echoTa:tv+35, noAtrialSpread:true});
      }
      return beats;
    }
    const jetBeats = [];
    let tv = lastBeat.tv;
    for (let i=1; tv < upToMs; i++){
      const cl = clAt(i);
      tv += cl;
      jetBeats.push({origin:'V', label:'JET', isPaced:false, isExtra:false, CI:cl, tv, blocked:'VA', narrow:true});
    }
    const sinusStep = CTX.sinusCL * 1.037;
    for (let ts = lastBeat.ta + CTX.sinusCL; ts < upToMs; ts += sinusStep){
      const hiddenOnSurface = jetBeats.some(v => ts >= v.tv - 5 && ts <= v.tv + 75);
      beats.push({origin:'A', label:'Sinus', isPaced:false, isExtra:false, CI:CTX.sinusCL, ta:ts, hiddenOnSurface});
    }
    beats.push(...jetBeats);
    return beats;
  }
  const sustainedAH = Math.max(30, sustainedCL - CTX.hv0);
  lastBeat.echoTa = lastBeat.tv + 35; // el eco del último S1 (VA simultáneo, dentro del QRS) dispara el reingreso
  delete lastBeat.blocked;
  let th = lastBeat.tv + sustainedAH;
  while (th < upToMs){
    const tv = th + CTX.hv0;
    beats.push({origin:'A', label:'TRNAV', isPaced:false, isExtra:false, CI:sustainedCL, ah:sustainedAH, th, tv, echoTa:tv+35});
    th += sustainedCL;
  }
  return beats;
}
