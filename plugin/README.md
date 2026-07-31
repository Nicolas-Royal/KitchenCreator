# Royal Catalog Creator — Plugin de SketchUp

Interfaz visual (`UI::HtmlDialog`) para generar variaciones de muebles de catálogo sin editar
CSV ni usar la consola Ruby. Reusa el motor de inyección de atributos validado en
[`../script.rb`](../script.rb).

## Estado (v1)

| Familia | Estado |
|---|---|
| **Gabinete** | ✅ Activo — `manifest/gabinete.json` (desde `Definiciones/gabinete.csv`). |
| **Alacena** | ✅ Activo — `manifest/alacena.json` (desde `Definiciones/alacena.csv`). |
| **Esquinero** | ✅ Activo — `manifest/esquinero.json` (desde `Definiciones/esquinero.csv`). |

Agregar una familia = crear su `manifest/<familia>.json` y activarla en `FAMILIAS` (main.rb). Sin más código.

### Grupos del formulario

Los campos se agrupan por bloque temático (el manifiesto define el orden):

- **Dimensiones** — `LenX/LenY/LenZ` (+ `a02zocalo` en Gabinete/Esquinero). En **Esquinero** las tres
  no significan lo mismo: el mueble tiene dos alas, así que `LenX`/`LenY` son el **ancho izquierdo**
  y el **derecho**, y la profundidad de cada una va en `a0101profizq` / `a0102profder`.
- **Espesores** — estructura/puerta/fondo (+ los de cajón en Gabinete).
- **Estructura e interior** — ancho de amarres y **Entrepaño** (`c24entrepano`); **tipo de techo solo en
  Gabinete** (Alacena no lo lleva y el Esquinero trae el suyo fijo en el componente base).
- **Frente y puertas** — diseño de puerta, cantidad/posición de puertas, separación y márgenes
  (estos últimos en el **editor de caja**, ver abajo).
- **Tirador** — tipo, posición y orientación.
- **Cajones** (solo Gabinete) — estilo, alturas, separación y corredera. Estos campos están
  **siempre activos**; únicamente «Cantidad de cajones» se habilita cuando el diseño de puerta es
  «N cajones» (habilitación **por campo** vía `habilitado_si`, no por grupo). Los «Alto cajón»
  ofrecen **Automático (restante) / CH / G / Personalizado** y solo se muestran cuando el diseño de
  puerta implica esa cantidad de cajones (`visible_si.min_cajones`). Con **«N cajones» se muestra
  uno solo**: el componente hace los cajones copia del primero, así que todos miden lo mismo
  (`reglas_cajones.uniforme_si_n`).

### Editor de caja para márgenes

Un grupo puede declarar `box_model` y sus cuatro márgenes se dibujan **en su posición** alrededor de
un rectángulo, en vez de en fila:

```json
"box_model": { "titulo": "Márgenes del frente", "centro": "Frente",
               "arriba": "f11margsupcaj", "abajo": "f12marginfcaj",
               "izquierda": "f13margizqcaj", "derecha": "f14margdercaj" }
```

Los campos siguen siendo campos normales del manifiesto (mismo `attr`, `visible_si`, aplanado); lo
único que cambia es dónde los coloca el render. `label_corto` da la etiqueta breve para dentro del
widget. Lo usan el grupo «Frente y puertas» de las tres familias y «Divisores» del Esquinero (en
vista de planta: frontal abajo, posterior arriba).

## Presupuesto de alto de cajones

La fórmula interna del componente reparte el alto en partes iguales
(`=(LenZ − f02sepcajtirad*(a21cantcajon−1))/a21cantcajon`) pero **no tiene piso**: si el reparto
queda por debajo del alto físico mínimo del cajón, el componente lo recorta hacia arriba y la pila
traspasa el mueble. El plugin hace la misma cuenta **antes** de generar:

```
util       = LenZ − a02zocalo − f11margsupcaj − f12marginfcaj
disponible = util − f02sepcajtirad × (n − 1)      // suma de los n frentes
```

- Un renglón bajo el título del grupo muestra en vivo *alto útil / asignado / restante por cajón*.
- El contador «Cantidad de cajones» se topa solo en cuantos caben al mínimo.
- **Los presets que ya no caben dejan de ofrecerse.** Cada desplegable filtra CH/G contra el alto
  que le queda a ese cajón sin dejar a los demás bajo el mínimo (`limiteAltoCajon`); «Automático»,
  «Personalizado…» y la opción ya seleccionada nunca se ocultan — si lo elegido dejó de caber, quien
  avisa es el presupuesto en rojo, no un `<select>` que salta solo.
- **Generar se bloquea** si algún alto queda bajo el mínimo o si los altos fijados se pasan; que
  **sobre** alto no bloquea (deja hueco, no desborda).
