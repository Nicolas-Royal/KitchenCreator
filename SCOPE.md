# Catalog Creator — Scope del Plugin

Estado: borrador para fijar alcance. Última actualización: 2026-07-21.

## 1. Problema

Hoy la generación de catálogo (variaciones de Gabinetes, Alacenas, Esquineros) depende de que alguien llene un Excel/CSV técnico (`Input/Gabinetes.csv`) y corra `script.rb` manualmente desde la consola de Ruby de SketchUp. Las diseñadoras deberían poder generar variaciones sin tocar el CSV ni la consola.

Columnas como `puerta>f21tipotirador` o valores como `"no"` para omitir un atributo son convenciones internas no obvias para alguien fuera del desarrollo del script.

## 2. Estado actual (as-is)

### 2.1 Inventario de componentes base (`Main Components/`)

| Familia | Archivo(s) |
|---|---|
| Gabinete  | `GABINETE.skp`  | 
| Alacena   | `ALACENA.skp`   |
| Esquinero | `ESQUINERO.skp` | 

### 2.2 Flujo de `script.rb`

1. Carga la definición base (`model.definitions.load`) — esto **no requiere** que el componente esté insertado en la escena, solo carga la definición en memoria.
2. Lee el CSV (detecta separador automáticamente entre tab/`;`/`,`).
3. Por cada fila:
   - Crea una instancia del componente base (`add_instance` + `make_unique` para no compartir definición entre filas).
   - Por cada columna del CSV (excepto `nombre_salida`):
     - Si el header tiene `>` (ej. `puerta>f21tipotirador`): busca recursivamente instancias/grupos hijos cuyo nombre contenga el prefijo (`puerta`, `estructura`, `divisor`) y les inyecta el atributo.
     - Si no tiene `>`: el atributo se inyecta en la raíz del módulo (aplica a variables "estándar" tipo `LenX/LenY/LenZ` y a variables propias como `a02zocalo`, `c01espestr`, etc.)
   - Convierte valores con unidad (`mm`, `cm`, `m`, `in`/`pulg`) a pulgadas (unidad nativa de SketchUp), o los deja como texto si no matchean el patrón numérico.
   - `"no"` (case-insensitive) significa "omitir esta variable" — no se toca el atributo.
   - Escribe dos claves por atributo: el valor (`key`) y su versión "nominal" (`_key_nominal`), y borra cualquier fórmula previa (`_key_formula`) para las variables estándar de tamaño — esto **fija** el valor en vez de dejarlo paramétrico.
4. Fuerza el redibujado del componente dinámico (`redraw_with_undo`).
5. Guarda la instancia como `.skp` individual en `Output/<Familia>/<nombre_salida>.skp`.
6. Borra la instancia de la escena activa y continúa con la siguiente fila.

### 2.3 Esquema del CSV (`Input/Gabinetes.csv`)

- `nombre_salida`: nombre del archivo de salida.
- Columnas simples (`LenX`, `LenY`, `LenZ`, `a02zocalo`, `c01espestr`, `c02esppuerta`, `c03espfondo`, `c24entrepano`, `EstiloPuerta`): atributos de la raíz del módulo.
- Columnas `prefijo>atributo`: atributos de piezas hijas, agrupadas hoy en 3 familias funcionales:
  - `estructura>` — ej. tipo de techo.
  - `puerta>` — cantidad, posición de bisagras, márgenes, tipo/orientación de tirador.
  - `divisor>` — cantidad de divisiones, tipo de medida, espacios individuales, márgenes.

Esto es, en esencia, un árbol de parámetros (componente → sub-componente → atributo) aplanado a columnas de CSV con notación `>`.

### 2.4 Dolores identificados

