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
- **Importar** — cargar registros desde un archivo, con tabla de revisión editable antes de crearlos (2026-07-30; ver 4.4). Acompañado de **«Plantilla…»**, que exporta el `.xlsx` con desplegables derivado de los manifiestos.
- **Generar todos** — genera en lote los registros de la sesión, uno por uno, con auto-tiling (2026-07-30; venía de v2). Estrictamente secuencial: el puente Ruby↔JS es asíncrono y el cursor de auto-tiling avanza por unidad, así que mandar el lote en paralelo apilaría los muebles en el mismo punto. Un fallo marca su tarjeta y no aborta el resto.

Aceleradores **v2** (documentados, fuera de v1): generar-serie (barrido de una dimensión), plantillas de mueble completo, round-trip (editar un `.skp` ya generado estampando los valores del manifiesto en un diccionario `catalog_creator` dentro del archivo).

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
| 2026-07-27 | **Orden de cajones resuelto: cajón 1 = superior.** El volcado lo confirma (`v02poscajon4 = 0`, posiciones acumuladas desde abajo). |
| 2026-07-27 | La fórmula de reparto de alto del componente no tiene piso → el plugin calcula el presupuesto de alto (`reglas_cajones` en el manifiesto) y **bloquea** la generación de lo que no cabe, en vez de auto-ajustar. Alto mínimo de frente = 190 mm (preset CH, pendiente confirmar contra el herraje). |
| 2026-07-27 | Los cuatro «Alto cajón» son tipo *preset* con Automático (restante) / CH / G / Personalizado, visibles según la cantidad efectiva de cajones (`visible_si.min_cajones`). |
| 2026-07-27 | Tema de la interfaz a `#59b4a5` con logo `img/logo.jpg`. `--primary` es el color de marca y `--primary-strong` (`#35786c`) el de rellenos con texto encima (contraste AA). |
| 2026-07-27 | **«N cajones» = altos uniformes.** El componente `COA01` hace los cajones copia del primero (`Cajon.copies`), así que la UI captura **un solo** alto que aplica a los n (`reglas_cajones.uniforme_si_n`). Mostrar cuatro altos independientes prometía un control que el componente no tiene. |
| 2026-07-27 | Alto mínimo de frente de cajón baja de 190 a **100 mm**. Los presets que ya no caben dejan de ofrecerse conforme se asignan altos (`limiteAltoCajon`): el desplegable de cada cajón filtra CH/G contra el espacio que le queda, dejando siempre Automático y Personalizado. |
| 2026-07-27 | Los márgenes se capturan en un **editor de caja** (`box_model` a nivel de grupo): cada campo se dibuja en su posición alrededor de un rectángulo. Los campos siguen siendo campos normales del manifiesto; solo cambia dónde los coloca el render. |
| 2026-07-27 | **Se borran las piezas ocultas al generar** (`Engine.eliminar_ocultos`), tras un toggle encendido por default. Precio: el `.skp` de salida deja de ser reconfigurable (el DC ya no puede volver a mostrar lo borrado). Cada contenedor anidado se hace único antes de tocarlo, porque sus definiciones son compartidas con el componente base. |
| 2026-07-27 | En Divisores, cada espacio va seguido de su margen (espacio 1 → margen 1 → espacio 2 → …) en vez de los espacios juntos y los márgenes al final. |
| 2026-07-29 | Los «Espacio N» se **deshabilitan** con tipo de medida «Separaciones iguales» (`habilitado_si` sobre `divisor>f02tipomedida`), en vez de ocultarse: siguen a la vista para que se entienda qué se está renunciando a controlar, pero no entran en la fila plana. |
| 2026-07-29 | El mensaje de `habilitado_si` solo se muestra cuando el campo está apagado (regla CSS `.field:not(.is-disabled) .field__hint--cond`). Explicar por qué algo está deshabilitado sobra cuando ya está activo. |
| 2026-07-29 | **Margen frontal = desplegable Entrepaño / Divisor / Personalizado…** (`tipo: "preset"`), no un número libre. Los dos casos reales dejan de ser folclore: «Divisor» inyecta `0mm` (rompe la fórmula) y «Entrepaño» no inyecta nada (la conserva). **Default = Entrepaño**, que es el comportamiento que ya tenía el campo vacío. |
| 2026-07-29 | El **modo elegido** en ese desplegable —y no comparar el margen contra 0— es la fuente de verdad del nombre de la pieza. Un margen personalizado de 0 mm sigue siendo `Entrepaño`. El mapeo modo→nombre vive en `reglas_divisores.nombres_por_modo` del manifiesto. |
| 2026-07-29 | `cejaselect` (Con ceja = 1 / Sin ceja = 2) vive en la **raíz** del componente y **solo en Gabinete**; queda en el grupo «Estructura e interior», default «Con ceja». |
| 2026-07-29 | **Alto y Profundidad pasan a ser medidas del CUERPO.** El manifiesto declara qué se suma antes de inyectar (`suma`): `LenZ += a02zocalo`, `LenY += c02esppuerta`. La UI muestra el total resultante como hint para que la suma no sea invisible. Alacena solo compensa profundidad (no tiene zócalo). |
| 2026-07-29 | El espesor de puerta se suma **solo con puerta exterior**: diseño de puerta ≠ «Ninguna» **y** `puerta>f01posextintpu = 1`. Se expresa con condiciones `si` en el propio sumando, así que Alacena usa `c25tipopuerta` y las otras dos `EstiloPuerta` sin código específico por familia. |
| 2026-07-29 | La `suma` se resuelve dentro de `effectiveValue`, no en el aplanado. Así el presupuesto de cajones (`app.js`) y `validar_cajones` (`main.rb`) leen ambos el alto **ya compensado** y siguen restando el zócalo una sola vez: no hubo que tocar `reglas_cajones.attr_restar` ni desincronizar los dos espejos. |
| 2026-07-29 | Esquinero queda **fuera** del nombrado Divisor/Entrepaño: no tiene campos `g01margenf{i}` (usa cuatro márgenes de planta `e31..e34`), así que no hay modo por división que consultar. |
| 2026-07-29 | **Orden de divisores resuelto: división 1 = la de más abajo.** Verificado con `Issues/diag_divisores.rb` cruzando el margen inyectado contra el desplazamiento en `y` de cada pieza: `margenf1=26mm → y=26.0, z=127.5` (la inferior), `margenf2=0 → y=0, z=273.0`, `margenf3=12mm → y=12.0, z=418.5`. El motor ordena las copias por `z` ascendente. |
| 2026-07-29 | Las copias de divisor **traen definición propia** (`instances.size == 1`): el componente dinámico ya las independizó, así que nombrarlas por separado no requiere `make_unique`, y ninguna está oculta, así que los nombres sobreviven a `eliminar_ocultos` y al `save_as`. |
| 2026-07-29 | El nombre va en la **instancia hoja** (`PanelXY#nn > Panel#nnn`), nunca en la definición. Las divisiones se distinguen de la caja de referencia por **tipo** (`ComponentInstance` vs `Group`), no por nombre, que sería frágil. |
| 2026-07-30 | **Esquinero deja de leerse como un gabinete.** Tiene dos alas, así que `LenX`/`LenY` pasan a ser «Ancho izquierdo» y «Ancho derecho», y la profundidad de cada una vive en `a0101profizq` / `a0102profder` (atributos de **raíz**). El ajuste `suma` del espesor de puerta se muda de `LenY` a las dos profundidades, con la misma condición de puerta exterior; `LenZ` conserva el zócalo. Alcance acordado: solo el grupo Dimensiones — no se portan `cejaselect`, cantidad de puertas ni cajones. |
| 2026-07-30 | **Las mitades de cada entrepaño del Esquinero se fusionan al generar** (`reglas_union` en el manifiesto → `Engine.unir_piezas`). El componente modela cada repisa en L como dos prismas (`P01-ESQ` + `P02-ESQ`) y el `.skp` entregaba dos tableros donde debe haber una pieza. Se une con Solid Tools (**requiere Pro**; sin Pro sale un aviso y las mitades quedan separadas). Precio: el entrepaño deja de ser reconfigurable, igual que ya pasaba con `eliminar_ocultos`. |
| 2026-07-30 | Ninguna mitad es `manifold?` pese a ser un prisma cerrado de 6 caras: trae colgando un grupo `SPanel` de una cara, y SketchUp solo considera sólido lo que contiene únicamente caras y aristas. Por eso se unen **copias limpias** de cada mitad y no las piezas originales. Verificado con `Issues/diag_entrepanos.rb`. |
| 2026-07-30 | El contenedor de repisas del Esquinero es `DIVISORES`, no un `ENTREPANO` (el prefijo correcto es `entrepaño` **con ñ**; `entrepano` da 0 nodos). Aun así la unión **no lo usa**: parte del nodo `ENTREPAÑO` de cada copia, que ya agrupa las dos mitades, así que no depende del nombre del contenedor. |
| 2026-07-30 | `instances.size == 1` **no** prueba que una definición sea exclusiva de la unidad: si un ancestro está compartido, esa única instancia se dibuja también dentro del componente base. Todo lo que modifique geometría busca con `Engine.buscar_para_modificar`, que independiza cada contenedor por el que pasa; `buscar_componentes_hijos` queda como búsqueda de solo lectura. |
| 2026-07-30 | Si `union` deja el resultado fuera del contenedor, se **descarta** en vez de reubicarlo: la unión consume las copias y no los originales, así que la repisa queda intacta y nunca aparece geometría suelta en la escena. Reubicar exigiría la cadena de transformaciones del ancestro, complejidad que no se paga por un caso que probablemente no ocurre. |
| 2026-07-30 | **«Generar todos» sube de v2 a v1** y trae consigo el `registro_id`: el payload de `generar` lo lleva y la respuesta lo devuelve, porque `onGenerar` marcaba como generado al **módulo activo** y en lote ése no es el que se generó. El botón individual usa el mismo camino, así que no hay dos rutas de generación que puedan divergir. |
| 2026-07-30 | Los toggles «Insertar en escena» y «Limpiar piezas ocultas» quedan formalmente como estado **de sesión**, no del registro: siempre vivieron en el DOM del editor y nunca se guardaron por módulo. El lote los lee tal cual. Moverlos al registro sería un cambio de significado, no un refactor. |
| 2026-07-30 | La confirmación del lote usa un **modal propio** (`#modal-confirm`, mismo markup que el selector de familia) en vez de `window.confirm()`: el diálogo nativo dentro de `UI::HtmlDialog` es del navegador embebido y bloquea el hilo del diálogo. |
| 2026-07-30 | **La plantilla de importación se genera como `.xlsx` real, sin gems.** SketchUp no trae rubyzip ni puede instalar ninguna, así que el archivo se arma a mano (`xlsx.rb`): zip con entradas **sin comprimir** —válido para Excel y sin depender de `Zlib::Deflate`; de zlib solo se usa el CRC32, con respaldo propio— y cadenas *inline* en vez de `sharedStrings.xml`. A cambio se obtienen **desplegables nativos** (`dataValidation`), que era el punto de usar Excel y no CSV. |
| 2026-07-30 | **La columna de la plantilla se identifica por el campo completo, no por el `attr`.** Dos familias comparten columna solo si coinciden `attr`, `tipo`, `unidad`, `label` y el juego entero de opciones; si algo difiere, la columna se parte con prefijo (`[GAB]`, `[GAB·ALA]`, `[ESQ]`). Sin esta regla, `EstiloPuerta` ofrecería «4 cajones» en un Esquinero y `LenY` mezclaría «Profundidad» con «Ancho derecho». Resultado: 64 columnas, 18 listas. |
| 2026-07-30 | Los desplegables de campos `preset` se emiten **no bloqueantes** (`showErrorMessage="0"`): una medida libre como `250` es un valor legítimo que no está en la lista, y una validación estricta la rechazaría. Los `select` sí bloquean. |
| 2026-07-30 | El modelo de columnas (`Plantilla.modelo`) es JSON-serializable a propósito: la UI lo consume al importar para mapear encabezado→campo, así la regla de agrupación vive en **un solo lugar** y no reescrita en JavaScript. |
| 2026-07-30 | **Al importar, Ruby parsea y JavaScript valida.** `importer.rb` convierte archivo→matriz de texto y nada más; toda la semántica (traducir etiquetas, `visible_si`/`habilitado_si`, requeridos, presupuesto de cajones) se resuelve en `app.js` con los mismos predicados del formulario. Ya hay dos espejos de esas reglas (`app.js` y `main.rb`); un tercero en el importador sería el que se desincronizaría. |
| 2026-07-30 | La tabla de revisión usa **controles propios**, no `ctrlSelect`/`ctrlPreset`/`ctrlStepper`. Esos y `updateConditionals` localizan sus elementos con `document.querySelector` global, así que con N filas todas las instancias chocarían. En la tabla solo hace falta capturar texto. |
| 2026-07-30 | Los toggles «Insertar en escena» y «Limpiar piezas ocultas» **dejan de ser columnas de la plantilla**. Son estado de sesión; exportarlas prometía un control por fila que el importador no podía honrar. La plantilla baja de 64 a 62 columnas. |
| 2026-07-30 | Con dos filas del mismo `nombre_salida` se marcan **las dos**, no la segunda: con un duplicado no hay «original» que preservar. Corregir cualquiera libera ambas. |
| 2026-07-30 | El importador detecta **CSV en Windows-1252**: «Guardar como CSV» de Excel en Windows no escribe UTF-8, y sin la conversión «Puerta uñero» no coincidiría con ninguna opción del manifiesto. |
| 2026-07-30 | **Se podan los campos que no aplican por familia.** «Tipo de techo» (`estructura>e22tipotecho`) queda **solo en Gabinete**: la Alacena no lo lleva y el Esquinero trae el suyo ya elegido en el componente base. En Esquinero, «Diseño de puerta» (`EstiloPuerta`) se corta en «Puerta uñero» (0–5): no tiene cajones, así que las variantes 6–9 prometían algo que el componente no arma. «Ancho amarres» (`e23ancamtecho`) se conserva en las tres. |

