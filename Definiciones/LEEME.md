# Definición de variables por módulo

Aquí defines **qué variables** se van a poder modificar en el plugin para cada familia
(Gabinete, Alacena, Esquinero). Llena un archivo por módulo:

- `gabinete.csv`
- `alacena.csv`
- `esquinero.csv`

Cada archivo tiene las mismas **4 columnas**. Ábrelos en Excel, llena las filas y me los
regresas — con eso construyo el manifiesto (`manifest/*.json`) de cada familia.

## Las 4 columnas

| Columna | Qué va aquí | Ejemplo |
|---|---|---|
| **nombre** | Nombre técnico exacto de la variable en el componente. Con prefijo `>` si vive en un hijo (`estructura`/`puerta`/`divisor`); sin prefijo si es de la raíz. | `a02zocalo`, `divisor>f01cantdiv` |
| **valor a asignar** | El/los valores estándar o el rango que la diseñadora podrá elegir. Puede ser una medida (`800mm`), una lista de opciones (`Cerrado=1 / Marco=3`), o presets (`CH=150mm / G=300mm`). | `CH=150mm / G=300mm` |
| **descripcion** | El texto **legible** que verá la diseñadora en el plugin (porque el componente no lo trae). | `Alto del zócalo` |
| **nota** | Cualquier aclaración: si es preset, derivado (cajones), requerido, unidades, dudas, etc. | `Preset. Default CH.` |

## Ejemplo ya lleno (Gabinete)

| nombre | valor a asignar | descripcion | nota |
|---|---|---|---|
| LenX | 600 / 700 / 800 mm | Ancho del módulo | Requerido. Variable estándar de tamaño. |
| a02zocalo | CH=100mm / G=150mm | Zócalo | Preset. Default CH. |
| estructura>e22tipotecho | Cerrado=1 / Marco=3 / Abierto=4 | Tipo de techo | Verificar códigos reales. |
| divisor>f01cantdiv | 1 / 2 / 3 | Número de cajones | DERIVADO: genera "Alto cajón 1..N". |
| divisor>f03espacio1 | CH=150mm / G=300mm | Alto de cada cajón | Preset por cajón. i=1 = ¿superior o inferior? |

## Notas útiles

- Si no sabes el nombre técnico exacto, corre `introspeccion.rb` sobre el `.skp` de esa familia
  (cambiando `BASE_COMPONENT_PATH`) y busca la variable en `introspeccion_dump.txt`.
- Marca con `[?]` en la columna **nota** cualquier variable de la que no estés seguro; la reviso.
- No incluyas variables con fórmula ni separadores (`----`): esas son internas, no van a la UI.
