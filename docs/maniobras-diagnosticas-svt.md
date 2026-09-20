# Maniobras diagnósticas para taquicardias supraventriculares — referencia para el simulador

Síntesis de: Veenhuyzen et al. (Heart Rhythm 2008, "Single diagnostic pacing maneuver for SVT"),
Veenhuyzen et al. (PACE 2011/2012, "Diagnostic Pacing Maneuvers for SVT" parte 1 y 2),
Almendral et al. (PACE 2013, "Resetting and Entrainment of Reentrant Arrhythmias" parte I y II),
y notas propias del usuario (criterios de PJRT vs TRIN atípica).

Objetivo: dejar los criterios numéricos de cada maniobra por mecanismo, para poder implementarlas
en el simulador (respuesta esperada del modelo ante cada maniobra, según qué taquicardia esté
"corriendo" en `state.INDUCED_TYPE`/`state.MODEL_TACHY_TYPE`) y para fijar valores por defecto
razonables en Parámetros fisiológicos.

No implica cambios de código todavía — es la referencia a usar maniobra por maniobra a medida que
se vayan agregando.

---

## 1. Sobreestimulación ventricular (VOP) — la maniobra "de primera línea"

Cómo se hace: overdrive desde VD (típicamente ápex) a CL 10–40 ms más corto que el CL de la
taquicardia. Si no es diagnóstica, repetir desde un sitio **basal** (cerca de la inserción
ventricular de la vía / cerca de la activación auricular más precoz — en el simulador esto ya
existe conceptualmente como "VD apical" vs "VD basal").

### 1.1 Respuesta tras detener el tren (A-V vs A-A-V)

| Respuesta | Significado |
|---|---|
| A-A-V (el último A acelerado al CL de estimulación es seguido por OTRO A antes del V) | Taquicardia auricular (TA) — sensibilidad limitada: en 50–80% de las TA la aurícula NO se acelera al CL de estimulación (disociada), lo cual también excluye AVRT pero no confirma TA |
| A-V (el A acelerado es seguido directamente por V) | AVNRT o AVRT (excluye TA) |
| Termina sin conducir a la aurícula | AVRT (si el latido que corta es His-refractario) |

Trampas a modelar: "pseudo-A-A-V" (si la conducción VA es lenta —p.ej. TRIN atípica o vía
decremental— el 2º electrograma A tras el último latido estimulado puede seguir siendo el
arrastrado; hay que contarlo igual) y "HV > HA" en AVNRT con vía final común larga (mejor pensar
la respuesta como A-H en vez de A-V/A-A-V).

### 1.2 Fusión del QRS durante el entrainment

Sólo posible si el circuito incluye tejido ventricular → **prueba AVRT**, nunca ocurre en AVNRT
(entrada y salida al ventrículo son el mismo sitio, el His).

| Sitio de estimulación | Sensibilidad de fusión en AVRT |
|---|---|
| VD apical | ~48% (73% si se suma evidencia intracavitaria: captura ortodrómica del His/rama) |
| VD basal, cerca de la A más precoz | ~75% |

Especificidad: 100% en ambos estudios (nunca aparece en AVNRT).

### 1.3 cPPI-TCL (postpacing interval corregido por el retraso decremental nodal, menos TCL)

`cPPI-TCL = (PPI - TCL) - (AH_primer_retorno - AH_taquicardia)`

| Sitio | AVNRT | AVRT (vía septal) | Corte |
|---|---|---|---|
| VD apical | 147 ± 24 ms | 73 ± 29 ms | **110 ms** (adultos) / **95 ms** (niños) |
| VD basal | 182 ± 35 ms | 31 ± 25 ms | **110 ms** (mismo corte, pero sin superposición) |

`cPPI-TCL < 110` → AVRT · `cPPI-TCL ≥ 110` → AVNRT (típica o atípica).

### 1.4 SA-VA (estímulo→A durante el entrainment, menos VA durante la taquicardia)

| Sitio | AVNRT | AVRT (vía septal) | Corte |
|---|---|---|---|
| VD apical | 132 ± 21 ms | 52 ± 26 ms | **80–85 ms** |
| VD basal | 148 ± 22 ms | **-9 ± 18 ms** (¡puede ser negativo!) | **80 ms** |

