## Objetivo
Implementar los 5 cambios de `Issues/errors.md` en el plugin Royal Catalog Creator (SketchUp, repo `c:\Users\usuario\Documents\KitchenCreator`): nombrado Divisor/Entrepaño de las copias, desactivar espacios en «separaciones iguales», selector Divisor/Entrepaño/Personalizado en cada margen frontal, campo «con ceja / sin ceja» (`cejaselect`), y separar Alto/Profundidad del zócalo y de la puerta.

## Contexto (arquitectura vigente — respétala)
- Flujo: `html/js/app.js` (formulario) → aplana a fila plana `{ "prefijo>attr": "800mm" }` → `main.rb#generar` (valida) → `engine.rb#generar_unidad` (inyecta atributos, `redraw_with_undo`, `eliminar_ocultos`, `save_as`).
- Regla de oro del proyecto (SCOPE.md §4.2): **la UI se define en datos, no en código**. Toda variable/etiqueta/condición vive en `manifest/gabinete.json|alacena.json|esquinero.json`. Solo agrega código en `app.js`/`engine.rb` cuando el manifiesto no pueda expresarlo, y hazlo genérico (leído desde el manifiesto), sin `if familia == ...`.
- Mecanismos que YA existen y debes reutilizar antes de inventar nada:
  - `habilitado_si: { attr, valor|valores, mensaje }` → aplica `.is-disabled`, pone `disabled` en input/select y **excluye el campo del aplanado** (`flatten()` en `app.js:778`).
  - `tipo: "preset"` → select de opciones + «Personalizado…» con input de medida (`ctrlPreset`, `app.js:514`). Una opción con `valor: ""` **no inyecta nada** (flatten descarta vacíos) y por tanto conserva la fórmula interna del componente dinámico.
  - `Engine.inyectar_atributo` borra `_key_formula` antes de escribir → inyectar `0` sí rompe la fórmula por defecto (esto es lo que se quiere para «Divisor»).
- `introspeccion_dump.txt` es del `GABINETE.skp` del 2026-07-21; el .skp ya cambió (git status lo marca modificado, con copia en `Main Components/before/`). No asumas que el volcado refleja el componente actual.

## Punto 1 — Nombrar Divisor / Entrepaño en la copia (depende del punto 3)
Regla: el nombre lo decide **el modo elegido en el desplegable del punto 3**, no una comparación numérica. Para cada división `i`: modo «Divisor» → nombre `Divisor`; **cualquier otro modo** (Entrepaño y Personalizado, sea cual sea la medida capturada) → nombre `Entrepaño`. Si el campo no aplica o está oculto, el default también es `Entrepaño`.
- Nada de `margen == 0 ? "Divisor" : "Entrepaño"`: la comparación era una inferencia y ya tenemos el dato explícito. Un margen personalizado de 0 mm sigue siendo `Entrepaño`.
- El modo debe **viajar como dato** de la UI al Engine: `app.js` ya conoce la opción seleccionada (`registro.valores[campo.id]`, que es el valor del preset o `__custom__`), así que resuelve ahí el nombre de cada división y mándalo en el payload (ej. `nombres_divisor: ["Divisor", "Entrepaño", …]`, índice 1..n). `main.rb` lo pasa a `Engine.generar_unidad` vía `opts` y el Engine **solo aplica la lista** — no vuelve a inferir nada leyendo la fila plana.
- El nombre va en **el último objeto real de la jerarquía dentro de la copia** (en la imagen `Issues/image-3.png`: `… > Divisor Base > PanelXY#24 > Panel#196`). Ojo: en este componente cada pieza cuelga además de un grupo auxiliar `Scale` (`Группа#13` en el volcado) — ese **no** es el objetivo; desciende al nodo más profundo ignorando `Scale`.
- Se escribe `instancia.name = ...` **solo en la instancia**, nunca en la definición (las definiciones son compartidas con el componente base; renombrar la definición contamina otras unidades).
- Momento: en `engine.rb#generar_unidad`, **después** de `redraw_with_undo` (las copias no existen antes) y **antes** de `eliminar_ocultos` / `save_as`.
- Localiza el contenedor con `buscar_componentes_hijos(inst, "divisor")` (ya matchea `DIA01 - ESPACIO 1 - DivisorHorizontal` y `Divisor Base`).
- Parametriza en el manifiesto, p. ej. `reglas_divisores: { prefijo: "divisor", attr_cantidad: "divisor>f01cantdiv", attr_modo: "divisor>g01margenf{i}", nombres_por_modo: { "0mm": "Divisor" }, nombre_default: "Entrepaño" }` — el mapeo modo→nombre vive en datos y queda amarrado a los mismos valores de preset del punto 3, sin literales repartidos en el código.

