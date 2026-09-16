// Estado mutable compartido por todo el simulador. Todos los módulos leen y escriben estas
// propiedades a través del mismo objeto (en vez de variables sueltas), para poder repartir la
// lógica en varios archivos ES module sin perder la mutabilidad cruzada que tenía el script único.
export const state = {
  // Parámetros fisiológicos vigentes (recalculados en cada vuelta de barrido) + sitio/S1 activos.
  CTX: {},

  // Escala y duración de la vuelta de barrido actual.
  CURRENT_MAX_T: 0,
  CURRENT_PX: 0.45,
  SWEEP_MS: 6000,

  // Reproducción (animación tipo monitor).
  playing: false,
  rafId: null,
  elapsedMs: 0,
  lastTs: null,
  loopTimeoutId: null,

  // Modo de estimulación activo y sensado.
  activeMode: 'ASYNC', // 'ASYNC' | 'SYNC' | 'MODELS'
  SENSING_MODE: false,
  SENSED_S2_FRESH: false,
  SENSED_CYCLE_TOKEN: 0,

  // Modelo de taquicardia / maniobra seleccionados desde "Modelos de taquicardias".
  MODEL_TACHY_TYPE: null,
  ACTIVE_MANIOBRA: null,

  // Estado de inducción de reentrada (TRNAV/TRAV).
  AVNRT_INDUCED: false,
  AVNRT_TCL: 300,
  INDUCE_TARGET: 'AVNRT',
  INDUCED_TYPE: 'AVNRT',
  OVERDRIVE_TERMINATED: false,

  // Preexcitación manifiesta (WPW) en ritmo sinusal.
  PREEXCITATION_ENABLED: false,

  // Estimulación activa desde el polígrafo (arranca en falso: ritmo sinusal basal).
  STIMULATING: false,
};
