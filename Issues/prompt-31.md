## Objetivo

Agregar al plugin Royal Catalog Creator (SketchUp, repo `c:\Users\usuario\Documents\KitchenCreator`) dos aceleradores de captura masiva:

1. **Plantilla de importación** (Excel) para Gabinete / Alacena / Esquinero, generada desde los manifiestos, con desplegables, donde **cada fila describe un módulo completo**; más un botón **Importar** que muestra los registros en una **tabla de revisión editable y validada** antes de crearlos en la sesión.
2. **Botón «Generar todos»** que genera en lote los registros de la barra izquierda.

## Lee esto antes de tocar código (obligatorio)

`SCOPE.md` §4.2, §4.3, §4.4 y §5 · `plugin/README.md` · `plugin/royal_catalog_creator/html/js/app.js` (completo) · `main.rb` · `manifest/gabinete.json`, `alacena.json`, `esquinero.json` · `Definiciones/LEEME.md` · `Input/Gabinetes.csv`.

## Contexto (arquitectura vigente — respétala)

- **Flujo actual:** `app.js` (formulario) → `flatten()` aplana a fila plana `{ "prefijo>attr": "800mm" }` → `SU.generar(payload)` → `main.rb#generar` (valida cajones, resuelve rutas) → `engine.rb#generar_unidad` (inyecta, `redraw_with_undo`, nombra divisores, une mitades, `eliminar_ocultos`, `save_as`).
- **Regla de oro (SCOPE §4.2): la UI se define en datos, no en código.** Toda variable/etiqueta/opción/condición vive en `manifest/<familia>.json`. Prohibido cualquier `if familia == 'gabinete'`. La plantilla y la validación del import se **derivan del manifiesto**, igual que el formulario.
- **El formato de import ya está decidido en SCOPE §4.4 — no lo reinventes:** archivo único con columna `familia`; headers legibles (el `label`, no `divisor>f03espacio1`); comunes primero y luego bloques por familia; derivados aplanados a columnas amigables; presets como valores válidos de celda; validación al importar contra el manifiesto; retrocompatible con headers crudos (`attr`) para que `Input/Gabinetes.csv` siga sirviendo.
- **Mecanismos que YA existen y debes reutilizar antes de inventar nada:** `defaultValores()`, `autoNombre()`, `fieldByAttr()`, `fieldVisible()`, `fieldEnabled()`, `parseMm()`, `valorCapturado()`, `effectiveValue()` (aplica `suma`), `presupuestoCajones()`, `flatten()`, `nombresDivisores()`, y los constructores de control `ctrlNumber` / `ctrlSelect` / `ctrlPreset` / `ctrlStepper`.
- **Estado de sesión:** `state.registros = [{ id, familia, titulo, nombre_salida, valores, estado }]`, `state.activeId`, `state.seq`. La barra izquierda es `#lista-modulos` (`renderSidebar`).
- **«Generar todos» estaba clasificado como acelerador v2** en SCOPE §4.3. Este cambio lo sube a v1: actualiza esa sección y la bitácora §5.
- **Ruby de SketchUp: sin gems.** No hay `rubyzip`, `roo` ni `spreadsheet`, y no se pueden instalar. Cualquier lectura/escritura de `.xlsx` se implementa a mano o no se hace.

## Fase 0 — Diseño de la plantilla (entrega y **detente**)

El usuario pidió explícitamente **plantear primero cómo organizar la plantilla**. Antes de escribir una línea de código:

1. Escribe `Definiciones/PLANTILLA.md` con el diseño propuesto: hojas, orden y nombre exacto de cada columna generada desde los tres manifiestos, qué valores admite cada una, cómo se llenan los derivados, qué significa una celda vacía, y una fila de ejemplo por familia.
2. Ejecuta esta verificación técnica y **pídeme que la corra en la Consola Ruby de SketchUp y te pegue la salida** (no puedes ejecutar SketchUp):
   ```ruby
   puts (begin; require 'zlib'; "zlib OK #{Zlib::VERSION}"; rescue LoadError => e; "zlib NO: #{e.message}"; end)
   puts RUBY_VERSION
   ```
