# Plantilla de importación — diseño

Documento del mantenedor. Describe **cómo se arma** el Excel que produce el botón
«Plantilla de Excel…» del plugin. Para instrucciones de llenado, mira la hoja
`Instrucciones` del propio archivo.

La plantilla **se deriva de los manifiestos**, nunca se escribe a mano: agregar una variable a
`manifest/*.json` la hace aparecer sola como columna, con su desplegable. El código vive en
[`plugin/royal_catalog_creator/plantilla.rb`](../plugin/royal_catalog_creator/plantilla.rb)
(modelo de columnas) y [`xlsx.rb`](../plugin/royal_catalog_creator/xlsx.rb) (escritura del archivo).

## Hojas

| Hoja | Qué lleva |
|---|---|
| `Modulos` | 1 fila = 1 módulo. Fila 1 = encabezados (congelada). Filas 2–4 = un ejemplo por familia. |
| `Listas` | Una columna por juego de opciones, deduplicado. Alimenta los desplegables. **No editar.** |
| `Instrucciones` | Cómo llenarla, en lenguaje de quien captura. |

## Regla de columnas (lo único que hay que entender)

**La columna se identifica por el campo completo, no por el `attr`.** Dos familias comparten columna
solo si coinciden `attr`, `tipo`, `unidad`, `label` **y el juego completo de opciones**. En cuanto
algo difiere, la columna se parte y cada familia recibe la suya.

Prefijo del encabezado:

- **Sin prefijo** → la columna vale para las tres familias (`Alto (mm)`, `Entrepaño`).
- **`[GAB·ALA]`, `[GAB·ESQ]`** → vale para esas dos (`[GAB·ALA] Ancho (mm)`).
- **`[GAB]`, `[ALA]`, `[ESQ]`** → exclusiva de esa familia (`[GAB] Tipo de techo`).

Por qué importa, con los tres casos reales:

- `EstiloPuerta` existe en Gabinete y Esquinero, pero el primero llega a «4 cajones» y el segundo
  corta en «Puerta uñero». Una columna común con la unión de ambas listas dejaría elegir «4 cajones»
  en un esquinero, que el componente no arma → **dos columnas**.
- El «Diseño de puerta» de Alacena es otro atributo (`c25tipopuerta`, 14 opciones con las Avento) →
  **columna propia**.
- `LenY` es «Profundidad» en Gabinete/Alacena y «Ancho derecho» en Esquinero: mismo atributo,
  significado distinto → **dos columnas**, para que nadie escriba una profundidad donde va un ancho.

## Orden de las columnas

1. `familia` · `nombre_salida`
2. **Bloque común** — todo lo que comparten dos o tres familias, en el orden de grupos del manifiesto
   (dimensiones → espesores → estructura → frente → tirador → divisores).
3. **Bloques por familia** — lo exclusivo de Gabinete, luego Alacena, luego Esquinero.

Estado al 2026-08-14: **62 columnas**.

Ojo con `Cantidad de puertas`: desde que la alacena adoptó la lista del gabinete para sus puertas
normales, ambas familias comparten una sola columna `[GAB·ALA]`. El Avento usa el mismo atributo con
otra numeración (1–10, sin IZQ/DER), así que viaja en su propia columna `[ALA] Cantidad de puertas
(Avento)` — dos columnas para un atributo es lo que evita que un encabezado repetido deje la segunda
inalcanzable al importar.

«Insertar en escena» y «Limpiar piezas ocultas» **no son columnas**: son estado de sesión (viven en
los toggles del editor y aplican a todo lo que se genere). Exportarlas prometería un control por fila
que el importador no puede honrar.

## Convenciones de celda

| Tipo de campo | Qué se escribe |
|---|---|
| `numero` | El número **sin unidad** — la unidad va en el encabezado: `Ancho (mm)`. |
| `select` | La **etiqueta** tal cual (`Puerta lisa`), no el código (`1`). Desplegable bloqueante. |
| `preset` | La etiqueta (`Entrepaño`, `CH (190 mm)`, `Automático (restante)`) **o** una medida libre (`250`), que equivale a «Personalizado». Desplegable **no** bloqueante, justo para permitirlo. |
| `derivado` | El número de divisores/cajones. Sus hijos son columnas aparte (`Espacio 1..7`, `Alto cajón 1..4`). |
| Celda vacía | Se usa el `default` del manifiesto. Nadie tiene que llenar las 64 columnas. |
| Columna de otra familia | Se ignora al importar (con aviso, no error). |

Los encabezados se garantizan **únicos**: es la llave con la que el importador reconoce la columna.
Si dos coincidieran, `unificar_headers` agrega el `attr` entre corchetes.

## Formato del archivo

`.xlsx` real, escrito sin gems (SketchUp no tiene rubyzip ni puede instalar ninguna):

- Zip con entradas **sin comprimir** (método `stored`). Es válido para Excel y evita depender de
  `Zlib::Deflate`; lo único que hace falta de zlib es el CRC32, con respaldo propio si faltara.
- Cadenas **inline** (`t="inlineStr"`), sin `sharedStrings.xml`: una parte menos que sincronizar.
- Los valores puramente numéricos se escriben como número para que Excel no marque cada medida con
  el triángulo de «número guardado como texto».
- `dataValidations` va **después** de `sheetData`: el esquema fija el orden y Excel rechaza el
  archivo si se invierte.

## Importación

El mismo archivo se lee de vuelta con **«Importar…»**. `importer.rb` hace solo el parseo estructural
(archivo → encabezados + celdas de texto) y `app.js` la validación semántica, reusando los predicados
del formulario. Detalles que conviene conocer:

- Acepta `.xlsx` y `.csv`. Leer un `.xlsx` guardado por Excel necesita **descomprimir**, así que ahí
  `zlib` sí es obligatorio; si faltara, el mensaje manda a guardar como CSV.
- **Los CSV de Excel en Windows salen en ANSI (Windows-1252)**, no UTF-8. El lector lo detecta y
  convierte: sin eso, «Puerta uñero» llegaría roto y no coincidiría con ninguna opción.
- El separador se deduce de la primera línea (`,`, `;` o tabulador).
- Acepta también **encabezados crudos** (`divisor>f03espacio1`), así el `Input/Gabinetes.csv` viejo
  sigue sirviendo. Cuando un `attr` corresponde a dos columnas (`EstiloPuerta`), decide la familia de
  la fila.
- Tope de **500 filas** por archivo; se avisa si se recorta.
- Con dos filas del mismo `nombre_salida` se marcan **las dos**: no hay forma de saber cuál es la
  buena. Corregir una libera ambas.

## Pendientes conocidos

- **Alacena y Esquinero no traen `default` en sus dimensiones** (`LenX`/`LenY`/`LenZ` y las
  profundidades), así que sus filas de ejemplo salen vacías en esas columnas — y como esos campos son
  `requerido`, el importador las marcará. Es fiel al manifiesto: el formulario también arranca vacío
  al crear una alacena. Si se les pone un `default`, el ejemplo y el formulario se arreglan solos.