**Fase 0 obligatoria antes de codificar el punto 1:** no puedes ejecutar SketchUp. Escribe un script de diagnóstico de un solo uso en `Issues/` (o en la carpeta scratch) que, sobre una unidad ya generada, imprima el árbol del contenedor de divisores (nombre de instancia, nombre de definición, profundidad y `z` de la transformación de cada copia). **Detente y pídeme que lo corra y te pegue la salida** para confirmar: (a) cuál es el nodo hoja correcto, (b) cómo se ordenan las copias respecto a los índices 1..n de `g01margenf{i}` (asunción a verificar: copia 1 = inferior). No implementes el mapeo a ciegas.

## Punto 2 — «Separaciones iguales» desactiva los espacios
Cuando `divisor>f02tipomedida = 1` (Separaciones iguales), los campos `f03espacio1..7` deben quedar oscurecidos y no inyectarse; con valor `2` (Personalizado) quedan activos.
- Espera resolverlo **solo con datos**: agrega `"habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." }` a cada `f03espacioN` en las tres familias. Verifica que `fieldEnabled` + `flatten` ya hacen lo demás; si algo falla (p. ej. combinación con `visible_si`), arregla el mecanismo genérico, no el caso particular.

## Punto 3 — Margen frontal: Divisor / Entrepaño / Personalizado
Cada `g01margenf{i}` (hoy `tipo: "numero"`) pasa a desplegable con tres modos:
- **Divisor** → inyecta `0`.
- **Entrepaño** → no inyecta nada (conserva la fórmula por defecto del componente).
- **Personalizado…** → habilita el input y se inyecta la cantidad en mm.
Usa `tipo: "preset"` con `permite_personalizado: true` y presets `[{ "label": "Entrepaño", "valor": "" }, { "label": "Divisor", "valor": "0mm" }]` (elige y documenta cuál es el default). Confirma que `ctrlPreset.__refreshOptions` no interfiere fuera de cajones (`limiteAltoCajon` devuelve `Infinity` si el attr no está en `attrs_alto` — verifícalo, no lo supongas).
- Este desplegable es la **fuente de verdad del punto 1**: el modo seleccionado decide el nombre de la pieza. Solo el modo «Divisor» nombra `Divisor`; Entrepaño y Personalizado nombran `Entrepaño`. La regla vive en un solo lugar (el mapeo `nombres_por_modo` del manifiesto) y se resuelve una sola vez, en `app.js`, al armar el payload.
- `esquinero.json` hoy **no** tiene campos `g01margenf`; no los agregues sin preguntar.

## Punto 4 — «Con ceja / Sin ceja» → `cejaselect`
Select con `Con ceja = 1` / `Sin ceja = 2`, inyectado en `cejaselect`.
- `cejaselect` **no aparece** en `introspeccion_dump.txt` (volcado viejo) ni pude confirmarlo dentro del .skp. Antes de escribir el campo, **detente y pregúntame** en qué pieza vive el atributo: raíz (`cejaselect`) o hija (`estructura>cejaselect`, `puerta>cejaselect`), y si aplica también a Alacena y Esquinero. Alternativa aceptable: dime que corra `introspeccion.rb` y te pase el resultado.
- Ubicación sugerida en la UI: grupo `frente` (Frente y puertas) de `gabinete.json`; default `1`.

## Punto 5 — Alto y Profundidad independientes del zócalo y la puerta
Hoy el usuario captura la medida **final** (`LenZ` incluye zócalo; `LenY` incluye el grueso de puerta). Se quiere lo contrario: el campo captura la medida del cuerpo y el plugin suma lo que corresponde antes de inyectar. Ej.: Alto 600 mm + zócalo 100 mm → `LenZ = 700 mm`; Profundidad 500 mm + espesor de puerta 18 mm → `LenY = 518 mm`.
- Implementa como **ajuste declarativo del manifiesto** en el campo, p. ej. `"suma": ["a02zocalo"]` / `"suma": ["c02esppuerta"]`, resuelto en la capa de aplanado de `app.js` (una sola función, junto a `effectiveValue`). Nada de aritmética hardcodeada por nombre de campo.
- Muestra en la UI el total resultante como hint del campo (ej. «Total en SketchUp: 700 mm») para que el cambio sea visible.
- **Cuidado con el doble descuento (crítico):**
  - `app.js#presupuestoCajones` lee valores **crudos** del formulario y hoy resta `a02zocalo` vía `reglas_cajones.attr_restar`. Si el campo ya significa alto de cuerpo, restarlo otra vez es un error → ajusta `attr_restar` y/o haz que el presupuesto use el valor crudo correcto.
  - `main.rb#validar_cajones` lee la **fila plana ya compensada** (`LenZ` con zócalo incluido) → ahí el descuento sí debe seguir.
  - Las dos implementaciones son espejo (`app.js:179` y `main.rb:179`): deben quedar consistentes y con el comentario que explique por qué difieren.