3. Con ese resultado, elige el formato y dímelo antes de implementar:
   - **Con `zlib`** → plantilla `.xlsx` real escrita a mano (zip + XML; `plugin/build.ps1` ya arma un zip con entradas manuales y separador `/`, úsalo de referencia) con hoja de listas y `dataValidation` = **desplegables nativos de Excel**. La lectura de un `.xlsx` guardado por Excel exige `Zlib::Inflate` + parseo del directorio central del zip y de `sharedStrings.xml`.
   - **Sin `zlib`** → plantilla `.csv` (UTF-8 con BOM, separador `,`) + hoja/archivo de opciones documentado, **sin** desplegables nativos; dilo claramente como limitación.
   - En **ambos** casos el importador acepta `.csv` siempre; `.xlsx` solo si la Fase 0 lo habilita.

**No implementes nada hasta que yo apruebe el diseño de la plantilla y el formato.**

## Punto 1 — Plantilla generada desde el manifiesto

Botón **«Exportar plantilla…»** en la barra izquierda. Escribe el archivo (`UI.savepanel`, default `Input/plantilla_catalogo.<ext>`) construyéndolo **siempre desde los manifiestos**, nunca desde una lista escrita a mano — así encaja por construcción y una variable nueva aparece sola.

Estructura pedida (ajústala si tu diseño de Fase 0 la mejora, pero justifícalo):

- **Hoja `Modulos`** — 1 fila = 1 módulo. Columnas en este orden:
  1. `familia` (desplegable: Gabinete / Alacena / Esquinero)
  2. `nombre_salida`
  3. **Bloque comunes** — los campos que las tres familias comparten, en el orden de grupos del manifiesto, con el `label` como header y la unidad entre paréntesis: `Ancho (mm)`, `Espesor puerta (mm)`, …
  4. **Bloques por familia** — todo lo demás, con prefijo en el header: `[GAB] Tipo de techo`, `[GAB] Ceja`, `[GAB] Cantidad de cajones`, `[GAB] Alto cajón 1`, `[ESQ] Profundidad izquierda`, …
  5. Columnas de sesión: `insertar_en_escena`, `limpiar_ocultos` (Sí/No).
- **Hoja `Listas`** — una columna por campo `select`/`preset` con sus `label`s, referenciada por rangos con nombre para las validaciones.
- **Hoja `Instrucciones`** — cómo llenar, qué significa vacío, unidades, y la advertencia de que las columnas de otra familia se ignoran.
- **Una columna solo es común si coinciden el `attr` Y el juego de opciones** de las tres familias. Es la trampa principal de esta plantilla: hay campos con el mismo `attr` y listas distintas —`EstiloPuerta` llega a «4 cajones» en Gabinete pero se corta en «Puerta uñero» en Esquinero— y campos equivalentes con `attr` distinto —el «Diseño de puerta» de Alacena es `c25tipopuerta` con su propia lista de 14 opciones—. Compara las opciones campo por campo al construir la plantilla; en cuanto difieran, la columna se parte en `[GAB] …` / `[ALA] …` / `[ESQ] …`, cada una con su propio desplegable. **Nunca ofrezcas la unión de dos listas en una sola columna:** dejaría elegir «4 cajones» en un Esquinero.
- **Celdas con `label` legible**, no con el código: se escribe `Puerta lisa`, no `1`; `Entrepaño`, no `""`. El importador traduce `label → valor` con el manifiesto.
- **Números en mm sin unidad** (la unidad va en el header); el importador le pega la unidad declarada en el campo.
- **Derivados aplanados**: la columna contador (`Cantidad de divisores`) más las columnas hijas hasta el `max` del manifiesto (`Espacio 1..7`, `Margen frontal 1..6`, `Alto cajón 1..4`).
- **Celda vacía = el `default` del manifiesto**, para que nadie tenga que llenar 60 columnas. Para forzar «no inyectar» está la opción explícita del preset (ej. `Entrepaño`).
- Incluye **una fila de ejemplo por familia**, ya llena y válida.

## Punto 2 — Botón Importar + tabla de revisión editable

Botón **«Importar…»** junto a «+ Nuevo módulo». Flujo: `UI.openpanel` → Ruby lee y parsea → JS valida y muestra la tabla → el usuario corrige → **Importar N registros**.

**Reparto de responsabilidades (respétalo, evita un tercer espejo de reglas):**
- **Ruby** hace solo el parseo *estructural*: archivo → `{ ok, headers: [...], filas: [[celda, …], …], error }`. Nada de semántica de manifiesto. Ponlo en un archivo nuevo `plugin/royal_catalog_creator/importer.rb` (más `xlsx.rb` si el zip lo justifica), requerido desde `main.rb`; nuevo callback `importar_archivo`, respuesta `window.CC.onImportar`.
- **JS** hace la validación *semántica* contra el manifiesto reusando lo que ya existe (`fieldByAttr`, `fieldVisible`, `fieldEnabled`, `parseMm`, `presupuestoCajones`). La semántica ya vive ahí y no debe duplicarse.

