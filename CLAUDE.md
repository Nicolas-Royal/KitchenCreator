# CLAUDE.md

Contexto e instrucciones para Claude Code en este repositorio.

## Qué es el proyecto

Royal Catalog Creator: una extensión de SketchUp que genera las variaciones del
catálogo de Royal Kitchens (gabinetes, alacenas, esquineros) a partir de un
formulario o de una hoja de Excel, en lugar de modelar cada mueble a mano.

El código de la extensión vive en `plugin/`. Todo lo demás del repositorio
—`Output/`, `capturas/`, `Definiciones/`, `Input/`, `3D/`, los manuales— es
insumo, evidencia o documentación, y no se empaqueta.

Referencia completa: `MANUAL_TECNICO.md` (arquitectura, modelo de datos,
operación) y `MANUAL_USUARIO.md`.

## Regenerar el paquete al cerrar una issue

**Siempre que termines una issue que toque el ejecutable, vuelve a generar el
paquete en `dist/` antes de dar el trabajo por cerrado.** SketchUp instala la
extensión desde ese `.rbz`, así que si no se regenera, el arreglo existe en el
repositorio pero no en lo que se puede importar: quien pruebe la issue seguirá
instalando la versión anterior y verá el bug ya corregido.

Comando:

```
powershell -ExecutionPolicy Bypass -File "plugin\build.ps1"
```

Salida: `dist/royal_catalog_creator.rbz`, listo para *Extensions → Extension
Manager → Install Extension* en SketchUp.

**Qué cuenta como «toca el ejecutable»** — cualquier archivo que entre en el
`.rbz`, es decir todo lo que cuelga de `plugin/`:

| Ruta | Qué es |
|---|---|
| `plugin/royal_catalog_creator.rb` | Registrar que SketchUp descubre |
| `plugin/royal_catalog_creator/*.rb` | `main.rb`, `engine.rb`, `importer.rb`, `plantilla.rb`, `xlsx.rb` |
| `plugin/royal_catalog_creator/manifest/*.json` | Definición de variables por familia |
| `plugin/royal_catalog_creator/html/**` | Diálogo: `dialog.html`, `css/`, `js/`, `img/` |
| `plugin/royal_catalog_creator/images/**` | Iconos de la barra de herramientas (`icon.png`) |

Los cambios de CSS y JS cuentan: el diálogo se sirve desde dentro del paquete.

No hace falta regenerar si la issue solo tocó documentación, `Output/`,
`capturas/`, `Definiciones/`, `Input/`, `3D/` o `plugin/README.md` (este último
se excluye del paquete a propósito).

El `.rbz` se versiona en el repositorio, así que el commit del paquete va junto
con el cambio que lo motiva — no en un commit aparte y no en otra rama.

## Notas de entorno

- Windows con PowerShell 5.1. `build.ps1` depende de `System.IO.Compression`
  para escribir las rutas del zip con `/`; el instalador de SketchUp las
  rechaza con `\`.
- El diálogo corre sobre el CEF que embarca SketchUp, no sobre Chrome. Probar
  la UI en un navegador sirve para medir layout, pero la verificación final es
  abrir el diálogo en SketchUp.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