- Formato CSV/Excel no es amigable para no-técnicos (headers técnicos, unidades mezcladas en texto libre, convención oculta `"no"`).
- No hay validación en el momento de captura — errores solo se ven al correr el script y revisar consola/mensajes.
- Agregar una variable nueva requiere: agregar columna al CSV + (si aplica) tocar el componente dinámico — sin ayuda visual de qué variables existen ya.
- Requiere conocimiento de la consola Ruby de SketchUp para ejecutar (`Command.txt`).

### 2.5 Hallazgo de introspección (2026-07-21)

Se corrió un volcado (`introspeccion.rb`) sobre `GABINETE.skp`:

- **325 variables únicas** repartidas en ~1,480 entidades anidadas; ~15,300 apariciones totales (mucha repetición de la misma variable en cada pieza).
- **~52% tienen fórmula** (`_key_formula`): son plomería interna, **no** inputs de usuario.
- **333 "variables" son separadores decorativos** (ej. `e00________ = "-------- ESTRUCTURA --------"`).
- **Cero curación nativa**: `_key_access`, `_key_formlabel` y `_key_units` están vacíos en todas.

Implicaciones que definen la arquitectura:

- Los componentes son de una **librería comercial** (melaminapro, `itemcode = "OCL versión 6.0.0"`). Su convención de prefijos (`e00/e11/a02/c01…`) y sus separadores los lee *su* propio plugin, no el mecanismo nativo de "Component Options" de SketchUp.
- Por eso **no se puede leer la curación ni las etiquetas legibles desde el componente** → el manifiesto curado deja de ser opcional y pasa a ser **obligatorio** y única fuente de etiquetas (ver 4.2).
- La introspección a ciegas es inservible como fuente de UI; se degrada a **herramienta de descubrimiento admin** con filtros obligatorios (ocultar fórmulas y separadores, de-duplicar por nombre).

## 3. Objetivo (to-be) — Plugin v1

- Extensión de SketchUp con interfaz (`UI::HtmlDialog`) que reemplaza el llenado manual del CSV.
- La diseñadora elige familia de producto (Gabinete / Alacena / Esquinero) y llena un formulario visual, agrupado por sub-componente (igual que hoy: raíz, estructura, puerta, divisor...).
- El plugin reusa la lógica de inyección de atributos ya validada en `script.rb`.

### 3.1 Salida doble: carpeta + escena

La unidad generada tiene **dos destinos, no excluyentes** (decisión 2026-07-21):

- **A. Archivo en carpeta (catálogo reutilizable).** Igual que hoy: guarda cada unidad como `.skp` individual en `Output/<Familia>/<nombre_salida>.skp`. Esa carpeta se ve en SketchUp como *colección local* en el panel de Componentes, para arrastrarla cuando se quiera.
- **B. Insertar en la escena abierta.** Además, el plugin puede colocar la unidad directamente en el modelo activo (`model.entities.add_instance(definition, transformation)`), con su `nombre_salida` como nombre de instancia. Ahorra el paso de ir al panel de Componentes y arrastrar.

El paso de `script.rb` que **borra la instancia** de la escena tras guardar deja de ser obligatorio: si el destino incluye "insertar en escena", la instancia se conserva y se posiciona (ver 3.2).

### 3.2 El "mapa de cocina" = la escena nativa, con auto-tiling

No se construye un editor 2D dentro del diálogo (decisión 2026-07-21). La composición espacial de la cocina ocurre en la **escena de SketchUp**, aprovechando arrastre, snapping y giro de esquinas que ya son nativos.

Para que las unidades no caigan encimadas, el plugin lleva un **cursor de colocación**: la primera unidad de la sesión va a un origen, y cada unidad siguiente se desplaza en X por el ancho (`LenX`) de la anterior, quedando **pegadas lado a lado** y formando la corrida automáticamente. La diseñadora luego reacomoda, gira para esquinas o mueve corridas con las herramientas normales de SketchUp.

Nota de implementación: el cursor es estado de sesión del plugin; conviene decidir el punto de origen (¿origen del modelo, o un punto que la diseñadora fije?) — ver preguntas abiertas.

### 3.3 Fuera de v1 (relacionado)

