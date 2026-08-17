# Graph Report - KitchenCreator  (2026-08-14)

## Corpus Check
- 37 files · ~2,661,274 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 512 nodes · 1098 edges · 34 communities (31 shown, 3 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.69)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e97f6b2a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- html/js/app.js
- RoyalKitchen::CatalogCreator::Xlsx
- RoyalKitchen::CatalogCreator
- plugin-demo/js/app.js
- engine.rb — motor de inyección y post-procesos geométricos
- RoyalKitchen::CatalogCreator::Engine
- RoyalKitchen::CatalogCreator::Plantilla
- Validación previa de importación sin efectos secundarios
- Manifiesto por familia — fuente única de la UI
- Presupuesto de alto de cajones
- introspeccion.rb
- «Generar todos» — cola secuencial con cancelación por unidad
- Prompt Templates Reference
- Royal Catalog Creator (extensión SketchUp)
- Carpeta del proyecto (contiene «Main Components»)
- plantilla.rb — modelo de columnas derivado de los manifiestos
- DiagEntrepanos
- DiagUnion
- Royal Sophisticated Concepts Logo (dialog asset)
- Royal Catalog Creator Toolbar Icon
- script.rb
- build.ps1 — empaquetado del .rbz
- RoyalKitchen
- prompt.md
- prompt-31.md
- Plantilla de importación — diseño
- importer.rb — parseo estructural de CSV/XLSX
- reglas.test.js
- Definición de variables por módulo
- errors.md
- Barra lateral del diálogo (lista de módulos y acciones)