## 6. Preguntas abiertas

- ¿Cuál es la variante vigente de Esquinero (`ESQUINERO.skp` vs `ESQUINERO(BASE).skp` vs `ESQUINERO-VIE.skp`)?
- ¿`script3.rb` (unión booleana de piezas `P##`) entra al scope del plugin, o se evalúa aparte una vez validado que hace lo que promete?
- **Variables por familia (pendiente del mantenedor):** el subconjunto exacto a exponer por Gabinete/Alacena/Esquinero se define y entrega vía la plantilla de 4 columnas en `Definiciones/`. Hasta entonces, Alacena y Esquinero van como stubs.
- **Alto mínimo de frente de cajón:** hoy `alto_min_mm = 100` (valor pedido por el usuario, 2026-07-27). Confirmar contra la ficha del herraje y si difiere entre Tandem y Antaro (`b03tipocajon`).
- **Márgenes vs espacios (off-by-one):** el CSV tiene `f03espacio1..7` (7) pero `g01margenf1..6` (6). ¿Los márgenes son *entre* cajones (N−1) o incluyen extremos? Hoy `f03espacio7` es inalcanzable: pide `f01cantdiv ≥ 7` y el contador topa en 6. Si son `n+1` espacios para `n` divisores, hay que corregir los `visible_si` de todos los espacios, no solo el séptimo.
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