- Los cajones en «Automático» reciben el alto restante ya calculado, para que el `.skp` coincida
  con lo que mostró el presupuesto.
- En modo **uniforme** («N cajones») el único alto capturado se multiplica por los n cajones.

Todo se configura en `reglas_cajones` del manifiesto (`alto_min_mm`, qué attrs restar, el mapa
`estilos_con_cajones`, `uniforme_si_n`). Es **dato, no código**: si el mínimo real del herraje no es
100 mm, se cambia ahí. Una familia sin `reglas_cajones` (Alacena, Esquinero) no se valida.

`cajon>a21cantcajon` admite 1-6 y solo existen cuatro `b1Xaltocaj`, pero en «N cajones» basta con el
primero porque todos los cajones son copias suyas.
- **Divisores** — cantidad de divisores (contador) con sus espacios y márgenes, intercalados:
  espacio 1 → margen 1 → espacio 2 → margen 2 → …

## Unión de mitades (Esquinero)

El esquinero modela cada repisa en L como **dos prismas independientes** (`P01-ESQ` + `P02-ESQ`)
dentro de un nodo `ENTREPAÑO`, así que el `.skp` entregaba dos tableros donde debe haber una pieza.
Al generar, después de aplicar las medidas, se fusionan en un solo sólido llamado **«Entrepaño»**.

```json
"reglas_union": { "grupo": "entrepaño", "piezas": ["p01-esq", "p02-esq"], "nombre": "Entrepaño" }
```

Es dato: una familia sin `reglas_union` (Gabinete, Alacena) no ejecuta el paso. A diferencia de
`reglas_divisores`, no viaja en el payload —no hay nada que decida la diseñadora— y `main.rb` lo lee
del manifiesto directo.

Tres detalles que no son obvios:

- Cada mitad es un prisma cerrado (6 caras, 12 aristas) pero **no** es `manifold?`: trae colgando un
  grupo `SPanel` de una cara, y SketchUp solo considera sólido lo que contiene únicamente caras y
  aristas. Por eso se unen **copias limpias** de cada mitad, no las piezas originales.
- Requiere **SketchUp Pro** (Solid Tools). Sin Pro sale un aviso y las mitades quedan separadas; el
  mueble se genera igual.
- Como `eliminar_ocultos`, destruye la estructura dinámica de la pieza: el entrepaño del `.skp` ya no
  es reconfigurable. Es el mismo trato que ya tenía el archivo de salida.

## Limpieza de piezas ocultas

El componente trae dentro todas las variantes de puerta y cajón y oculta (`hidden = 1`) las que no
aplican; el `.skp` de salida se llevaría decenas de componentes muertos. El toggle **«Limpiar piezas
ocultas»** (encendido por default, junto a «Insertar en escena») las borra después del redibujado y
antes de guardar.

**Tiene un costo:** el `.skp` generado queda como pieza final — si después alguien cambia un valor en
SketchUp, el componente dinámico ya no puede volver a mostrar lo borrado. Apaga el toggle cuando
necesites un módulo reconfigurable.

Detalle de implementación que no se debe tocar a la ligera: `inst.make_unique` solo independiza la
definición **raíz**; las anidadas siguen compartidas con `Main Components/*.skp` y con las unidades
ya insertadas en la escena. Por eso `Engine.eliminar_ocultos` hace único cada contenedor anidado
—cuando su definición tiene más de una instancia— antes de borrar dentro de él. Sin eso, generar
mutilaría el componente base.

Vale para **todo** lo que modifique geometría, no solo para la limpieza: que una definición tenga
`instances.size == 1` **no** prueba que sea exclusiva de esta unidad, porque si un ancestro está
compartido esa única instancia se dibuja también dentro del base. Por eso la unión de mitades busca
su contenedor con `Engine.buscar_para_modificar`, que independiza cada contenedor por el que pasa,
en vez de con `buscar_componentes_hijos`, que es solo de lectura.

## Estructura

```
royal_catalog_creator.rb          Registrar (SketchupExtension)
royal_catalog_creator/
  main.rb                         Menú/toolbar, HtmlDialog y callbacks
  engine.rb                       Motor de inyección (refactor de script.rb)
  manifest/gabinete.json          Manifiesto curado = única fuente de la UI
  html/dialog.html · css · js     Interfaz moderna (tema claro/oscuro)
```

## Empaquetar el `.rbz`

```powershell
powershell -ExecutionPolicy Bypass -File "<repo>\plugin\build.ps1"
```

Genera `dist/royal_catalog_creator.rbz` y lista lo empaquetado para revisarlo. Un `.rbz` es un
`.zip` renombrado cuya **raíz** contiene `royal_catalog_creator.rb` + la carpeta
`royal_catalog_creator/`; el `README.md` del plugin no entra.