- La `nota` de `LenZ` («El alto del mueble incluye el alto del zócalo») queda falsa en `gabinete.json` y `esquinero.json` — actualízala.
- **Antes de codificar, pregúntame** si la suma del espesor de puerta debe aplicarse siempre o solo cuando `EstiloPuerta ≠ 0` y `puerta>f01posextintpu = 1` (puerta exterior). No decidas tú esa condición.

## Alcance
- Trabaja solo en: `plugin/royal_catalog_creator/manifest/*.json`, `plugin/royal_catalog_creator/html/js/app.js`, `plugin/royal_catalog_creator/html/css/style.css` (solo si un control nuevo lo exige), `plugin/royal_catalog_creator/engine.rb`, `plugin/royal_catalog_creator/main.rb`, `SCOPE.md`, `Issues/errors.md`.
- NO toques: `Main Components/*.skp`, `Output/`, `Input/`, `dist/`, `script.rb`, `introspeccion.rb`, `introspeccion_dump.txt`, `plugin/build.ps1`.
- Trabaja los 5 puntos en este orden: 2 → 3 → 1 → 4 → 5 (los datos primero, el código del Engine después, y el cambio con más riesgo de regresión al final).

## Restricciones
- Ruby de SketchUp y JavaScript ES5 (`var`, sin `let/const`, sin flechas, sin `fetch`): `app.js` corre en `UI::HtmlDialog`. Mantén el estilo ES5 existente.
- Cero dependencias nuevas. Cero archivos nuevos salvo el script de diagnóstico de la Fase 0.
- Comentarios en español, explicando el **porqué** (misma densidad y tono que el código actual), no el qué.
- Los tres manifiestos deben quedar coherentes entre sí donde el campo aplique; si una familia no tiene el atributo, pregunta antes de agregarlo.
- Solo haz los cambios pedidos. No refactorices, no renombres, no agregues abstracciones ni features fuera de estos 5 puntos.

## Criterios de aceptación
- [ ] `ruby -c` pasa en `engine.rb` y `main.rb`; los 3 `.json` parsean; `app.js` sin errores de sintaxis (`node --check`).
- [ ] Con `f02tipomedida = 1` los campos `f03espacioN` se ven oscurecidos y **no** aparecen en la fila plana; con `2` sí.
- [ ] Cada `g01margenf{i}` ofrece Divisor / Entrepaño / Personalizado…; «Divisor» inyecta `0`, «Entrepaño» no aparece en la fila plana, «Personalizado» inyecta los mm capturados.
- [ ] `Engine` renombra la instancia hoja de cada copia a `Divisor` o `Entrepaño` según el **modo elegido** en esa división (Personalizado → `Entrepaño`, incluso con 0 mm), sin tocar nombres de definición, y los nombres sobreviven a `eliminar_ocultos` y al `save_as`.
- [ ] El Engine no compara márgenes contra 0 en ningún punto: recibe los nombres ya resueltos desde la UI.
- [ ] Existe el campo con ceja/sin ceja inyectando `cejaselect = 1|2` en la pieza confirmada por mí.
- [ ] Con Alto 600 mm + zócalo 100 mm la fila plana lleva `LenZ = 700mm`; con Profundidad 500 mm + puerta 18 mm lleva `LenY = 518mm`; el presupuesto de cajones sigue dando el mismo alto útil que antes del cambio (sin doble descuento).
- [ ] `SCOPE.md` §5 (Bitácora) tiene una fila por decisión tomada, fechada 2026-07-29; `Issues/errors.md` marca los 5 puntos resueltos.
- [ ] Al terminar, entrégame una **checklist de prueba manual en SketchUp** (qué generar y qué mirar en el Outliner) para los puntos 1, 4 y 5, que son los que no se pueden verificar sin la app.

## Condiciones de paro — detente y pregúntame antes de:
- Implementar el mapeo copia↔índice del punto 1 sin la salida del script de diagnóstico.
- Escribir el campo `cejaselect` sin confirmar en qué pieza vive.
- Fijar la condición de suma del espesor de puerta (punto 5).
- Borrar cualquier archivo, agregar dependencias, tocar los `.skp`, o modificar algo fuera de Alcance.
- Cambiar la firma pública de `Engine.generar_unidad` de forma que rompa `script.rb`.

## Progreso
Después de cada punto terminado, reporta: ✅ [punto N — qué quedó] — [archivos tocados] — [lo que no se pudo verificar sin SketchUp].