### 1.5 Entrainment diferencial (apex vs base) — cuando lo anterior es borderline

`ΔSA-VA = SA-VA(basal) − SA-VA(apical)` y `ΔcPPI-TCL = cPPI-TCL(basal) − cPPI-TCL(apical)`

- `ΔSA-VA > 20 ms` **y** `ΔcPPI-TCL > 30 ms` → **AVNRT**
- Si no → **AVRT** (de cualquier localización, incluida vía izquierda)

Ventaja: no requiere saber dónde está la activación auricular más precoz (útil si no hay catéter
en seno coronario).

### 1.6 Zona de transición al inicio del tren (primeros latidos, antes de fusión estable)

- **AVRT**: la aurícula se "perturba" (adelanta/retrasa/bloquea) **antes o al mismo tiempo** que el
  QRS llega a su morfología estable final.
- **AVNRT**: la aurícula se perturba **recién después** de que el QRS ya está estable (uno o más
  latidos más tarde) — el estímulo tiene que ir y volver por el His-Purkinje y el nodo AV antes de
  afectar la aurícula.
- VPP/VPN informados >90% para este criterio. No requiere que la taquicardia siga tras el tren.

---

## 2. Extraestímulo ventricular His-refractario (VPV/HRVPB) — "si corta o adelanta/retrasa la P"

Ya está en tus notas. Un VPV se considera His-refractario si: (a) el QRS queda fusionado, o (b) se
entrega justo después de un potencial de His discernible, o (c) se entrega hasta 35–55 ms antes
del His esperado.

| Respuesta al VPV His-refractario | Diagnóstico |
|---|---|
| Termina la SVT **sin** conducir a la aurícula | AVRT (la vía es necesaria para el circuito) |
| **Retrasa** la A sin cambiar la secuencia | AVRT con vía **decremental** (RP largo — PJRT) |
| **Adelanta** la A sin cambiar la secuencia | AVRT |
| No pasa nada | No concluyente (puede ser AVNRT, TA, o AVRT con vía lejana del sitio de estimulación) |

Sensibilidad limitada si la vía está lejos del sitio de estimulación (vía izquierda estimulando
desde VD apical) — igual que con la fusión, estimular desde un sitio basal cercano a la vía
aumenta la sensibilidad.

Regla adicional (excluir vía sin necesidad de que responda): si el VPV adelanta la V local
adyacente a la A más precoz **>30 ms** (RP corto) o **>60 ms** (RP largo) sin afectar la A, se
puede **descartar** la participación de una vía accesoria.

---

## 3. Estimulación diferencial VD basal vs apical (sin taquicardia sostenida — screening)

De "maniobras basal vs apical.pdf" (Martinez-Alday/Veenhuyzen): compara el intervalo VA (desde el
estímulo hasta la A más precoz) parando desde ápex vs desde la base (evitando capturar la
aurícula).

`VAI = VA(apical) − VA(basal)`

- `VAI > 10–20 ms` → vía accesoria septal/posteroseptal presente (100% sens/esp en el estudio
  original con n pequeño).
- `VAI ≤ 0` → sin vía (conducción nodal pura).

Limitada a vías septales/posteroseptales; vías laterales o decrementales pueden no mostrar la
diferencia.

---

## 4. Estimulación para-Hisiana / Hisiana pura

Estimular justo al lado del His/rama derecha proximal, variando el output para capturar (o no)
el His junto con el miocardio local.

| Al perder la captura del His... | Intervalo estímulo→A | Secuencia auricular | Diagnóstico |
|---|---|---|---|
| Sólo hay conducción nodal | **se alarga** (rodeo largo) | no cambia | Sin vía |
| Sólo hay conducción por vía accesoria | casi no cambia | no cambia | Vía accesoria (sola) |
| Hay ambas | intermedio | **cambia** | Vía + nodo, fusión de secuencias |

Trampas: vías lejanas/lentas (falso "sólo nodo"), pérdida aislada de captura ventricular local
("Hisiana pura"), conexión fasciculoventricular, pérdida aislada de rama izquierda, captura
auricular inadvertida (indicios: estímulo→CS proximal <60 ms o estímulo→AD alta <70 ms = casi
seguro hay captura auricular; >90/100 ms respectivamente = casi seguro no la hay).

