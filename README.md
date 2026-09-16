# Simulador de estudio electrofisiológico — estimulación programada

Herramienta educativa que simula el polígrafo de un estudio electrofisiológico (EP study):
estimulación programada, inducción de taquicardias (TRNAV, TRAV, etc.), maniobras diagnósticas y
ECG de 12 derivaciones, todo con un modelo simplificado de conducción cardíaca.

## Stack

- **HTML + CSS + JavaScript puro**, sin frameworks ni paso de build.
- JavaScript organizado en **ES modules** (`<script type="module">`), sin bundler ni transpilador.
- Sin dependencias externas para instalar (no hay `package.json`/`node_modules`).
- Se puede abrir `index.html` directo en el navegador, aunque para desarrollar es más cómodo
  servirlo por HTTP (ver abajo) porque algunos navegadores restringen los ES modules sobre `file://`.

Esta elección prioriza simplicidad y cero mantenimiento de dependencias, ya que es un proyecto
personal/educativo de un solo desarrollador que también edita desde el celular.

## Estructura del proyecto

```
index.html              Estructura de la página (controles + contenedores del trazado)
css/
  styles.css             Todos los estilos
js/
  state.js               Estado mutable compartido (único objeto `state`, ver más abajo)
  constants.js            Datos fijos: canales del polígrafo, derivaciones, config. de vías accesorias
  params.js               Lectura de los controles del formulario (getPacingParams, getPhysio)
  pathway-helpers.js      Helpers de polaridad/secuencia de activación por vía accesoria
  physio-model.js         Física del nodo AV/His-Purkinje: AH, VA, Wenckebach, construcción de latidos
  tachycardia-model.js     Construcción de las taquicardias sostenidas, inducción, sobreestimulación
  maneuvers.js             Maniobras diagnósticas (entrainment, extraestímulo con His refractario)
  trace-render.js          Dibujo SVG del polígrafo intracavitario (morfología de ondas P/QRS, etc.)
  ecg12-render.js          Dibujo SVG del ECG de 12 derivaciones
  playback.js              Animación tipo monitor (loop de reproducción, barrido, cursor)
  ui-controls.js           Lógica de los controles (estimular/detener, modos, readout de texto)
  main.js                  Punto de entrada: conecta los módulos con los onclick/onchange del HTML
serve.ps1                 Servidor HTTP local mínimo (PowerShell) para desarrollo
.claude/launch.json        Config para levantar `serve.ps1` desde el IDE
```

### Por qué un objeto `state` en vez de variables sueltas

El simulador tiene bastante estado que cambia con el tiempo (si se está estimulando, si ya se
indujo una taquicardia, la escala del trazado, etc.) y ese estado lo leen y modifican funciones
repartidas en varios archivos. En vez de variables sueltas por archivo, todas viven en
`js/state.js` como propiedades de un mismo objeto `state`, y cada módulo hace `state.ALGO = valor`.
Esto evita reintroducir un mecanismo de sincronización más complejo (eventos, store, etc.) que no
hace falta para el tamaño actual del proyecto.

## Cómo correrlo

Abrir `index.html` directamente en el navegador debería andar en la mayoría de los casos. Si el
navegador bloquea los módulos por CORS (mensaje de error tipo "Cross origin requests are only
supported..."), levantar el servidor local incluido:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

y abrir `http://localhost:8420`.

## Flujo de trabajo con git

Cada cambio funcional se prueba en el navegador (o se anota si no se pudo probar) y se commitea por
separado, con un mensaje que indique qué se verificó. Así cualquier cambio se puede revisar o
revertir sin perder el resto del trabajo.
