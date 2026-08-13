# Graph Report - KitchenCreator  (2026-08-13)

## Corpus Check
- Large corpus: 83 files · ~2,655,462 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 283 nodes · 583 edges · 24 communities (22 shown, 2 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 34 edges (avg confidence: 0.74)
- Token cost: 217,681 input · 0 output

## Community Hubs (Navigation)
- Dialog UI Runtime (app.js)
- XLSX Reader/Writer Without Gems
- Application Layer and Callbacks
- Conditional Rules and Unit Parsing
- Geometry Post-Processing Engine
- Engine Injection API
- Excel Template Model
- Import Parsing and Review UI
- Manifest-Driven Family Model
- Scope Findings and Open Questions
- Component Introspection Dump
- Operational Risks and Messages
- CSV/XLSX Importer
- Extension Architecture Split
- Drawer Height Budget Rules
- Template Derived From Manifest
- Session Records and Batch Queue
- Base Components From Files
- Royal Brand Identity
- Toolbar Icon Visual Language
- Legacy CSV Console Script
- RBZ Packaging Build
- Extension Registrar

## God Nodes (most connected - your core abstractions)
1. `RoyalKitchen::CatalogCreator::Xlsx` - 27 edges
2. `RoyalKitchen::CatalogCreator` - 20 edges
3. `validarFila()` - 15 edges
4. `el()` - 14 edges
5. `renderEditor()` - 14 edges
6. `init()` - 14 edges
7. `RoyalKitchen::CatalogCreator::Engine` - 13 edges
8. `renderSidebar()` - 13 edges
9. `presupuestoCajones()` - 12 edges
10. `RoyalKitchen::CatalogCreator::Plantilla` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Presupuesto de alto de cajones (implementación en el plugin)` --semantically_similar_to--> `Presupuesto de alto de cajones`  [INFERRED] [semantically similar]
  plugin/README.md → MANUAL_TECNICO.md
- `Limpieza de piezas ocultas (Engine.eliminar_ocultos)` --semantically_similar_to--> `Eliminar piezas ocultas al generar`  [INFERRED] [semantically similar]
  plugin/README.md → MANUAL_TECNICO.md
- `El diálogo corre sobre el CEF de SketchUp` --rationale_for--> `Barra lateral del diálogo (lista de módulos y acciones)`  [INFERRED]
  CLAUDE.md → plugin/royal_catalog_creator/html/dialog.html
- `manifest/_comunes.json con campos compartidos por $ref` --conceptually_related_to--> `Manifiesto por familia — fuente única de la UI`  [AMBIGUOUS]
  SCOPE.md → MANUAL_TECNICO.md
- `Royal Catalog Creator (extensión SketchUp)` --references--> `Vía visual — captura módulo por módulo`  [EXTRACTED]
  CLAUDE.md → MANUAL_USUARIO.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Cadena Ruby de generación y captura** — manual_tecnico_main_rb, manual_tecnico_engine_rb, manual_tecnico_plantilla_rb, manual_tecnico_xlsx_rb, manual_tecnico_importer_rb [EXTRACTED 1.00]
- **Espejos de la regla de presupuesto de cajones** — manual_tecnico_presupuesto_cajones, plugin_readme_presupuesto_cajones, manual_tecnico_espejo_reglas_cajones, manual_usuario_minimo_alto_cajon, manual_tecnico_medida_cuerpo_vs_total [INFERRED 0.85]
- **Flujo de importación masiva de punta a punta** — manual_tecnico_plantilla_rb, manual_tecnico_importer_rb, manual_tecnico_validacion_previa_importacion, manual_tecnico_prefijos_aplicabilidad, plugin_royal_catalog_creator_html_dialog_pane_import, manual_usuario_via_masiva [EXTRACTED 1.00]
- **Royal visual identity carried into the plugin dialog** — plugin_royal_catalog_creator_html_img_logo_royal_logo_asset, plugin_royal_catalog_creator_html_img_logo_shield_castle_mark, plugin_royal_catalog_creator_html_img_logo_royal_wordmark, plugin_royal_catalog_creator_html_img_logo_teal_palette, plugin_royal_catalog_creator_html_img_logo_dialog_branding [INFERRED 0.85]
- **Icon visual language: cabinet subject + create badge + flat teal palette form the extension's toolbar identity** — plugin_royal_catalog_creator_images_icon_cabinet_glyph, plugin_royal_catalog_creator_images_icon_plus_badge, plugin_royal_catalog_creator_images_icon_flat_teal_palette, plugin_royal_catalog_creator_images_icon_toolbar_identity [INFERRED 0.85]

## Communities (24 total, 2 thin omitted)

### Community 0 - "Dialog UI Runtime (app.js)"
Cohesion: 0.09
Nodes (64): activeRegistro(), actualizarBotonLote(), armarImportacion(), autoNombre(), buscarOpcion(), campoPorId(), cerrarConfirm(), clonarActivo() (+56 more)

### Community 1 - "XLSX Reader/Writer Without Gems"
Cohesion: 0.12
Nodes (3): RoyalKitchen, RoyalKitchen::CatalogCreator, RoyalKitchen::CatalogCreator::Xlsx

### Community 3 - "Conditional Rules and Unit Parsing"
Cohesion: 0.23
Nodes (20): aplicarAltosAutomaticos(), attrMm(), attrNumber(), attrRaw(), cajonesEfectivos(), cajonesUniformes(), condicionCumple(), effectiveValue() (+12 more)

### Community 4 - "Geometry Post-Processing Engine"
Cohesion: 0.15
Nodes (17): Instrucción de consola Ruby para correr el script legado, Eliminar piezas ocultas al generar, engine.rb — motor de inyección y post-procesos geométricos, Notación «prefijo>atributo» y conversión de unidades a pulgadas, Roadmap y siguientes pasos, script.rb — script legado de generación por CSV, Sondas de diagnóstico Issues/diag_*.rb, Fusión de mitades de entrepaño del Esquinero (Solid Tools) (+9 more)

### Community 5 - "Engine Injection API"
Cohesion: 0.25
Nodes (3): RoyalKitchen, RoyalKitchen::CatalogCreator, RoyalKitchen::CatalogCreator::Engine

### Community 6 - "Excel Template Model"
Cohesion: 0.23
Nodes (3): RoyalKitchen, RoyalKitchen::CatalogCreator, RoyalKitchen::CatalogCreator::Plantilla

### Community 7 - "Import Parsing and Review UI"
Cohesion: 0.20
Nodes (10): El diálogo corre sobre el CEF de SketchUp, importer.rb — parseo estructural de CSV/XLSX, xlsx.rb — lector/escritor mínimo de .xlsx sin gems, Tope de 500 filas por importación, La tabla de revisión usa controles propios, Escritura de .xlsx sin gems (zip sin comprimir, cadenas inline), Modal de confirmación genérico (#modal-confirm), Panel de revisión de importación (#pane-import) (+2 more)

### Community 8 - "Manifest-Driven Family Model"
Cohesion: 0.24
Nodes (10): app.js — render, reglas condicionales, validación y lote, Familias: Gabinete, Alacena, Esquinero, Manifiesto por familia — fuente única de la UI, Motor agnóstico a la familia, Guía de captura — referencia de campos por familia, Editor de caja (box_model) para los márgenes del frente, Ruby parsea, JavaScript valida (importación), Panel editor del módulo (#pane-editor) (+2 more)

### Community 9 - "Scope Findings and Open Questions"
Cohesion: 0.25
Nodes (8): introspeccion.rb — volcado de atributos y fórmulas, Lote estrictamente secuencial, Alto mínimo de frente de cajón = 100 mm, Notas de la definición pendientes con el mantenedor, Auto-tiling: el mapa de cocina es la escena nativa de SketchUp, Hallazgo de introspección: componentes melaminapro sin curación nativa, Preguntas abiertas del alcance, Salida doble: archivo en carpeta + inserción en la escena

### Community 10 - "Component Introspection Dump"
Cohesion: 0.52
Nodes (6): etiqueta_entidad(), in_meta_key?(), introspeccionar(), leer_meta(), variables_reales(), volcar_entidad()

### Community 11 - "Operational Risks and Messages"
Cohesion: 0.29
Nodes (7): Carpeta del proyecto (contiene «Main Components»), Regla de cajones implementada dos veces (app.js y main.rb), Riesgos operativos y mitigación, La salida se sobrescribe sin versionar, Catálogo de mensajes y solución de problemas, Detección de CSV en Windows-1252, Estado de la carpeta del proyecto en el pie de la barra lateral

### Community 12 - "CSV/XLSX Importer"
Cohesion: 0.38
Nodes (3): RoyalKitchen, RoyalKitchen::CatalogCreator, RoyalKitchen::CatalogCreator::Importer

### Community 13 - "Extension Architecture Split"
Cohesion: 0.50
Nodes (5): Royal Catalog Creator (extensión SketchUp), Separación estricta Ruby (modelo/disco) vs JavaScript (semántica), main.rb — capa de aplicación, menú, diálogo y callbacks, Puente de mensajes JS↔Ruby (6 callbacks / 5 receptores), KitchenCreator — repositorio

### Community 14 - "Drawer Height Budget Rules"
Cohesion: 0.40
Nodes (5): El formulario captura la medida del cuerpo, no la total (bloque «suma»), Presupuesto de alto de cajones, Validación previa de importación sin efectos secundarios, Importar agrega módulos a la sesión, no la reemplaza, Presupuesto de alto de cajones (implementación en el plugin)

### Community 15 - "Template Derived From Manifest"
Cohesion: 0.50
Nodes (5): plantilla.rb — modelo de columnas derivado de los manifiestos, Prefijos de aplicabilidad de columna [GAB]·[ALA]·[ESQ], Reglas condicionales por campo (habilitado_si / visible_si), Vía masiva — plantilla de Excel, importación y lote, Plantilla generada desde el manifiesto (encaja por construcción)

### Community 16 - "Session Records and Batch Queue"
Cohesion: 0.40
Nodes (5): Clonar módulo para producir variaciones, Vía visual — captura módulo por módulo, «Generar todos» — cola secuencial con cancelación por unidad, registro_id en el payload y en todas las respuestas de generar, Modelo de sesión: lista de registros y aceleradores

### Community 17 - "Base Components From Files"
Cohesion: 0.40
Nodes (5): Carpeta «Main Components» con los tres modelos base, La plantilla se descarga sin selector de ruta, Barra lateral del diálogo (lista de módulos y acciones), Componente base siempre desde archivo, nunca desde la escena, Plan de trabajo inicial del proyecto

### Community 18 - "Royal Brand Identity"
Cohesion: 0.60
Nodes (5): Branding of the SketchUp Dialog UI, Royal Sophisticated Concepts Logo (dialog asset), ROYAL / Sophisticated Concepts Wordmark, Teal Shield-and-Castle Brand Mark, Teal Corporate Color Palette (#4FB3A3 family)

### Community 19 - "Toolbar Icon Visual Language"
Cohesion: 0.70
Nodes (5): Royal Catalog Creator Toolbar Icon, Cabinet Glyph (front elevation with two drawer pulls), Flat Teal Two-Tone Palette, Plus Badge (create/generate affordance), Toolbar Icon as Extension Entry Point

### Community 20 - "Legacy CSV Console Script"
Cohesion: 0.70
Nodes (4): buscar_componentes_hijos(), gm_detect_sep(), gm_generar(), gm_interpret()

### Community 21 - "RBZ Packaging Build"
Cohesion: 0.67
Nodes (4): build.ps1 — empaquetado del .rbz, Regla de reempaquetado del .rbz al cerrar issue, Rutas del zip con «/» (System.IO.Compression), Empaquetar el .rbz (estructura y separador de rutas)

## Ambiguous Edges - Review These
- `Manifiesto por familia — fuente única de la UI` → `manifest/_comunes.json con campos compartidos por $ref`  [AMBIGUOUS]
  MANUAL_TECNICO.md · relation: conceptually_related_to

## Knowledge Gaps
- **9 isolated node(s):** `RoyalKitchen::CatalogCreator`, `Roadmap y siguientes pasos`, `Tope de 500 filas por importación`, `KitchenCreator — repositorio`, `manifest/_comunes.json con campos compartidos por $ref` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Manifiesto por familia — fuente única de la UI` and `manifest/_comunes.json con campos compartidos por $ref`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `engine.rb — motor de inyección y post-procesos geométricos` connect `Geometry Post-Processing Engine` to `Extension Architecture Split`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `RoyalKitchen::CatalogCreator`, `Roadmap y siguientes pasos`, `Tope de 500 filas por importación` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dialog UI Runtime (app.js)` be split into smaller, more focused modules?**
  _Cohesion score 0.09277389277389278 - nodes in this community are weakly interconnected._
- **Should `XLSX Reader/Writer Without Gems` be split into smaller, more focused modules?**
  _Cohesion score 0.11724137931034483 - nodes in this community are weakly interconnected._