---

## 5. Sobreestimulación auricular (AOP) — para AVNRT vs TA, y AVNRT vs JT

### 5.1 Contra TA ("VA linking")

Tras detener un tren auricular (CL 10–40 ms menor al de la taqui), comparar el VA del primer
latido arrastrado con el VA de la taquicardia:

- Diferencia **≤ 10 ms** ("VA linking") → sugiere **AVNRT** (o AVRT) — la A y la V están
  mecánicamente acopladas.
- Con **AOP diferencial** desde 2–3 sitios (orejuela derecha, os del CS, CS distal): si el VA del
  primer retorno varía **<14 ms** entre sitios → AVNRT/AVRT; si varía **>14 ms** → **TA septal**
  (el retorno depende de la distancia de cada sitio al foco, no de un circuito común).

### 5.2 Contra JT (taquicardia de la unión)

- En AVNRT: el último latido auricular estimulado conduce con **AH largo** (vía lenta) antes de
  que la taquicardia retome, y el **PR durante la estimulación excede el RR** (conducción
  anterógrada por vía lenta). Esto NO se espera en JT.

---

## 6. Extraestímulo auricular con refractariedad juncional (AEP/PAC) — AVNRT vs JT

Un latido auricular prematuro entregado cuando la vía rápida está refractaria (referencia: tiempo
esperado del His):

| Respuesta | Diagnóstico |
|---|---|
| Retrasa o adelanta el siguiente His, o termina la SVT | **AVNRT** (el extra activa la vía lenta) |
| No pasa nada | Sugiere **JT** (con la salvedad de doble vía nodal coexistente con JT) |

Y si el extraestímulo se entrega **antes** de la refractariedad de la vía rápida (adelanta el His
inmediato) y la SVT **continúa** igual → **JT** (en AVNRT esto dejaría la vía rápida refractaria y
terminaría o alteraría la reentrada).

---

## 7. Conceptos generales de reset / entrainment (para cualquier maniobra)

- **Reset**: 1–2 extraestímulos con pausa **no compensatoria** — si la suma de los dos intervalos
  que rodean al extra es menor a 2×TCL (uno) o 3×TCL (dos), hay reset.
- **Entrainment**: sobreestimulación continua más rápida que la taqui, sin interrumpirla — todo el
  tejido de la cámara donde está el circuito (incluido el circuito) queda acelerado al CL de
  estimulación, y la taquicardia "sigue viva" (retoma sin cambios al parar).
- **4 criterios clásicos de Waldo** (cualquiera basta): (1) fusión constante del QRS salvo el
  último latido capturado; (2) fusión progresiva a ≥2 frecuencias de estimulación; (3) bloqueo
  localizado en un sitio seguido de activación por otra vía con conducción más corta — implica
  **terminación**; (4) "equivalente electrográfico" del (2): el tiempo de conducción a un sitio
  fijo se acorta al aumentar la frecuencia de estimulación.
- **2 criterios nuevos (Almendral 2013)**: PPI constante al variar el número de latidos del tren
  de estimulación (una vez alcanzado el entrainment, no cambia más); el tiempo de conducción entre
  dos sitios fijos es distinto según haya o no taquicardia en curso (para el mismo CL de
  estimulación).
- **"Ley del PPI"**: un sitio activado **ortodrómicamente** (esté o no en el circuito) pasa
  directo del CL de estimulación al CL de taqui, sin transición. Un sitio activado
  **antidrómicamente** tiene un intervalo de transición que puede ser mayor o menor al CL de
  taqui — por eso medir el PPI en sitios distintos al de estimulación puede ser engañoso.
- **Entrainment oculto ("concealed entrainment")**: si la morfología del QRS durante el
  entrainment es idéntica a la de la taquicardia (sin fusión visible) y el intervalo
  estímulo→QRS es largo, el sitio de estimulación está en una zona protegida conectada al
  circuito — útil para localizar istmos de ablación. Se distingue sitio-en-el-circuito de sitio
  "bystander" comparando estímulo→QRS (entrainment) con electrograma-local→QRS (taquicardia):
  iguales → en el circuito; estímulo→QRS mayor → bystander.

