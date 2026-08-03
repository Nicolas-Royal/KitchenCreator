/* ===========================================================================
   demo-bridge.js
   Simula el backend de Ruby (SketchUp) para poder correr la interfaz REAL
   del plugin (dialog.html + css/style.css + js/app.js, sin modificar) dentro
   de un navegador normal, como parte de la presentación ejecutiva.

   app.js define: var SU = window.sketchup || {...stubs con solo console.warn...}
   Este archivo se carga ANTES que app.js (ver dialog.html) y define
   window.sketchup con datos reales del catálogo, para que el formulario,
   las familias y "Generar" / "Generar todos" funcionen de verdad en la demo.
   =========================================================================== */
(function () {
  'use strict';

  // Manifiestos reales del proyecto (plugin/royal_catalog_creator/manifest/*.json),
  // embebidos aquí tal cual para evitar fetch() sobre file:// (bloqueado por CORS
  // en varios navegadores al abrir el HTML directamente desde disco).
  var MANIFESTS = {
    gabinete: {
      "familia": "gabinete",
      "titulo": "Gabinete",
      "descripcion": "Módulo base de gabinete inferior.",
      "componente_base": "Main Components/GABINETE.skp",
      "salida_dir": "Output/Gabinetes",
      "nombre_patron": "GAB-{LenX}-{divisor>f01cantdiv}div",
      "reglas_divisores": {
        "prefijo": "divisor",
        "attr_cantidad": "divisor>f01cantdiv",
        "attr_modo": "divisor>g01margenf{i}",
        "nombres_por_modo": { "0mm": "Divisor" },
        "nombre_default": "Entrepaño"
      },
      "reglas_cajones": {
        "alto_min_mm": 100,
        "uniforme_si_n": true,
        "label_uniforme": "Alto de cada cajón (todos iguales)",
        "attr_alto_util": "LenZ",
        "attr_restar": ["a02zocalo", "f11margsupcaj", "f12marginfcaj"],
        "attr_separacion": "f02sepcajtirad",
        "attr_cantidad": "cajon>a21cantcajon",
        "attr_estilo_puerta": "EstiloPuerta",
        "estilos_con_cajones": { "6": "n", "7": 2, "8": 3, "9": 4 },
        "attrs_alto": ["b11altocaj1", "b12altocaj2", "b13altocaj3", "b14altocaj4"]
      },
      "grupos": [
        {
          "id": "dimensiones",
          "titulo": "Dimensiones",
          "campos": [
            { "id": "LenX", "attr": "LenX", "label": "Ancho", "tipo": "numero", "unidad": "mm", "default": "800", "requerido": true },
            { "id": "LenY", "attr": "LenY", "label": "Profundidad", "tipo": "numero", "unidad": "mm", "default": "600", "requerido": true, "nota": "Profundidad del cuerpo; si la puerta va por fuera se le suma su espesor.", "suma": [
              { "attr": "c02esppuerta", "si": [
                { "attr": "EstiloPuerta", "excepto": ["0"] },
                { "attr": "puerta>f01posextintpu", "valor": "1" }
              ] }
            ] },
            { "id": "LenZ", "attr": "LenZ", "label": "Alto", "tipo": "numero", "unidad": "mm", "default": "600", "requerido": true, "nota": "Alto del cuerpo; el zócalo se suma aparte.", "suma": [
              { "attr": "a02zocalo" }
            ] },
            { "id": "a02zocalo", "attr": "a02zocalo", "label": "Alto zócalo", "tipo": "numero", "unidad": "mm", "default": "100" }
          ]
        },
        {
          "id": "espesores",
          "titulo": "Espesores",
          "campos": [
            { "id": "c01espestr", "attr": "c01espestr", "label": "Espesor estructura", "tipo": "numero", "unidad": "mm", "default": "18" },
            { "id": "c02esppuerta", "attr": "c02esppuerta", "label": "Espesor puerta", "tipo": "numero", "unidad": "mm", "default": "18" },
            { "id": "c03espfondo", "attr": "c03espfondo", "label": "Espesor fondo", "tipo": "numero", "unidad": "mm", "default": "12" },
            { "id": "c05espestrpe", "attr": "cajon>c05espestrpe", "label": "Espesor estructura cajones", "tipo": "numero", "unidad": "mm", "default": "" },
            { "id": "c06esppuertape", "attr": "cajon>c06esppuertape", "label": "Espesor puerta cajones", "tipo": "numero", "unidad": "mm", "default": "" },
            { "id": "c07espfondope", "attr": "cajon>c07espfondope", "label": "Espesor fondo cajones", "tipo": "numero", "unidad": "mm", "default": "" }
          ]
        },
        {
          "id": "estructura",
          "titulo": "Estructura e interior",
          "campos": [
            { "id": "e22tipotecho", "attr": "estructura>e22tipotecho", "label": "Tipo de techo", "tipo": "select", "default": "1", "opciones": [
              { "label": "Ninguno", "valor": "1" },
              { "label": "Amarre frontal", "valor": "2" },
              { "label": "Amarre posterior", "valor": "3" },
              { "label": "Amarre frontal + posterior", "valor": "4" },
              { "label": "Techo completo", "valor": "5" }
            ] },
            { "id": "e23ancamtecho", "attr": "estructura>e23ancamtecho", "label": "Ancho amarres", "tipo": "numero", "unidad": "mm", "default": "" },
            { "id": "c24entrepano", "attr": "c24entrepano", "label": "Entrepaño", "tipo": "select", "default": "1", "opciones": [
              { "label": "Sí", "valor": "0" },
              { "label": "No", "valor": "1" }
            ] },
            { "id": "cejaselect", "attr": "cejaselect", "label": "Ceja", "tipo": "select", "default": "1", "opciones": [
              { "label": "Con ceja", "valor": "1" },
              { "label": "Sin ceja", "valor": "2" }
            ] }
          ]
        },
        {
          "id": "frente",
          "titulo": "Frente y puertas",
          "box_model": {
            "titulo": "Márgenes del frente",
            "centro": "Frente",
            "arriba": "f11margsupcaj",
            "abajo": "f12marginfcaj",
            "izquierda": "f13margizqcaj",
            "derecha": "f14margdercaj"
          },
          "campos": [
            { "id": "EstiloPuerta", "attr": "EstiloPuerta", "label": "Diseño de puerta", "tipo": "select", "default": "1", "opciones": [
              { "label": "Ninguna", "valor": "0" },
              { "label": "Puerta lisa", "valor": "1" },
              { "label": "Puerta italiana", "valor": "2" },
              { "label": "Puerta vidrio", "valor": "3" },
              { "label": "Puerta vidrio-madera", "valor": "4" },
              { "label": "Puerta uñero", "valor": "5" },
              { "label": "N cajones", "valor": "6" },
              { "label": "2 cajones", "valor": "7" },
              { "label": "3 cajones", "valor": "8" },
              { "label": "4 cajones", "valor": "9" }
            ] },
            { "id": "e07cantpuerta", "attr": "puerta>e07cantpuerta", "label": "Cantidad de puertas", "tipo": "select", "default": "1", "opciones": [
              { "label": "Puerta simple - IZQ", "valor": "1" },
              { "label": "Puerta simple - DER", "valor": "2" },
              { "label": "Puerta doble", "valor": "3" },
              { "label": "Puerta - 3", "valor": "4" },
              { "label": "Puerta - 4", "valor": "5" },
              { "label": "Puerta - 5", "valor": "6" },
              { "label": "Puerta - 6", "valor": "7" },
              { "label": "Puerta - 7", "valor": "8" },
              { "label": "Puerta - 8", "valor": "9" },
              { "label": "Puerta - 9", "valor": "10" },
              { "label": "Puerta - 10", "valor": "11" }
            ] },
            { "id": "f01posextintpu", "attr": "puerta>f01posextintpu", "label": "Posición de puertas", "tipo": "select", "default": "1", "opciones": [
              { "label": "Puerta/Cajón exterior", "valor": "1" },
              { "label": "Puerta/Cajón interior", "valor": "2" }
            ] },
            { "id": "f04seppuertas", "attr": "f04seppuertas", "label": "Separación entre puertas", "tipo": "numero", "unidad": "mm", "default": "3" },
            { "id": "f11margsupcaj", "attr": "f11margsupcaj", "label": "Margen superior", "label_corto": "Superior", "tipo": "numero", "unidad": "mm", "default": "0" },
            { "id": "f12marginfcaj", "attr": "f12marginfcaj", "label": "Margen inferior", "label_corto": "Inferior", "tipo": "numero", "unidad": "mm", "default": "0" },
            { "id": "f13margizqcaj", "attr": "f13margizqcaj", "label": "Margen izquierdo", "label_corto": "Izquierdo", "tipo": "numero", "unidad": "mm", "default": "2" },
            { "id": "f14margdercaj", "attr": "f14margdercaj", "label": "Margen derecho", "label_corto": "Derecho", "tipo": "numero", "unidad": "mm", "default": "2" }
          ]
        },
        {
          "id": "tirador",
          "titulo": "Tirador",
          "campos": [
            { "id": "f21tipotirador", "attr": "puerta>f21tipotirador", "label": "Tipo de tirador", "tipo": "select", "default": "1", "opciones": [
              { "label": "Sin tirador", "valor": "1" },
              { "label": "Tirador secc. circular", "valor": "2" },
              { "label": "Tirador secc. cuadrada", "valor": "3" },
              { "label": "Tirador arco", "valor": "4" },
              { "label": "Tirador botón cuadrado", "valor": "5" },
              { "label": "Tirador botón circular", "valor": "6" },
              { "label": "Tirador CLE", "valor": "7" }
            ] },
            { "id": "f22postirador", "attr": "puerta>f22postirador", "label": "Posición de tirador", "tipo": "select", "default": "3", "opciones": [
              { "label": "Arriba - Izquierda", "valor": "1" },
              { "label": "Arriba - Centro", "valor": "2" },
              { "label": "Arriba - Derecha", "valor": "3" },
              { "label": "Centro - Izquierda", "valor": "4" },
              { "label": "Centro - Centro", "valor": "5" },
              { "label": "Centro - Derecha", "valor": "6" },
              { "label": "Abajo - Izquierda", "valor": "7" },
              { "label": "Abajo - Centro", "valor": "8" },
              { "label": "Abajo - Derecha", "valor": "9" }
            ] },
            { "id": "f23orienttirador", "attr": "puerta>f23orienttirador", "label": "Orientación de tirador", "tipo": "select", "default": "2", "opciones": [
              { "label": "Tirador horizontal", "valor": "1" },
              { "label": "Tirador vertical", "valor": "2" }
            ] }
          ]
        },
        {
          "id": "cajones",
          "titulo": "Cajones",
          "presupuesto": "cajones",
          "campos": [
            { "id": "b03tipocajon", "attr": "b03tipocajon", "label": "Estilo cajones", "tipo": "select", "default": "1", "opciones": [
              { "label": "Tandem", "valor": "1" },
              { "label": "Antaro", "valor": "2" }
            ] },
            { "id": "a21cantcajon", "attr": "cajon>a21cantcajon", "label": "Cantidad de cajones", "tipo": "derivado", "default": "1", "min": 1, "max": 6, "max_regla": "cajones", "controla": [],
              "habilitado_si": { "attr": "EstiloPuerta", "valor": "6", "mensaje": "Solo aplica con diseño de puerta «N cajones»." } },
            { "id": "b11altocaj1", "attr": "b11altocaj1", "label": "Alto cajón 1 (superior)", "tipo": "preset", "unidad": "mm", "default": "190mm", "permite_personalizado": true, "visible_si": { "min_cajones": 1 }, "presets": [
              { "label": "Automático (restante)", "valor": "" },
              { "label": "CH (190 mm)", "valor": "190mm" },
              { "label": "G (383 mm)", "valor": "383mm" }
            ] },
            { "id": "b12altocaj2", "attr": "b12altocaj2", "label": "Alto cajón 2", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "min_cajones": 2 }, "presets": [
              { "label": "Automático (restante)", "valor": "" },
              { "label": "CH (190 mm)", "valor": "190mm" },
              { "label": "G (383 mm)", "valor": "383mm" }
            ] },
            { "id": "b13altocaj3", "attr": "b13altocaj3", "label": "Alto cajón 3", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "min_cajones": 3 }, "presets": [
              { "label": "Automático (restante)", "valor": "" },
              { "label": "CH (190 mm)", "valor": "190mm" },
              { "label": "G (383 mm)", "valor": "383mm" }
            ] },
            { "id": "b14altocaj4", "attr": "b14altocaj4", "label": "Alto cajón 4 (inferior)", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "min_cajones": 4 }, "nota": "«Automático» reparte el alto restante con base en las alturas anteriores.", "presets": [
              { "label": "Automático (restante)", "valor": "" },
              { "label": "CH (190 mm)", "valor": "190mm" },
              { "label": "G (383 mm)", "valor": "383mm" }
            ] },
            { "id": "f02sepcajtirad", "attr": "f02sepcajtirad", "label": "Separación entre cajones", "tipo": "numero", "unidad": "mm", "default": "" },
            { "id": "n02corredpers", "attr": "cajon>n02corredpers", "label": "Corredera cajón", "tipo": "numero", "unidad": "cm", "default": "" }
          ]
        },
        {
          "id": "divisores",
          "titulo": "Divisores",
          "campos": [
            { "id": "f01cantdiv", "attr": "divisor>f01cantdiv", "label": "Cantidad de divisores", "tipo": "derivado", "default": "1", "min": 1, "max": 6, "controla": ["divisor>f03espacio", "divisor>g01margenf"] },
            { "id": "f02tipomedida", "attr": "divisor>f02tipomedida", "label": "Tipo de medida", "tipo": "select", "default": "1", "opciones": [
              { "label": "Separaciones iguales", "valor": "1" },
              { "label": "Personalizado", "valor": "2" }
            ] },
            { "id": "f03espacio1", "attr": "divisor>f03espacio1", "label": "Espacio 1 (inferior)", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 1 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "g01margenf1", "attr": "divisor>g01margenf1", "label": "Margen frontal 1", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "attr": "divisor>f01cantdiv", "min": 1 }, "presets": [
              { "label": "Entrepaño", "valor": "" },
              { "label": "Divisor", "valor": "0mm" }
            ] },
            { "id": "f03espacio2", "attr": "divisor>f03espacio2", "label": "Espacio 2", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 2 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "g01margenf2", "attr": "divisor>g01margenf2", "label": "Margen frontal 2", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "attr": "divisor>f01cantdiv", "min": 2 }, "presets": [
              { "label": "Entrepaño", "valor": "" },
              { "label": "Divisor", "valor": "0mm" }
            ] },
            { "id": "f03espacio3", "attr": "divisor>f03espacio3", "label": "Espacio 3", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 3 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "g01margenf3", "attr": "divisor>g01margenf3", "label": "Margen frontal 3", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "attr": "divisor>f01cantdiv", "min": 3 }, "presets": [
              { "label": "Entrepaño", "valor": "" },
              { "label": "Divisor", "valor": "0mm" }
            ] },
            { "id": "f03espacio4", "attr": "divisor>f03espacio4", "label": "Espacio 4", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 4 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "g01margenf4", "attr": "divisor>g01margenf4", "label": "Margen frontal 4", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "attr": "divisor>f01cantdiv", "min": 4 }, "presets": [
              { "label": "Entrepaño", "valor": "" },
              { "label": "Divisor", "valor": "0mm" }
            ] },
            { "id": "f03espacio5", "attr": "divisor>f03espacio5", "label": "Espacio 5", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 5 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "g01margenf5", "attr": "divisor>g01margenf5", "label": "Margen frontal 5", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "attr": "divisor>f01cantdiv", "min": 5 }, "presets": [
              { "label": "Entrepaño", "valor": "" },
              { "label": "Divisor", "valor": "0mm" }
            ] },
            { "id": "f03espacio6", "attr": "divisor>f03espacio6", "label": "Espacio 6", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 6 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "g01margenf6", "attr": "divisor>g01margenf6", "label": "Margen frontal 6", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "attr": "divisor>f01cantdiv", "min": 6 }, "presets": [
              { "label": "Entrepaño", "valor": "" },
              { "label": "Divisor", "valor": "0mm" }
            ] },
            { "id": "f03espacio7", "attr": "divisor>f03espacio7", "label": "Espacio 7", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 7 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } }
          ]
        }
      ]
    },

    alacena: {
      "familia": "alacena",
      "titulo": "Alacena",
      "descripcion": "Módulo base de alacena (gabinete superior).",
      "componente_base": "Main Components/ALACENA.skp",
      "salida_dir": "Output/Alacenas",
      "nombre_patron": "ALA-{LenX}-{divisor>f01cantdiv}div",
      "reglas_divisores": {
        "prefijo": "divisor",
        "attr_cantidad": "divisor>f01cantdiv",
        "attr_modo": "divisor>g01margenf{i}",
        "nombres_por_modo": { "0mm": "Divisor" },
        "nombre_default": "Entrepaño"
      },
      "grupos": [
        {
          "id": "dimensiones",
          "titulo": "Dimensiones",
          "campos": [
            { "id": "LenX", "attr": "LenX", "label": "Ancho", "tipo": "numero", "unidad": "mm", "default": "", "requerido": true },
            { "id": "LenY", "attr": "LenY", "label": "Profundidad", "tipo": "numero", "unidad": "mm", "default": "", "requerido": true, "nota": "Profundidad del cuerpo; si la puerta va por fuera se le suma su espesor.", "suma": [
              { "attr": "c02esppuerta", "si": [
                { "attr": "c25tipopuerta", "excepto": ["0"] },
                { "attr": "puerta>f01posextintpu", "valor": "1" }
              ] }
            ] },
            { "id": "LenZ", "attr": "LenZ", "label": "Alto", "tipo": "numero", "unidad": "mm", "default": "", "requerido": true }
          ]
        },
        {
          "id": "espesores",
          "titulo": "Espesores",
          "campos": [
            { "id": "c01espestr", "attr": "c01espestr", "label": "Espesor estructura", "tipo": "numero", "unidad": "mm", "default": "18" },
            { "id": "c02esppuerta", "attr": "c02esppuerta", "label": "Espesor puerta", "tipo": "numero", "unidad": "mm", "default": "18" },
            { "id": "c03espfondo", "attr": "c03espfondo", "label": "Espesor fondo", "tipo": "numero", "unidad": "mm", "default": "12" }
          ]
        },
        {
          "id": "estructura",
          "titulo": "Estructura e interior",
          "campos": [
            { "id": "e23ancamtecho", "attr": "estructura>e23ancamtecho", "label": "Ancho amarres", "tipo": "numero", "unidad": "mm", "default": "" },
            { "id": "c24entrepano", "attr": "c24entrepano", "label": "Entrepaño", "tipo": "select", "default": "1", "opciones": [
              { "label": "Sí", "valor": "0" },
              { "label": "No", "valor": "1" }
            ] }
          ]
        },
        {
          "id": "frente",
          "titulo": "Frente y puertas",
          "box_model": {
            "titulo": "Márgenes del frente",
            "centro": "Frente",
            "arriba": "f11margsupcaj",
            "abajo": "f12marginfcaj",
            "izquierda": "f13margizqcaj",
            "derecha": "f14margdercaj"
          },
          "campos": [
            { "id": "c25tipopuerta", "attr": "c25tipopuerta", "label": "Diseño de puerta", "tipo": "select", "default": "1", "opciones": [
              { "label": "Ninguna", "valor": "0" },
              { "label": "Puerta lisa", "valor": "1" },
              { "label": "Puerta italiana", "valor": "2" },
              { "label": "Puerta vidrio", "valor": "3" },
              { "label": "Puerta vidrio-madera", "valor": "4" },
              { "label": "Puerta uñero", "valor": "5" },
              { "label": "Avento S lisa", "valor": "6" },
              { "label": "Avento S italiana", "valor": "7" },
              { "label": "Avento S vidrio", "valor": "8" },
              { "label": "Avento S vidrio-madera", "valor": "9" },
              { "label": "Avento D lisa", "valor": "10" },
              { "label": "Avento D italiana", "valor": "11" },
              { "label": "Avento D vidrio", "valor": "12" },
              { "label": "Avento D vidrio-madera", "valor": "13" }
            ] },
            { "id": "e07cantpuerta", "attr": "puerta>e07cantpuerta", "label": "Cantidad de puertas", "tipo": "select", "default": "1", "opciones": [
              { "label": "Puerta - 1", "valor": "1" },
              { "label": "Puerta - 2", "valor": "2" },
              { "label": "Puerta - 3", "valor": "3" },
              { "label": "Puerta - 4", "valor": "4" },
              { "label": "Puerta - 5", "valor": "5" },
              { "label": "Puerta - 6", "valor": "6" },
              { "label": "Puerta - 7", "valor": "7" },
              { "label": "Puerta - 8", "valor": "8" },
              { "label": "Puerta - 9", "valor": "9" },
              { "label": "Puerta - 10", "valor": "10" }
            ] },
            { "id": "e08cantpuvert", "attr": "puerta>e08cantpuvert", "label": "Tipo de puerta abatible", "tipo": "select", "default": "1", "opciones": [
              { "label": "Puerta simple", "valor": "1" },
              { "label": "Puerta doble - individual", "valor": "2" },
              { "label": "Puerta doble - unidas", "valor": "3" }
            ] },
            { "id": "f01posextintpu", "attr": "puerta>f01posextintpu", "label": "Posición de puertas", "tipo": "select", "default": "1", "opciones": [
              { "label": "Puerta/Cajón exterior", "valor": "1" },
              { "label": "Puerta/Cajón interior", "valor": "2" }
            ] },
            { "id": "f04seppuertas", "attr": "f04seppuertas", "label": "Separación entre puertas", "tipo": "numero", "unidad": "mm", "default": "3" },
            { "id": "f11margsupcaj", "attr": "f11margsupcaj", "label": "Margen superior", "label_corto": "Superior", "tipo": "numero", "unidad": "mm", "default": "0" },
            { "id": "f12marginfcaj", "attr": "f12marginfcaj", "label": "Margen inferior", "label_corto": "Inferior", "tipo": "numero", "unidad": "mm", "default": "0" },
            { "id": "f13margizqcaj", "attr": "f13margizqcaj", "label": "Margen izquierdo", "label_corto": "Izquierdo", "tipo": "numero", "unidad": "mm", "default": "2" },
            { "id": "f14margdercaj", "attr": "f14margdercaj", "label": "Margen derecho", "label_corto": "Derecho", "tipo": "numero", "unidad": "mm", "default": "2" }
          ]
        },
        {
          "id": "tirador",
          "titulo": "Tirador",
          "campos": [
            { "id": "f21tipotirador", "attr": "puerta>f21tipotirador", "label": "Tipo de tirador", "tipo": "select", "default": "1", "opciones": [
              { "label": "Sin tirador", "valor": "1" },
              { "label": "Tirador secc. circular", "valor": "2" },
              { "label": "Tirador secc. cuadrada", "valor": "3" },
              { "label": "Tirador arco", "valor": "4" },
              { "label": "Tirador botón cuadrado", "valor": "5" },
              { "label": "Tirador botón circular", "valor": "6" },
              { "label": "Tirador CLE", "valor": "7" }
            ] },
            { "id": "f22postirador", "attr": "puerta>f22postirador", "label": "Posición de tirador", "tipo": "select", "default": "3", "opciones": [
              { "label": "Arriba - Izquierda", "valor": "1" },
              { "label": "Arriba - Centro", "valor": "2" },
              { "label": "Arriba - Derecha", "valor": "3" },
              { "label": "Centro - Izquierda", "valor": "4" },
              { "label": "Centro - Centro", "valor": "5" },
              { "label": "Centro - Derecha", "valor": "6" },
              { "label": "Abajo - Izquierda", "valor": "7" },
              { "label": "Abajo - Centro", "valor": "8" },
              { "label": "Abajo - Derecha", "valor": "9" }
            ] },
            { "id": "f23orienttirador", "attr": "puerta>f23orienttirador", "label": "Orientación de tirador", "tipo": "select", "default": "2", "opciones": [
              { "label": "Tirador horizontal", "valor": "1" },
              { "label": "Tirador vertical", "valor": "2" }
            ] }
          ]
        },
        {
          "id": "divisores",
          "titulo": "Divisores",
          "campos": [
            { "id": "f01cantdiv", "attr": "divisor>f01cantdiv", "label": "Cantidad de divisores", "tipo": "derivado", "default": "1", "min": 1, "max": 6, "controla": ["divisor>f03espacio", "divisor>g01margenf"] },
            { "id": "f02tipomedida", "attr": "divisor>f02tipomedida", "label": "Tipo de medida", "tipo": "select", "default": "1", "opciones": [
              { "label": "Separaciones iguales", "valor": "1" },
              { "label": "Personalizado", "valor": "2" }
            ] },
            { "id": "f03espacio1", "attr": "divisor>f03espacio1", "label": "Espacio 1 (inferior)", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 1 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "g01margenf1", "attr": "divisor>g01margenf1", "label": "Margen frontal 1", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "attr": "divisor>f01cantdiv", "min": 1 }, "presets": [
              { "label": "Entrepaño", "valor": "" },
              { "label": "Divisor", "valor": "0mm" }
            ] },
            { "id": "f03espacio2", "attr": "divisor>f03espacio2", "label": "Espacio 2", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 2 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "g01margenf2", "attr": "divisor>g01margenf2", "label": "Margen frontal 2", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "attr": "divisor>f01cantdiv", "min": 2 }, "presets": [
              { "label": "Entrepaño", "valor": "" },
              { "label": "Divisor", "valor": "0mm" }
            ] },
            { "id": "f03espacio3", "attr": "divisor>f03espacio3", "label": "Espacio 3", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 3 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "g01margenf3", "attr": "divisor>g01margenf3", "label": "Margen frontal 3", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "attr": "divisor>f01cantdiv", "min": 3 }, "presets": [
              { "label": "Entrepaño", "valor": "" },
              { "label": "Divisor", "valor": "0mm" }
            ] },
            { "id": "f03espacio4", "attr": "divisor>f03espacio4", "label": "Espacio 4", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 4 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "g01margenf4", "attr": "divisor>g01margenf4", "label": "Margen frontal 4", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "attr": "divisor>f01cantdiv", "min": 4 }, "presets": [
              { "label": "Entrepaño", "valor": "" },
              { "label": "Divisor", "valor": "0mm" }
            ] },
            { "id": "f03espacio5", "attr": "divisor>f03espacio5", "label": "Espacio 5", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 5 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "g01margenf5", "attr": "divisor>g01margenf5", "label": "Margen frontal 5", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "attr": "divisor>f01cantdiv", "min": 5 }, "presets": [
              { "label": "Entrepaño", "valor": "" },
              { "label": "Divisor", "valor": "0mm" }
            ] },
            { "id": "f03espacio6", "attr": "divisor>f03espacio6", "label": "Espacio 6", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 6 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "g01margenf6", "attr": "divisor>g01margenf6", "label": "Margen frontal 6", "tipo": "preset", "unidad": "mm", "default": "", "permite_personalizado": true, "visible_si": { "attr": "divisor>f01cantdiv", "min": 6 }, "presets": [
              { "label": "Entrepaño", "valor": "" },
              { "label": "Divisor", "valor": "0mm" }
            ] },
            { "id": "f03espacio7", "attr": "divisor>f03espacio7", "label": "Espacio 7", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 7 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } }
          ]
        }
      ]
    },

    esquinero: {
      "familia": "esquinero",
      "titulo": "Esquinero",
      "descripcion": "Módulo base de esquinero.",
      "componente_base": "Main Components/ESQUINERO.skp",
      "salida_dir": "Output/Esquineros",
      "nombre_patron": "ESQ-{LenX}-{divisor>f01cantdiv}div",
      "reglas_union": {
        "grupo": "entrepaño",
        "piezas": ["p01-esq", "p02-esq"],
        "nombre": "Entrepaño"
      },
      "grupos": [
        {
          "id": "dimensiones",
          "titulo": "Dimensiones",
          "campos": [
            { "id": "LenX", "attr": "LenX", "label": "Ancho izquierdo", "tipo": "numero", "unidad": "mm", "default": "", "requerido": true },
            { "id": "LenY", "attr": "LenY", "label": "Ancho derecho", "tipo": "numero", "unidad": "mm", "default": "", "requerido": true },
            { "id": "LenZ", "attr": "LenZ", "label": "Alto", "tipo": "numero", "unidad": "mm", "default": "", "requerido": true, "nota": "Alto del cuerpo; el zócalo se suma aparte.", "suma": [
              { "attr": "a02zocalo" }
            ] },
            { "id": "a0101profizq", "attr": "a0101profizq", "label": "Profundidad izquierda", "tipo": "numero", "unidad": "mm", "default": "", "requerido": true, "nota": "Profundidad del cuerpo; si la puerta va por fuera se le suma su espesor.", "suma": [
              { "attr": "c02esppuerta", "si": [
                { "attr": "EstiloPuerta", "excepto": ["0"] },
                { "attr": "puerta>f01posextintpu", "valor": "1" }
              ] }
            ] },
            { "id": "a0102profder", "attr": "a0102profder", "label": "Profundidad derecha", "tipo": "numero", "unidad": "mm", "default": "", "requerido": true, "nota": "Profundidad del cuerpo; si la puerta va por fuera se le suma su espesor.", "suma": [
              { "attr": "c02esppuerta", "si": [
                { "attr": "EstiloPuerta", "excepto": ["0"] },
                { "attr": "puerta>f01posextintpu", "valor": "1" }
              ] }
            ] },
            { "id": "a02zocalo", "attr": "a02zocalo", "label": "Alto zócalo", "tipo": "numero", "unidad": "mm", "default": "100" }
          ]
        },
        {
          "id": "espesores",
          "titulo": "Espesores",
          "campos": [
            { "id": "c01espestr", "attr": "c01espestr", "label": "Espesor estructura", "tipo": "numero", "unidad": "mm", "default": "18" },
            { "id": "c02esppuerta", "attr": "c02esppuerta", "label": "Espesor puerta", "tipo": "numero", "unidad": "mm", "default": "18" },
            { "id": "c03espfondo", "attr": "c03espfondo", "label": "Espesor fondo", "tipo": "numero", "unidad": "mm", "default": "12" }
          ]
        },
        {
          "id": "estructura",
          "titulo": "Estructura e interior",
          "campos": [
            { "id": "e23ancamtecho", "attr": "estructura>e23ancamtecho", "label": "Ancho amarres", "tipo": "numero", "unidad": "mm", "default": "" },
            { "id": "c24entrepano", "attr": "c24entrepano", "label": "Entrepaño", "tipo": "select", "default": "1", "opciones": [
              { "label": "Sí", "valor": "0" },
              { "label": "No", "valor": "1" }
            ] }
          ]
        },
        {
          "id": "frente",
          "titulo": "Frente y puertas",
          "box_model": {
            "titulo": "Márgenes del frente",
            "centro": "Frente",
            "arriba": "f11margsupcaj",
            "abajo": "f12marginfcaj",
            "izquierda": "f13margizqcaj",
            "derecha": "f14margdercaj"
          },
          "campos": [
            { "id": "EstiloPuerta", "attr": "EstiloPuerta", "label": "Diseño de puerta", "tipo": "select", "default": "1", "opciones": [
              { "label": "Ninguna", "valor": "0" },
              { "label": "Puerta lisa", "valor": "1" },
              { "label": "Puerta italiana", "valor": "2" },
              { "label": "Puerta vidrio", "valor": "3" },
              { "label": "Puerta vidrio-madera", "valor": "4" },
              { "label": "Puerta uñero", "valor": "5" }
            ] },
            { "id": "f01posextintpu", "attr": "puerta>f01posextintpu", "label": "Posición de puertas", "tipo": "select", "default": "1", "opciones": [
              { "label": "Puerta/Cajón exterior", "valor": "1" },
              { "label": "Puerta/Cajón interior", "valor": "2" }
            ] },
            { "id": "f04seppuertas", "attr": "f04seppuertas", "label": "Separación entre puertas", "tipo": "numero", "unidad": "mm", "default": "3" },
            { "id": "f11margsupcaj", "attr": "f11margsupcaj", "label": "Margen superior", "label_corto": "Superior", "tipo": "numero", "unidad": "mm", "default": "0" },
            { "id": "f12marginfcaj", "attr": "f12marginfcaj", "label": "Margen inferior", "label_corto": "Inferior", "tipo": "numero", "unidad": "mm", "default": "0" },
            { "id": "f13margizqcaj", "attr": "f13margizqcaj", "label": "Margen izquierdo", "label_corto": "Izquierdo", "tipo": "numero", "unidad": "mm", "default": "2" },
            { "id": "f14margdercaj", "attr": "f14margdercaj", "label": "Margen derecho", "label_corto": "Derecho", "tipo": "numero", "unidad": "mm", "default": "2" }
          ]
        },
        {
          "id": "tirador",
          "titulo": "Tirador",
          "campos": [
            { "id": "f21tipotirador", "attr": "puerta>f21tipotirador", "label": "Tipo de tirador", "tipo": "select", "default": "1", "opciones": [
              { "label": "Sin tirador", "valor": "1" },
              { "label": "Tirador secc. circular", "valor": "2" },
              { "label": "Tirador secc. cuadrada", "valor": "3" },
              { "label": "Tirador arco", "valor": "4" },
              { "label": "Tirador botón cuadrado", "valor": "5" },
              { "label": "Tirador botón circular", "valor": "6" },
              { "label": "Tirador CLE", "valor": "7" }
            ] },
            { "id": "f22postirador", "attr": "puerta>f22postirador", "label": "Posición de tirador", "tipo": "select", "default": "3", "opciones": [
              { "label": "Arriba - Izquierda", "valor": "1" },
              { "label": "Arriba - Centro", "valor": "2" },
              { "label": "Arriba - Derecha", "valor": "3" },
              { "label": "Centro - Izquierda", "valor": "4" },
              { "label": "Centro - Centro", "valor": "5" },
              { "label": "Centro - Derecha", "valor": "6" },
              { "label": "Abajo - Izquierda", "valor": "7" },
              { "label": "Abajo - Centro", "valor": "8" },
              { "label": "Abajo - Derecha", "valor": "9" }
            ] },
            { "id": "f23orienttirador", "attr": "puerta>f23orienttirador", "label": "Orientación de tirador", "tipo": "select", "default": "2", "opciones": [
              { "label": "Tirador horizontal", "valor": "1" },
              { "label": "Tirador vertical", "valor": "2" }
            ] }
          ]
        },
        {
          "id": "divisores",
          "titulo": "Divisores",
          "box_model": {
            "titulo": "Márgenes del divisor (vista de planta)",
            "centro": "Planta",
            "arriba": "divisor>e32_marg2",
            "abajo": "divisor>e31_marg1",
            "izquierda": "divisor>e33_marg3",
            "derecha": "divisor>e34_marg4"
          },
          "campos": [
            { "id": "f01cantdiv", "attr": "divisor>f01cantdiv", "label": "Cantidad de divisores", "tipo": "derivado", "default": "1", "min": 1, "max": 6, "controla": ["divisor>f03espacio"] },
            { "id": "f02tipomedida", "attr": "divisor>f02tipomedida", "label": "Tipo de medida", "tipo": "select", "default": "1", "opciones": [
              { "label": "Separaciones iguales", "valor": "1" },
              { "label": "Personalizado", "valor": "2" }
            ] },
            { "id": "e31_marg1", "attr": "divisor>e31_marg1", "label": "Margen frontal", "label_corto": "Frontal", "tipo": "numero", "unidad": "mm", "default": "" },
            { "id": "e32_marg2", "attr": "divisor>e32_marg2", "label": "Margen posterior", "label_corto": "Posterior", "tipo": "numero", "unidad": "mm", "default": "" },
            { "id": "e33_marg3", "attr": "divisor>e33_marg3", "label": "Margen izquierdo", "label_corto": "Izquierdo", "tipo": "numero", "unidad": "mm", "default": "" },
            { "id": "e34_marg4", "attr": "divisor>e34_marg4", "label": "Margen derecho", "label_corto": "Derecho", "tipo": "numero", "unidad": "mm", "default": "" },
            { "id": "f03espacio1", "attr": "divisor>f03espacio1", "label": "Espacio 1 (inferior)", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 1 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "f03espacio2", "attr": "divisor>f03espacio2", "label": "Espacio 2", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 2 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "f03espacio3", "attr": "divisor>f03espacio3", "label": "Espacio 3", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 3 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "f03espacio4", "attr": "divisor>f03espacio4", "label": "Espacio 4", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 4 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "f03espacio5", "attr": "divisor>f03espacio5", "label": "Espacio 5", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 5 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "f03espacio6", "attr": "divisor>f03espacio6", "label": "Espacio 6", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 6 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } },
            { "id": "f03espacio7", "attr": "divisor>f03espacio7", "label": "Espacio 7", "tipo": "numero", "unidad": "mm", "default": "", "visible_si": { "attr": "divisor>f01cantdiv", "min": 7 }, "habilitado_si": { "attr": "divisor>f02tipomedida", "valor": "2", "mensaje": "Solo aplica con tipo de medida «Personalizado»." } }
          ]
        }
      ]
    }
  };

  // Debounce: "Generar todos" llama a generar() una vez por módulo en cola.
  // Solo se quiere avanzar de diapositiva una vez, después del último.
  var advanceTimer = null;
  function scheduleAdvance() {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(function () {
      // El deck contenedor escucha este mensaje (ver index.html) y avanza
      // a la diapositiva de los 3 modelos generados.
      window.parent.postMessage({ source: 'royal-catalog-creator-demo', type: 'generar' }, '*');
    }, 800);
  }

  var seq = 1;

  window.sketchup = {
    sync: function () {
      window.CC.onSync({
        familias: [
          { id: 'gabinete', titulo: 'Gabinete', activo: true },
          { id: 'alacena', titulo: 'Alacena', activo: true },
          { id: 'esquinero', titulo: 'Esquinero', activo: true }
        ],
        project_root: 'Demo — Royal Kitchens',
        root_valido: true
      });
    },

    get_manifest: function (familia) {
      var manifest = MANIFESTS[familia];
      if (manifest) {
        window.CC.onManifest({ ok: true, manifest: manifest });
      } else {
        window.CC.onManifest({ ok: false, error: 'Familia no disponible en la demo: ' + familia });
      }
    },

    generar: function (payloadJson) {
      var payload = {};
      try { payload = JSON.parse(payloadJson); } catch (e) {}
      var registroId = payload.registro_id || ('demo' + (seq++));
      var nombre = payload.nombre_salida || 'Módulo';
      // Pequeño delay para que se sienta como una generación real, no instantánea.
      setTimeout(function () {
        window.CC.onGenerar({ ok: true, ruta: nombre + '.skp (demo)', registro_id: registroId });
        scheduleAdvance();
      }, 250);
    },

    elegir_carpeta: function () {},

    exportar_plantilla: function () {
      // Igual que "Generar": Ruby tarda un poco en escribir el .xlsx y avisa
      // con onPlantilla (mismo toast "Plantilla generada" que usa el plugin real).
      setTimeout(function () {
        window.CC.onPlantilla({ ok: true, ruta: 'Plantilla_Catalogo_RoyalKitchens.xlsx' });
      }, 500);
    },

    importar_archivo: function () {
      // Simula un archivo ya lleno por una diseñadora: 5 módulos de las 3
      // familias, con los campos requeridos de cada una para que la tabla de
      // revisión los muestre todos en verde ("N listas") y "Importar N" los
      // cargue todos de un jalón, igual que con un Excel real.
      var modelo = {
        familias: [
          { id: 'gabinete', titulo: 'Gabinete' },
          { id: 'alacena', titulo: 'Alacena' },
          { id: 'esquinero', titulo: 'Esquinero' }
        ],
        columnas: [
          { header: 'familia', clase: 'familia' },
          { header: 'nombre_salida', clase: 'nombre' },
          { header: 'LenX', attr: 'LenX', clase: 'campo',
            ids: { gabinete: 'LenX', alacena: 'LenX', esquinero: 'LenX' },
            familias: ['gabinete', 'alacena', 'esquinero'] },
          { header: 'LenY', attr: 'LenY', clase: 'campo',
            ids: { gabinete: 'LenY', alacena: 'LenY', esquinero: 'LenY' },
            familias: ['gabinete', 'alacena', 'esquinero'] },
          { header: 'LenZ', attr: 'LenZ', clase: 'campo',
            ids: { gabinete: 'LenZ', alacena: 'LenZ', esquinero: 'LenZ' },
            familias: ['gabinete', 'alacena', 'esquinero'] },
          { header: 'a0101profizq', attr: 'a0101profizq', clase: 'campo',
            ids: { esquinero: 'a0101profizq' }, familias: ['esquinero'] },
          { header: 'a0102profder', attr: 'a0102profder', clase: 'campo',
            ids: { esquinero: 'a0102profder' }, familias: ['esquinero'] }
        ]
      };

      var headers = ['familia', 'nombre_salida', 'LenX', 'LenY', 'LenZ', 'a0101profizq', 'a0102profder'];
      var filas = [
        ['Gabinete', 'GAB-800-2CAJ', '800', '580', '720', '', ''],
        ['Gabinete', 'GAB-600-1DIV', '600', '580', '720', '', ''],
        ['Alacena', 'ALA-700-VIDRIO', '700', '320', '650', '', ''],
        ['Esquinero', 'ESQ-900-ITAL', '450', '450', '720', '550', '550'],
        ['Esquinero', 'ESQ-1000-ITAL', '500', '500', '720', '560', '560']
      ];

      setTimeout(function () {
        window.CC.onImportar({
          ok: true,
          ruta: 'Plantilla_Catalogo_RoyalKitchens (llena).xlsx',
          modelo: modelo,
          headers: headers,
          filas: filas,
          manifiestos: MANIFESTS,
          truncado: false
        });
      }, 600);
    }
  };
})();