## God Nodes (most connected - your core abstractions)
1. `RoyalKitchen::CatalogCreator::Xlsx` - 27 edges
2. `RoyalKitchen::CatalogCreator` - 21 edges
3. `init()` - 17 edges
4. `erroresConfig()` - 16 edges
5. `validarFila()` - 16 edges
6. `validarFila()` - 16 edges
7. `el()` - 15 edges
8. `renderEditor()` - 15 edges
9. `Prompt Templates Reference` - 15 edges
10. `DiagEntrepanos` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Presupuesto de alto de cajones (implementación en el plugin)` --semantically_similar_to--> `Presupuesto de alto de cajones`  [INFERRED] [semantically similar]
  plugin/README.md → MANUAL_TECNICO.md
- `Limpieza de piezas ocultas (Engine.eliminar_ocultos)` --semantically_similar_to--> `Eliminar piezas ocultas al generar`  [INFERRED] [semantically similar]
  plugin/README.md → MANUAL_TECNICO.md
- `El diálogo corre sobre el CEF de SketchUp` --rationale_for--> `Barra lateral del diálogo (lista de módulos y acciones)`  [INFERRED]
  CLAUDE.md → plugin/royal_catalog_creator/html/dialog.html
- `manifest/_comunes.json con campos compartidos por $ref` --conceptually_related_to--> `Manifiesto por familia — fuente única de la UI`  [AMBIGUOUS]
  SCOPE.md → MANUAL_TECNICO.md
- `validarFila()` --indirect_call--> `campo()`  [INFERRED]
  plugin/royal_catalog_creator/html/js/app.js → test/reglas.test.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Cadena Ruby de generación y captura** — manual_tecnico_main_rb, manual_tecnico_engine_rb, manual_tecnico_plantilla_rb, manual_tecnico_xlsx_rb, manual_tecnico_importer_rb [EXTRACTED 1.00]
- **Flujo de importación masiva de punta a punta** — manual_tecnico_plantilla_rb, manual_tecnico_importer_rb, manual_tecnico_validacion_previa_importacion, manual_tecnico_prefijos_aplicabilidad, plugin_royal_catalog_creator_html_dialog_pane_import, manual_usuario_via_masiva [EXTRACTED 1.00]
- **Espejos de la regla de presupuesto de cajones** — manual_tecnico_presupuesto_cajones, plugin_readme_presupuesto_cajones, manual_tecnico_espejo_reglas_cajones, manual_usuario_minimo_alto_cajon, manual_tecnico_medida_cuerpo_vs_total [INFERRED 0.85]
- **Icon visual language: cabinet subject + create badge + flat teal palette form the extension's toolbar identity** — plugin_royal_catalog_creator_images_icon_cabinet_glyph, plugin_royal_catalog_creator_images_icon_plus_badge, plugin_royal_catalog_creator_images_icon_flat_teal_palette, plugin_royal_catalog_creator_images_icon_toolbar_identity [INFERRED 0.85]
- **Royal visual identity carried into the plugin dialog** — plugin_royal_catalog_creator_html_img_logo_royal_logo_asset, plugin_royal_catalog_creator_html_img_logo_shield_castle_mark, plugin_royal_catalog_creator_html_img_logo_royal_wordmark, plugin_royal_catalog_creator_html_img_logo_teal_palette, plugin_royal_catalog_creator_html_img_logo_dialog_branding [INFERRED 0.85]

## Communities (34 total, 3 thin omitted)

### Community 0 - "html/js/app.js"
Cohesion: 0.07
Nodes (98): activeRegistro(), actualizarBotonLote(), aplicarAltosAutomaticos(), aplicarForzados(), armarImportacion(), attrActivo(), attrMm(), attrMmCrudo() (+90 more)

### Community 1 - "RoyalKitchen::CatalogCreator::Xlsx"
Cohesion: 0.12
Nodes (3): RoyalKitchen, RoyalKitchen::CatalogCreator, RoyalKitchen::CatalogCreator::Xlsx

### Community 2 - "RoyalKitchen::CatalogCreator"
Cohesion: 0.11
Nodes (5): RoyalKitchen, RoyalKitchen::CatalogCreator, RoyalKitchen::CatalogCreator::Importer, RoyalKitchen, RoyalKitchen::CatalogCreator

### Community 3 - "plugin-demo/js/app.js"
Cohesion: 0.08
Nodes (84): activeRegistro(), actualizarBotonLote(), aplicarAltosAutomaticos(), armarImportacion(), attrMm(), attrNumber(), attrRaw(), autoNombre() (+76 more)

### Community 4 - "engine.rb — motor de inyección y post-procesos geométricos"
Cohesion: 0.15
Nodes (17): Instrucción de consola Ruby para correr el script legado, Eliminar piezas ocultas al generar, engine.rb — motor de inyección y post-procesos geométricos, Notación «prefijo>atributo» y conversión de unidades a pulgadas, Roadmap y siguientes pasos, script.rb — script legado de generación por CSV, Sondas de diagnóstico Issues/diag_*.rb, Fusión de mitades de entrepaño del Esquinero (Solid Tools) (+9 more)

### Community 5 - "RoyalKitchen::CatalogCreator::Engine"
Cohesion: 0.16
Nodes (4): DiagDivisores, RoyalKitchen, RoyalKitchen::CatalogCreator, RoyalKitchen::CatalogCreator::Engine

### Community 6 - "RoyalKitchen::CatalogCreator::Plantilla"
Cohesion: 0.23
Nodes (3): RoyalKitchen, RoyalKitchen::CatalogCreator, RoyalKitchen::CatalogCreator::Plantilla

### Community 7 - "Validación previa de importación sin efectos secundarios"
Cohesion: 0.29
Nodes (7): El diálogo corre sobre el CEF de SketchUp, Validación previa de importación sin efectos secundarios, Importar agrega módulos a la sesión, no la reemplaza, La tabla de revisión usa controles propios, Modal de confirmación genérico (#modal-confirm), Panel de revisión de importación (#pane-import), Modal propio en vez de window.confirm()

### Community 8 - "Manifiesto por familia — fuente única de la UI"
Cohesion: 0.24
Nodes (10): app.js — render, reglas condicionales, validación y lote, Familias: Gabinete, Alacena, Esquinero, Manifiesto por familia — fuente única de la UI, Motor agnóstico a la familia, Guía de captura — referencia de campos por familia, Editor de caja (box_model) para los márgenes del frente, Ruby parsea, JavaScript valida (importación), Panel editor del módulo (#pane-editor) (+2 more)

### Community 9 - "Presupuesto de alto de cajones"
Cohesion: 0.25
Nodes (8): introspeccion.rb — volcado de atributos y fórmulas, El formulario captura la medida del cuerpo, no la total (bloque «suma»), Presupuesto de alto de cajones, Alto mínimo de frente de cajón = 100 mm, Notas de la definición pendientes con el mantenedor, Presupuesto de alto de cajones (implementación en el plugin), Hallazgo de introspección: componentes melaminapro sin curación nativa, Preguntas abiertas del alcance

### Community 10 - "introspeccion.rb"
Cohesion: 0.52
Nodes (6): etiqueta_entidad(), in_meta_key?(), introspeccionar(), leer_meta(), variables_reales(), volcar_entidad()

### Community 11 - "«Generar todos» — cola secuencial con cancelación por unidad"
Cohesion: 0.25
Nodes (8): Lote estrictamente secuencial, Clonar módulo para producir variaciones, Vía visual — captura módulo por módulo, «Generar todos» — cola secuencial con cancelación por unidad, registro_id en el payload y en todas las respuestas de generar, Auto-tiling: el mapa de cocina es la escena nativa de SketchUp, Modelo de sesión: lista de registros y aceleradores, Salida doble: archivo en carpeta + inserción en la escena

### Community 12 - "Prompt Templates Reference"
Cohesion: 0.05
Nodes (34): Agentic Patterns, Context Patterns, Credit-Killing Patterns Reference, Format Patterns, Reasoning Patterns, Scope Patterns, Task Patterns, Prompt Templates Reference (+26 more)

### Community 13 - "Royal Catalog Creator (extensión SketchUp)"
Cohesion: 0.50
Nodes (5): Royal Catalog Creator (extensión SketchUp), Separación estricta Ruby (modelo/disco) vs JavaScript (semántica), main.rb — capa de aplicación, menú, diálogo y callbacks, Puente de mensajes JS↔Ruby (6 callbacks / 5 receptores), KitchenCreator — repositorio

### Community 14 - "Carpeta del proyecto (contiene «Main Components»)"
Cohesion: 0.29
Nodes (7): Carpeta del proyecto (contiene «Main Components»), Regla de cajones implementada dos veces (app.js y main.rb), Riesgos operativos y mitigación, La salida se sobrescribe sin versionar, Catálogo de mensajes y solución de problemas, Detección de CSV en Windows-1252, Estado de la carpeta del proyecto en el pie de la barra lateral

### Community 15 - "plantilla.rb — modelo de columnas derivado de los manifiestos"
Cohesion: 0.50
Nodes (5): plantilla.rb — modelo de columnas derivado de los manifiestos, Prefijos de aplicabilidad de columna [GAB]·[ALA]·[ESQ], Reglas condicionales por campo (habilitado_si / visible_si), Vía masiva — plantilla de Excel, importación y lote, Plantilla generada desde el manifiesto (encaja por construcción)

### Community 18 - "Royal Sophisticated Concepts Logo (dialog asset)"
Cohesion: 0.60
Nodes (5): Branding of the SketchUp Dialog UI, Royal Sophisticated Concepts Logo (dialog asset), ROYAL / Sophisticated Concepts Wordmark, Teal Shield-and-Castle Brand Mark, Teal Corporate Color Palette (#4FB3A3 family)

### Community 19 - "Royal Catalog Creator Toolbar Icon"
Cohesion: 0.70
Nodes (5): Royal Catalog Creator Toolbar Icon, Cabinet Glyph (front elevation with two drawer pulls), Flat Teal Two-Tone Palette, Plus Badge (create/generate affordance), Toolbar Icon as Extension Entry Point

### Community 20 - "script.rb"
Cohesion: 0.70
Nodes (4): buscar_componentes_hijos(), gm_detect_sep(), gm_generar(), gm_interpret()

### Community 21 - "build.ps1 — empaquetado del .rbz"
Cohesion: 0.67
Nodes (4): build.ps1 — empaquetado del .rbz, Regla de reempaquetado del .rbz al cerrar issue, Rutas del zip con «/» (System.IO.Compression), Empaquetar el .rbz (estructura y separador de rutas)

### Community 24 - "prompt.md"
Cohesion: 0.15
Nodes (12): Alcance, Condiciones de paro — detente y pregúntame antes de:, Contexto (arquitectura vigente — respétala), Criterios de aceptación, Objetivo, Progreso, Punto 1 — Nombrar Divisor / Entrepaño en la copia (depende del punto 3), Punto 2 — «Separaciones iguales» desactiva los espacios (+4 more)

### Community 25 - "prompt-31.md"
Cohesion: 0.15
Nodes (12): Alcance, Condiciones de paro — detente y pregúntame antes de:, Contexto (arquitectura vigente — respétala), Criterios de aceptación, Fase 0 — Diseño de la plantilla (entrega y **detente**), Lee esto antes de tocar código (obligatorio), Objetivo, Progreso (+4 more)

### Community 26 - "Plantilla de importación — diseño"
Cohesion: 0.22
Nodes (8): Convenciones de celda, Formato del archivo, Hojas, Importación, Orden de las columnas, Pendientes conocidos, Plantilla de importación — diseño, Regla de columnas (lo único que hay que entender)

### Community 27 - "importer.rb — parseo estructural de CSV/XLSX"
Cohesion: 0.40
Nodes (5): importer.rb — parseo estructural de CSV/XLSX, xlsx.rb — lector/escritor mínimo de .xlsx sin gems, Tope de 500 filas por importación, Escritura de .xlsx sin gems (zip sin comprimir, cadenas inline), Bitácora de decisiones fechadas

### Community 28 - "reglas.test.js"
Cohesion: 0.47
Nodes (4): campo(), errores(), plano(), registro()

### Community 29 - "Definición de variables por módulo"
Cohesion: 0.40
Nodes (4): Definición de variables por módulo, Ejemplo ya lleno (Gabinete), Las 4 columnas, Notas útiles

### Community 30 - "errors.md"
Cohesion: 0.50
Nodes (3): Entrepaño y Divisores, Esquinero (prompt-30), Gabinete General

### Community 33 - "Barra lateral del diálogo (lista de módulos y acciones)"
Cohesion: 0.40
Nodes (5): Carpeta «Main Components» con los tres modelos base, La plantilla se descarga sin selector de ruta, Barra lateral del diálogo (lista de módulos y acciones), Componente base siempre desde archivo, nunca desde la escena, Plan de trabajo inicial del proyecto

## Ambiguous Edges - Review These
- `Manifiesto por familia — fuente única de la UI` → `manifest/_comunes.json con campos compartidos por $ref`  [AMBIGUOUS]
  MANUAL_TECNICO.md · relation: conceptually_related_to

## Knowledge Gaps
- **77 isolated node(s):** `RoyalKitchen::CatalogCreator`, `PRIMACY ZONE — Identity, Hard Rules, Output Lock`, `Intent Extraction`, `Tool Routing`, `Credential Safety` (+72 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Manifiesto por familia — fuente única de la UI` and `manifest/_comunes.json con campos compartidos por $ref`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `campo()` connect `reglas.test.js` to `html/js/app.js`, `plugin-demo/js/app.js`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Why does `validarFila()` connect `html/js/app.js` to `reglas.test.js`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `validarFila()` connect `plugin-demo/js/app.js` to `reglas.test.js`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `init()` (e.g. with `cerrarConfirm()` and `clonarActivo()`) actually correct?**
  _`init()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `RoyalKitchen::CatalogCreator`, `PRIMACY ZONE — Identity, Hard Rules, Output Lock`, `Intent Extraction` to the rest of the system?**
  _77 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `html/js/app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07090909090909091 - nodes in this community are weakly interconnected._