---

## 8. Resumen: valores de corte usados en más de un estudio

| Medida | Corte | A favor de |
|---|---|---|
| VA septal durante la taquicardia | < 70 ms | AVNRT típica |
| VA septal durante la taquicardia | ≥ 70 ms | AVNRT atípica, AVRT, TA |
| cPPI-TCL (VD apical) | < 110 ms (< 95 ms niños) | AVRT |
| cPPI-TCL (VD apical) | ≥ 110 ms | AVNRT |
| SA-VA (VD apical) | < 80–85 ms | AVRT |
| SA-VA (VD apical) | ≥ 80–85 ms | AVNRT |
| ΔVA apical−basal (VAI) | > 10–20 ms | Vía accesoria septal presente |
| Δ(SA-VA) basal−apical | > 20 ms | AVNRT (entrainment diferencial) |
| Δ(cPPI-TCL) basal−apical | > 30 ms | AVNRT (entrainment diferencial) |
| VA linking (AOP) | ≤ 10 ms | AVNRT (vs TA) |
| AOP diferencial (2-3 sitios) | < 14 ms de variación | AVNRT/AVRT (vs TA septal, que varía >14ms) |

### Notas del usuario para PJRT vs TRIN atípica (ya coincide con la bibliografía anterior)

- PPI−TCL **< 125 ms** y ΔAH(entrainment−taquicardia) **< 20 ms** → **PJRT**
- PPI−TCL **< 125 ms**, ΔAH **> 40 ms**, AH(taqui) < AH(sinusal) → **NFRT** (nodo-fascicular)
- PPI−TCL **> 125 ms**, ΔAH **> 40 ms**, AH(taqui) < AH(sinusal) → **TRIN atípica**
- ΔHA (entrainment − taquicardia): **< 0** → AVRT/PJRT · **> 0** → AVNRT/TRIN atípica
- VD basal − VD apical (VA): **> 20 ms** → AVNRT · **< 20 ms** → vía accesoria

---

## Propuesta de mapeo a parámetros del simulador (para cuando se implemente)

El simulador no modela un circuito reentrante espacial real (no hay "istmo" ni "excitable gap"
geométrico) — genera los latidos de cada taquicardia con fórmulas fijas (AH, HV, VA por tipo).
Para implementar estas maniobras, lo más simple es que **la respuesta a cada maniobra dependa de
qué taquicardia está corriendo** (`state.INDUCED_TYPE` / `state.MODEL_TACHY_TYPE`), devolviendo
valores de PPI/SA-VA/fusión/etc. ya coherentes con las tablas de arriba, en vez de derivarlos de
un modelo espacial:

- **AH0 / HV0 / VA0** (ya existen): siguen definiendo la línea de base sinusal/nodal.
- **Por tipo de taquicardia inducida**, agregar constantes de "respuesta a maniobra":
  - `cPPI_TCL` y `SA_VA` esperados para VD apical y VD basal (tabla §1.3/1.4).
  - `fusionPosible: bool` (true para AVRT/AVNRT-atípica-con-vía, false para AVNRT típica/TA/JT).
  - `hrvpbResponse: 'terminates' | 'delays' | 'advances' | 'none'` (tabla §2).
  - `vaiApicalBasal` (tabla §3, sólo aplica si hay vía septal).
- Estas constantes pueden vivir junto a `PATHWAY_CONFIGS` en `js/constants.js` (que ya tiene
  `baseVA`, `csDistalOff`, etc. por vía) o en una tabla nueva paralela indexada por
  `INDUCED_TYPE`.
- La UI necesitaría, cuando se implemente cada maniobra, un botón "Sobreestimular desde VD basal"
  (ya existe "VD basal" como sitio, falta usarlo durante taquicardia sostenida), un botón
  "Extraestímulo His-refractario", y mostrar en el readout el PPI-TCL/SA-VA calculados, comparados
  contra el corte, con el diagnóstico sugerido — similar a como ya se muestra AH/VA en el readout
  actual.
