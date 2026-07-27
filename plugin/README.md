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

- **Dimensiones** — `LenX/LenY/LenZ` (+ `a02zocalo` en Gabinete/Esquinero).
- **Espesores** — estructura/puerta/fondo (+ los de cajón en Gabinete).
- **Estructura e interior** — tipo de techo, ancho de amarres y **Entrepaño** (`c24entrepano`).
- **Frente y puertas** — diseño de puerta, cantidad/posición de puertas, separación y márgenes.
- **Tirador** — tipo, posición y orientación.
- **Cajones** (solo Gabinete) — estilo, alturas, separación y corredera. Estos campos están
  **siempre activos**; únicamente «Cantidad de cajones» se habilita cuando el diseño de puerta es
  «N cajones» (habilitación **por campo** vía `habilitado_si`, no por grupo).
- **Divisores** — cantidad de divisores (contador) con sus espacios y márgenes.

## Estructura

```
royal_catalog_creator.rb          Registrar (SketchupExtension)
royal_catalog_creator/
  main.rb                         Menú/toolbar, HtmlDialog y callbacks
  engine.rb                       Motor de inyección (refactor de script.rb)
  manifest/gabinete.json          Manifiesto curado = única fuente de la UI
  html/dialog.html · css · js     Interfaz moderna (tema claro/oscuro)
```

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
- Los márgenes de puerta (`f11..f14`) y separaciones se toman **sin prefijo** tal como los define
  `gabinete.csv` (en `Input/Gabinetes.csv` viejo iban con prefijo `puerta>`). Revisar cuál es el correcto.