**Tabla de revisión** — vista nueva (`#pane-import`, hermana de `#pane-editor`; o modal ancho, tú decides y documenta por qué):
- Una fila por registro, con columna de **estado**: ✔ válido · ⚠ aviso · ✖ error.
- **Celdas editables con los mismos controles del formulario** (`ctrlNumber` / `ctrlSelect` / `ctrlPreset` según el `tipo` del campo). No inventes controles nuevos.
- Cada celda inválida se marca y muestra su mensaje; editar **re-valida en vivo** toda la fila.
- Cabecera con contador `N válidos de M` y botones **Importar N registros** (deshabilitado si queda algún ✖), **Descartar filas con error** y **Cancelar**.
- Solo se muestran las columnas que la familia de esa fila usa; las demás quedan en gris/vacías.

**Reglas de validación (todas bloqueantes salvo donde diga aviso):**
- `familia` existe y está activa en `FAMILIAS`.
- `nombre_salida` no vacío, sin caracteres inválidos de archivo (`\ / : * ? " < > |`), y **sin duplicados** — ni entre filas del archivo ni contra registros ya existentes en la sesión.
- Cada `select`/`preset`: el texto de la celda corresponde a un `label` (o a su `valor` crudo) **del manifiesto de la familia de esa fila**, no del de otra. Una opción válida en Gabinete puede no existir en Esquinero: eso es error, no aviso.
- Cada `numero`: parseable con `parseMm`; requeridos (`requerido: true`) no vacíos.
- Campo apagado por `habilitado_si` / oculto por `visible_si` con celda llena → **aviso**, «se ignorará», no error.
- `presupuestoCajones` no cumple → **error** de fila con el mismo mensaje que da el formulario.
- Headers desconocidos → **aviso** listado una sola vez, la columna se ignora.
- Acepta headers crudos (`divisor>f03espacio1`) además de los legibles (SCOPE §4.4).

**Al confirmar:** crea un registro por fila con `defaultValores(manifest)` + los valores importados, estado `borrador`, y los pinta en la barra izquierda. **No genera nada todavía.**

## Punto 3 — «Generar todos»

Botón en la barra izquierda: **«Generar todos (N)»**, visible solo con registros. Genera **todos** los de la lista (los ya generados se regeneran y sobrescriben su `.skp`; dilo en el diálogo de confirmación que muestra el conteo).

- **Secuencial, una unidad a la vez.** El puente Ruby↔JS es asíncrono y `@cursor_x` (auto-tiling) avanza por unidad: mantén una cola en JS y dispara la siguiente desde `onGenerar`. Nada de disparar N llamadas en paralelo.
- **Corrige este bug de raíz:** hoy `window.CC.onGenerar` marca como generado a `activeRegistro()`, que en lote es el registro equivocado. Agrega `registro_id` al payload y haz que `main.rb#generar` lo devuelva en la respuesta; `onGenerar` marca **ese** registro. El botón individual usa exactamente el mismo camino.
- **Refactor mínimo:** extrae `generarRegistro(r)` de `generar()`, sin depender de `activeRegistro()` ni de leer el nombre desde `#nombre-salida`. Los toggles «Insertar en escena» y «Limpiar piezas ocultas» ya se comportan como estado **de sesión** (viven en el DOM del editor, no en el registro): el lote los usa tal cual y lo documentas. No los muevas al registro.
- **Pre-vuelo:** valida todos los registros antes de arrancar (mismo `presupuestoCajones`). Si hay inválidos, pregunta si continuar saltándolos.
- **Un fallo no aborta el lote:** acumula errores, marca la tarjeta con ✖ y su mensaje, y al final muestra un resumen «X generados · Y con error».
- **Progreso visible:** el botón muestra `Generando 3/12…` y queda deshabilitado; agrega **Cancelar lote**, que detiene después de la unidad en curso (nunca a media generación).
- Verifica que `@cursor_x` no se reinicie entre unidades del lote: con «Insertar en escena» las N unidades deben quedar lado a lado.

## Alcance