Si lo armas a mano, comprime esos **dos** elementos (no la carpeta `plugin/` completa, o quedarían
un nivel más abajo y SketchUp no encontraría el registrar). Ojo con el separador de rutas: tanto
`Compress-Archive` de PowerShell 5.1 como `ZipFile::CreateFromDirectory` sobre .NET Framework
escriben `\` dentro del zip y SketchUp espera `/` — por eso el script arma las entradas a mano.

Para instalarlo: SketchUp ▸ `Extensiones ▸ Administrador de extensiones ▸ Instalar extensión` y
elige el `.rbz`.

## Instalación (producción)

Copia **`royal_catalog_creator.rb` y la carpeta `royal_catalog_creator/`** a la carpeta de plugins
de SketchUp:

```
%APPDATA%\SketchUp\SketchUp 2023\SketchUp\Plugins\
```

Reinicia SketchUp. Aparece en `Extensiones ▸ Royal Catalog Creator` y como botón de barra.

## Carga en desarrollo (sin instalar)

En la consola Ruby de SketchUp (`Ventana ▸ Consola Ruby`):

```ruby
load "C:/Users/usuario/Documents/Royal-Kitchen-Tools/Catalog Creator/plugin/royal_catalog_creator.rb"
```

## Carpeta del proyecto

El plugin necesita saber dónde están `Main Components/` (componente base `GABINETE.skp`) y `Output/`.
- Si se carga desde esta ubicación en el repo, la detecta sola.
- Si se instala en la carpeta de Plugins, usa **«Cambiar carpeta…»** (abajo en la barra lateral) y
  señala la carpeta que contiene `Main Components`. Se recuerda entre sesiones.

## Uso

1. **+ Nuevo módulo** → elige **Gabinete**, **Alacena** o **Esquinero**.
2. Ajusta los campos (agrupados: Dimensiones / Espesores / Estructura e interior / Frente y puertas / Tirador / Cajones / Divisores).
3. (Opcional) activa **Insertar en escena** para colocar la unidad en el modelo (auto-tiling en +X).
4. **Generar** → crea `Output/Gabinetes/<nombre>.skp`.
5. **Clonar** duplica un módulo para variar 1–2 valores.

## Notas de la definición (pendientes con el mantenedor)

- **Espesor fondo de cajones** → `cajon>c07espfondope` (nombre real hallado en `introspeccion_dump.txt`;
  el `cajon>c06esppuertape` duplicado que traía `gabinete.csv` se corrigió). Confirmar que
  `cajon>c06esppuertape` (espesor de puerta de cajón) exista en `GABINETE.skp` — no aparece en el volcado,
  se asume agregado después.
- **`c24entrepano`** (Entrepaño, las tres familias): polaridad tomada del CSV → **Sí = `0`, No = `1`**.
  Verificar en SketchUp que la opción no esté invertida.
- **`c25tipopuerta` (Alacena):** la lista del CSV arrastra una cola de copiado
  (`... (13) (8) / 4 CAJONES (9)`). El manifiesto usa la lista limpia 0–13 (Ninguna, Lisa, Italiana,
  Vidrio, Vidrio-madera, Uñero, Avento S ×4, Avento D ×4). Confirmar códigos.
- Presets CH/G del alto de cajón (`b11altocaj1`): CH=190 mm, G=383 mm (según nota del CSV).
- **`alto_min_mm = 100`** en `reglas_cajones` (valor pedido, 2026-07-27); falta confirmarlo contra la
  ficha del herraje (Tandem vs Antaro). Para medirlo: generar un gabinete de `LenZ = 400 mm` con
  4 cajones y leer el `v01altocajon1` resultante — ese es el recorte real del componente.
- **`divisor>f03espacio7` es inalcanzable:** pide `f01cantdiv ≥ 7` y el contador topa en 6. Si de
  verdad son `n+1` espacios para `n` divisores, hay que recorrer los `visible_si` de todos los
  espacios, no solo agregar el séptimo. Pendiente de confirmar con el mantenedor.
- `b11altocaj1..b14altocaj4` **no aparecen** en `introspeccion_dump.txt` (volcado del 21-jul;
  `GABINETE.skp` se modificó el 23-jul). Volver a correr `introspeccion.rb` —ahora vuelca el texto
  de las fórmulas— para confirmar en qué entidad viven y si `COA01` («N cajones») los lee.
- Los márgenes de puerta (`f11..f14`) y separaciones se toman **sin prefijo** tal como los define
  `gabinete.csv` (en `Input/Gabinetes.csv` viejo iban con prefijo `puerta>`). Revisar cuál es el correcto.