- Piezas **personalizadas** (no catálogo) dentro del mapa: fuera de v1 (decisión 2026-07-21). El v1 solo coloca las familias de catálogo. Se documenta como candidato v2 (ver sección 7).

## 4. Decisiones de arquitectura

### 4.1 Origen del componente base: siempre desde archivo, nunca desde la escena

El plugin carga la definición base directamente desde la ruta configurada (`model.definitions.load(path)`), igual que hace `script.rb` hoy. **No** se le pide a la diseñadora que arrastre o seleccione el componente en la escena — eso evita errores (archivo equivocado, selección vacía o múltiple) y mantiene una sola fuente de verdad: los archivos en `Main Components/`.

### 4.2 Manifiesto curado: obligatorio, por familia, única fuente de verdad de la UI

Dado el hallazgo 2.5 (los componentes no traen curación ni etiquetas nativas), el manifiesto es la **única** fuente de: qué variables se muestran, su etiqueta legible, su control y sus unidades. Ya no es opcional.

**Estructura de archivos — uno por familia + comunes** (decisión 2026-07-21):

```
manifest/
  _comunes.json      → presets globales (CH/G), campos compartidos (LenX/LenY/LenZ, materiales)
  gabinete.json
  alacena.json
  esquinero.json
```

- Cada familia declara su `componente_base`, `salida_dir` y sus `grupos` (raíz/estructura/puerta/divisor) con campos.
- Lo compartido vive una vez en `_comunes.json` y se referencia (`$ref`), sin duplicar medidas.
- **Agregar una familia = soltar un `.json` + su componente. Cero código.** (Deja la puerta abierta a "personalizados" como familia futura.)
- El plugin es **agnóstico a la familia**: escanea `manifest/*.json` → llena el selector; al elegir una, dibuja su formulario y aplana a atributos. No hay lógica `if gabinete…`.
- **Siembra v1**: el manifiesto de Gabinete arranca de las ~36 columnas ya probadas de `Input/Gabinetes.csv` (subconjunto validado, ≈11% de las 325). Las variables específicas de cada familia las define el mantenedor (pendiente — se entregan vía la plantilla de 4 columnas en `Definiciones/`).

**Tres tipos de campo** (cómo se dibuja y qué escribe cada uno):

| Tipo | Control en UI | Qué escribe al generar (aplanado) |
|---|---|---|
| **directo** | 1 control (número/select/toggle/texto) | 1 par `attr = valor` (unidad convertida). Igual que una celda del CSV. |
| **preset** | select con estándares (CH/G) + "Personalizado" que revela input | 1 par `attr = valor_resuelto`; el preset se resuelve a medida real antes de aplanar. |
| **derivado** | 1 contador que agrega/quita N subcampos | `count_target = N` + fijos + por cada i=1..N los subcampos con `{i}` sustituido. Colapsa a muchos pares. |

Ejemplo derivado (cajones): "Número de cajones" (n/1/2/3) → escribe `divisor>f01cantdiv = N` y genera "Alto cajón 1..N" (i=1 = superior), cada uno mapeando a `divisor>f03espacio{i}` y `divisor>g01margenf{i}`. Cada alto es a su vez tipo *preset* (CH/G) → los tres tipos se componen.

**Modelo mental — el manifiesto es una capa de UI que "aplana" a la misma fila del CSV:**

```
manifest → [UI] → diseñadora llena → [resolver presets + expandir derivados + convertir unidades]
         → mapa plano { prefijo>attr : valor }  ==  fila del CSV de hoy
         → motor de inyección de script.rb (sin cambios)
```

Toda la lógica nueva vive en el paso de aplanado; `script.rb` sigue recibiendo `divisor>f03espacio1 = 250mm`. Esto mantiene una sola fuente de verdad para la inyección.

**Introspección (nivel admin):** sigue disponible para descubrir variables nuevas, con filtros obligatorios (ocultar fórmulas y separadores, de-duplicar). Flujo: agregas variable al componente → aparece por introspección → decides si la subes al manifiesto → aparece en la UI.