- **Trabaja solo en:** `plugin/royal_catalog_creator/html/js/app.js`, `html/dialog.html`, `html/css/style.css`, `main.rb`, y los archivos **nuevos** `importer.rb` (+ `xlsx.rb` si aplica) dentro de `plugin/royal_catalog_creator/`; más `Definiciones/PLANTILLA.md`, `SCOPE.md`, `plugin/README.md`.
- **Manifiestos:** solo si la plantilla exige una clave nueva (ej. `en_plantilla`). **Avísame antes** de agregarla, y hazla opcional con default seguro.
- **NO toques:** `engine.rb` (salvo que demuestres que es imprescindible y me lo digas antes), `Main Components/*.skp`, `Output/`, `Input/*.csv` y `Input/*.xlsx` existentes, `dist/`, `script.rb`, `introspeccion.rb`, `introspeccion_dump.txt`, `plugin/build.ps1`.
- **Orden de trabajo:** Fase 0 (diseño + verificación) → Punto 3 (el más chico e independiente) → Punto 1 (exportar plantilla) → Punto 2 (importar + tabla).

## Restricciones

- **JavaScript ES5** (`var`, sin `let/const`, sin flechas, sin `fetch`, sin template literals): `app.js` corre en `UI::HtmlDialog`. Mantén el estilo existente.
- **Ruby de SketchUp, cero gems, cero dependencias nuevas.** Sin CDNs ni librerías JS externas (el diálogo no tiene red).
- Comentarios **en español**, explicando el **porqué**, con la misma densidad y tono del código actual.
- Cero lógica específica de familia. Todo se deriva del manifiesto.
- Solo los cambios pedidos. No refactorices, no renombres, no agregues abstracciones ni features fuera de estos tres puntos.

## Criterios de aceptación

- [ ] `ruby -c` pasa en `main.rb` y en cada `.rb` nuevo; `node --check` pasa en `app.js`; los 3 manifiestos parsean.
- [ ] «Exportar plantilla…» produce un archivo que Excel abre **sin diálogo de reparación**, con una fila de ejemplo por familia y —si la Fase 0 lo habilitó— desplegables funcionando en las columnas `select`/`preset`.
- [ ] **Round-trip:** exportar plantilla → llenar 3 filas (una por familia) → importar → aparecen 3 tarjetas en la barra izquierda con exactamente esos valores; generar una de ellas produce el mismo `.skp` que capturarla a mano en el formulario.
- [ ] Una fila con familia inexistente, opción inválida, requerido vacío o `nombre_salida` duplicado se marca ✖ con el mensaje en la celda y **bloquea** el botón Importar hasta corregirla en la tabla.
- [ ] Editar una celda de la tabla re-valida esa fila en vivo y actualiza el contador `N válidos de M`.
- [ ] Una celda llena de un campo deshabilitado por `habilitado_si` genera **aviso**, se importa igual y **no** aparece en la fila plana al generar.
- [ ] `Input/Gabinetes.csv` (headers crudos) se importa sin errores.
- [ ] «Generar todos» con 5 registros genera 5 `.skp` secuencialmente, muestra progreso, y marca ✓/✖ **la tarjeta correcta de cada uno** (no la activa).
- [ ] Un registro que falla no aborta el lote y el resumen final reporta cuántos ok y cuántos con error.
- [ ] Con «Insertar en escena» activo, las 5 unidades del lote quedan lado a lado sin encimarse.
- [ ] `SCOPE.md`: §4.3 deja de listar «generar-todos» como v2, §4.4 refleja el formato real implementado, y §5 tiene una fila por decisión fechada **2026-07-30**. `plugin/README.md` documenta plantilla, importación y lote.
- [ ] Al terminar, entrégame una **checklist de prueba manual en SketchUp** (qué exportar, qué llenar, qué importar y qué mirar) para lo que no se puede verificar sin la app.

## Condiciones de paro — detente y pregúntame antes de:

- Implementar cualquier cosa sin que yo haya aprobado `Definiciones/PLANTILLA.md` y el formato elegido en la Fase 0.
- Elegir `.xlsx` sin la salida de la verificación de `zlib`.
- Agregar una dependencia o gem (está prohibido), o cargar una librería JS externa.
- Agregar claves nuevas a los manifiestos, tocar `engine.rb`, borrar cualquier archivo, o modificar algo fuera de Alcance.
- Cambiar la firma pública de `Engine.generar_unidad` o el contrato del payload de `generar` de forma que rompa el botón individual.

## Progreso

Después de cada punto terminado, reporta: ✅ [punto N — qué quedó] — [archivos tocados] — [lo que no se pudo verificar sin SketchUp].