### 4.3 Modelo de sesión (registros) y aceleradores de creación

El plugin mantiene una **lista de registros** en la sesión (equivalente a las filas del CSV, pero manejadas por la UI), persistida a JSON en el proyecto:

```
registro = { id, familia, nombre_salida, valores: {campo_id: valor}, estado: "borrador"|"generado" }
```

Aceleradores **v1** (decisión 2026-07-21):

- **Clonar registro** — duplica todos los valores de un mueble para ajustar 1-2 cosas. Mayor ahorro en corridas de módulos casi idénticos.
- **Auto-nomenclatura** — `nombre_salida` autogenerado por patrón (ej. `GAB-{ancho}-{cajones}caj-{n}`), editable.
- **Importar** — cargar registros desde un archivo (ver 4.4).

Aceleradores **v2** (documentados, fuera de v1): generar-todos en lote con auto-tiling, generar-serie (barrido de una dimensión), plantillas de mueble completo, round-trip (editar un `.skp` ya generado estampando los valores del manifiesto en un diccionario `catalog_creator` dentro del archivo).

### 4.4 Formato de import / plantilla (derivado del manifiesto)

Principio: **la plantilla se genera desde el manifiesto** (botón "Exportar plantilla"), nunca se escribe a mano → encaja por construcción.

- **Un solo archivo, todas las familias**: columna `familia` al inicio; por cada fila el plugin lee solo las columnas que el manifiesto de esa familia define e ignora las vacías.
- **Headers legibles** (el `label` del manifiesto, no `divisor>f03espacio1`); al importar traduce `label → attr`.
- **Comunes primero**, luego bloques por familia (traslape alto entre las 3 por ser la misma librería).
- **Derivados aplanados amigables**: `Cajones` + `Alto cajón 1..N` con valores CH/G en vez de columnas crípticas; el plugin expande al importar.
- **Presets como valores válidos** en celda (`CH`, `G`, o medida `300mm`). Solo entran campos marcados `en_plantilla: true`.
- **Validación al importar** contra el manifiesto (familia, requeridos, presets, unidades) con errores por fila antes de crear registros → resuelve el dolor 2.4 de "sin validación en captura".
- **Retrocompatible**: acepta también headers crudos (`attr`), así el `Input/Gabinetes.csv` actual sigue sirviendo.

## 5. Bitácora de decisiones

| Fecha | Decisión |
|---|---|
| 2026-07-17 | Base vigente de Gabinete = `GABINETE.skp` (no `GabineteBase.skp` ni `GABINETE-FINAL.skp`). Pendiente actualizar `script.rb`. |
| 2026-07-17 | Plugin carga el componente base siempre desde archivo (`definitions.load`), nunca requiere el componente insertado/seleccionado en la escena. |
| 2026-07-17 | Campos de UI vienen de un manifiesto curado separado, no del CSV ni de mostrar todos los atributos crudos. |
| 2026-07-21 | Salida doble no excluyente: guardar `.skp` en carpeta (catálogo) **y** opción de insertar la unidad en la escena abierta. El borrado post-guardado deja de ser obligatorio. |
| 2026-07-21 | El "mapa de cocina" es la escena nativa de SketchUp con auto-tiling (cursor que desplaza en X por `LenX`), no un editor 2D dentro del diálogo. |
| 2026-07-21 | Piezas personalizadas (no catálogo) quedan fuera del v1; candidatas a v2. |
| 2026-07-21 | Introspección revela componentes melaminapro (OCL 6.0.0) sin curación nativa (`_access`/`_formlabel`/`_units` vacíos) → manifiesto curado pasa de opcional a **obligatorio** y única fuente de etiquetas. |
| 2026-07-21 | Manifiesto **por familia** (`manifest/gabinete.json`, etc.) + `_comunes.json` compartido; plugin agnóstico a la familia. |
| 2026-07-21 | Tres tipos de campo: directo, preset (CH/G), derivado (ej. cajones que expanden a N subcampos). El manifiesto aplana a la misma fila que el CSV; `script.rb` no cambia. |
| 2026-07-21 | Sesión = lista de registros. Aceleradores v1: clonar + auto-nomenclatura + importar. v2: lote+auto-tiling, serie, plantillas, round-trip. |
| 2026-07-21 | Import = archivo único con columna `familia`, plantilla generada desde el manifiesto, headers legibles, validación al importar; retrocompatible con headers crudos. |
| 2026-07-24 | Habilitación **por campo** (`habilitado_si`) en vez de por grupo: los espesores y la corredera de cajón quedan siempre activos; solo «Cantidad de cajones» se habilita con diseño de puerta «N cajones». Se arregla el bug que impedía activar el grupo Cajones. |
| 2026-07-24 | Variable `c24entrepano` (Entrepaño, Sí=0/No=1) expuesta en las tres familias. Formulario regrupado en 7 bloques temáticos (Dimensiones/Espesores/Estructura e interior/Frente y puertas/Tirador/Cajones/Divisores). |
| 2026-07-24 | Alacena y Esquinero migradas a la UI (`manifest/alacena.json`, `manifest/esquinero.json`) y activadas en `FAMILIAS`; dejan de ser stubs "Próximamente". |

## 6. Preguntas abiertas

- ¿Cuál es la variante vigente de Esquinero (`ESQUINERO.skp` vs `ESQUINERO(BASE).skp` vs `ESQUINERO-VIE.skp`)?
- ¿`script3.rb` (unión booleana de piezas `P##`) entra al scope del plugin, o se evalúa aparte una vez validado que hace lo que promete?
- **Variables por familia (pendiente del mantenedor):** el subconjunto exacto a exponer por Gabinete/Alacena/Esquinero se define y entrega vía la plantilla de 4 columnas en `Definiciones/`. Hasta entonces, Alacena y Esquinero van como stubs.
- **Orden de cajones:** ¿`divisor>f03espacio1` es el cajón **superior** o el inferior? Define el `orden` de la expansión del campo derivado.
- **Márgenes vs espacios (off-by-one):** el CSV tiene `f03espacio1..7` (7) pero `g01margenf1..6` (6). ¿Los márgenes son *entre* cajones (N−1) o incluyen extremos?
- **Medidas CH/G:** ¿existe tabla de estándares Royal Kitchens (medida por tipo de mueble/variable), o se ponen valores tentativos? Idealmente los presets viven en `_comunes.json` para editarlos sin tocar código.
- **Presets globales vs por campo:** ¿"CH/G" significan lo mismo en todo el catálogo, o cambian según la variable?
- **Auto-tiling — punto de origen:** ¿la primera unidad de la sesión se coloca en el origen del modelo, o la diseñadora fija un punto/pared de arranque? ¿El cursor avanza en +X siempre, o se detecta la orientación de la corrida?
- **Auto-tiling — separación:** ¿las unidades van pegadas exactas (`LenX`) o con alguna holgura/junta configurable entre ellas?
- ¿La opción "insertar en escena" es un toggle por unidad, o un modo de sesión que aplica a todas?

## 7. Fuera de alcance (v1)

- Edición del componente dinámico en sí (agregar/quitar piezas, fórmulas) desde el plugin.
- La función de unión booleana de `script3.rb` (pendiente validar que funcione antes de considerarla).
- **Piezas personalizadas (no catálogo) en el mapa.** Candidato v2: modelo unificado de "unidad" que acepte cualquier origen (catálogo paramétrico, `.skp` custom, o bloque placeholder con solo medidas + nombre), para completar corridas con piezas que se hacen aparte.
- **Editor 2D de arrastre dentro del diálogo.** Solo se reconsideraría si manipular la composición en la escena 3D resulta incómodo para las diseñadoras.
