/* ===========================================================================
   Royal Catalog Creator — lógica de la interfaz
   ---------------------------------------------------------------------------
   Puente con SketchUp:
     JS  -> Ruby : window.sketchup.<callback>(args)
     Ruby -> JS  : window.CC.<fn>(obj)   (vía dialog.execute_script)
   =========================================================================== */
(function () {
  'use strict';

  // ---- Puente seguro (permite abrir el HTML fuera de SketchUp sin romper) ---
  var SU = window.sketchup || {
    sync: function () { console.warn('[CC] sketchup.sync no disponible (fuera de SketchUp).'); },
    get_manifest: function () { console.warn('[CC] sketchup.get_manifest no disponible.'); },
    generar: function () { console.warn('[CC] sketchup.generar no disponible.'); },
    elegir_carpeta: function () { console.warn('[CC] sketchup.elegir_carpeta no disponible.'); },
    exportar_plantilla: function () { console.warn('[CC] sketchup.exportar_plantilla no disponible.'); },
    importar_archivo: function () { console.warn('[CC] sketchup.importar_archivo no disponible.'); }
  };

  var ICONOS  = { gabinete: '🗄️', alacena: '📦', esquinero: '📐' };
  var ESTADOS = { generado: '✓ generado', error: '✕ error' };

  // ---- Estado --------------------------------------------------------------
  var state = {
    familias: [],
    projectRoot: '',
    rootValido: false,
    manifests: {},        // familia -> manifest
    registros: [],        // { id, familia, titulo, nombre_salida, valores, estado, error }
    activeId: null,
    seq: 1,
    pending: null,        // { registroId } esperando manifest
    lote: null,           // cola de «Generar todos»; null = no hay lote corriendo
    importar: null        // tabla de revisión en curso; null = no hay importación
  };

  // ---- Utilidades ----------------------------------------------------------
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function findManifest(familia) { return state.manifests[familia]; }
  function activeRegistro() {
    return state.registros.filter(function (r) { return r.id === state.activeId; })[0] || null;
  }
  function findField(manifest, predicate) {
    for (var g = 0; g < manifest.grupos.length; g++) {
      var campos = manifest.grupos[g].campos;
      for (var c = 0; c < campos.length; c++) {
        if (predicate(campos[c], manifest.grupos[g])) return campos[c];
      }
    }
    return null;
  }
  function fieldByAttr(manifest, attr) {
    return findField(manifest, function (f) { return f.attr === attr; });
  }

  /* Valor tal como se capturó en el formulario (con unidad), sin los ajustes
     declarativos del manifiesto. */
  function valorCapturado(field, valores) {
    var raw = valores[field.id];
    if (field.tipo === 'numero') {
      if (raw == null || raw === '') return '';
      return String(raw) + (field.unidad || '');
    }
    if (field.tipo === 'select' || field.tipo === 'derivado') {
      return (raw == null) ? '' : String(raw);
    }
    if (field.tipo === 'preset') {
      if (raw === '__custom__') {
        var cv = valores[field.id + '::custom'];
        return (cv == null || cv === '') ? '' : String(cv) + (field.unidad || '');
      }
      return (raw == null) ? '' : String(raw);   // ya viene como "190mm"
    }
    return raw == null ? '' : String(raw);
  }

  /* Valor "efectivo" de un campo tal como se inyectará (incluye unidad).
     Con `manifest` aplica además el ajuste `suma` del manifiesto: el formulario
     captura la medida del CUERPO y aquí se agrega lo que el componente espera
     ver incluido (zócalo en LenZ, espesor de puerta en LenY). Sin `manifest` se
     obtiene el valor crudo, que es lo que necesitan los propios sumandos. */
  function effectiveValue(field, valores, manifest) {
    var v = valorCapturado(field, valores);
    if (!manifest || !field.suma || v === '') return v;
    var extra = sumaExtra(manifest, field, valores);
    if (!extra) return v;
    var base = parseMm(v);
    if (isNaN(base)) return v;
    // Se emite en mm aunque el campo declare otra unidad: el valor va etiquetado
    // y el motor lo convierte igual. Redondeo a centésima para no mandar 617.9999.
    return (Math.round((base + extra) * 100) / 100) + 'mm';
  }

  /* Milímetros que el manifiesto manda sumar al valor capturado (`suma`). Cada
     sumando puede traer condiciones `si` —todas deben cumplirse— para no sumar
     una puerta que no existe o que va montada por dentro del cuerpo. */
  function sumaExtra(manifest, field, valores) {
    var total = 0;
    (field.suma || []).forEach(function (s) {
      var aplica = (s.si || []).every(function (c) { return condicionCumple(manifest, valores, c); });
      if (!aplica) return;
      var f = fieldByAttr(manifest, s.attr);
      // Lo que no se inyecta tampoco existe en el modelo, así que no se suma.
      if (!f || !fieldInyecta(f, manifest, valores)) return;
      // Sin manifiesto: el sumando se lee crudo, para que un ajuste no pueda
      // encadenarse con otro (ni entrar en recursión).
      var mm = parseMm(valorCapturado(f, valores));
      if (!isNaN(mm)) total += mm;
    });
    return total;
  }

  /* Valor numérico simple de un attr (para visible_si / patrón de nombre). */
  function attrNumber(manifest, valores, attr) {
    var n = parseInt(attrRaw(manifest, valores, attr), 10);
    return isNaN(n) ? NaN : n;
  }
  /* Un valor forzado por el manifiesto manda sobre lo capturado aunque todavía
     no se haya escrito en el registro: así ninguna lectura puede resolverse con
     el valor viejo según en qué orden se llame. */
  function attrRaw(manifest, valores, attr) {
    var f = fieldByAttr(manifest, attr);
    if (!f) return undefined;
    var forz = valorForzado(f, manifest, valores);
    return forz != null ? forz : valores[f.id];
  }

  /* "190mm" / "25cm" / "600" -> milímetros. NaN si está vacío o no es medida. */
  function parseMm(valor) {
    if (valor == null) return NaN;
    var m = String(valor).trim().match(/^(-?[\d.,]+)\s*(mm|cm|cms|m|in|"|pulg)?$/i);
    if (!m) return NaN;
    var n = parseFloat(m[1].replace(',', '.'));
    if (isNaN(n)) return NaN;
    switch ((m[2] || 'mm').toLowerCase()) {
      case 'cm': case 'cms':      return n * 10;
      case 'm':                   return n * 1000;
      case 'in': case '"': case 'pulg': return n * 25.4;
      default:                    return n;
    }
  }
  /* Medida de un attr en mm, tal como se va a inyectar (resuelve presets y
     aplica `suma`: es el mismo número que verá SketchUp). */
  function attrMm(manifest, valores, attr) {
    var f = fieldByAttr(manifest, attr);
    return f ? parseMm(effectiveValue(f, valores, manifest)) : NaN;
  }
  function fmt(mm) { return String(Math.round(mm * 10) / 10); }

  function fieldVisible(field, manifest, valores) {
    if (!field.visible_si) return true;
    // Sin `min` es el predicado normal del manifiesto: así un campo puede
    // aparecer solo con ciertos diseños de puerta, no solo por encima de un
    // número (Avento S trae dirección y tipo de apertura; Avento D, abatible).
    if (field.visible_si.min == null) return condicionCumple(manifest, valores, field.visible_si);
    var n = attrNumber(manifest, valores, field.visible_si.attr);
    if (isNaN(n)) return true;
    return n >= field.visible_si.min;
  }
  function groupEnabled(group, manifest, valores) {
    if (!group.condicion) return true;
    return condicionCumple(manifest, valores, group.condicion);
  }
  /* Predicado de condición del manifiesto, en una sola implementación para que
     habilitado_si y los sumandos de `suma` no puedan divergir:
       { attr, valor }        -> igual a ese valor
       { attr, valores: [] }  -> igual a alguno
       { attr, excepto: [] }  -> distinto de todos (ej. «puerta ≠ Ninguna»)
       { todas: [cond…] }     -> se cumplen todas (ej. «2 zonas Y zona 2 con cajones»)
       { alguna: [cond…] }    -> se cumple al menos una */
  function condicionCumple(manifest, valores, cond) {
    if (cond.todas) return cond.todas.every(function (c) { return condicionCumple(manifest, valores, c); });
    if (cond.alguna) return cond.alguna.some(function (c) { return condicionCumple(manifest, valores, c); });
    var actual = String(attrRaw(manifest, valores, cond.attr));
    if (cond.excepto) {
      return !cond.excepto.some(function (v) { return String(v) === actual; });
    }
    var esperado = cond.valores || [cond.valor];
    return esperado.some(function (v) { return String(v) === actual; });
  }
  /* Habilitación por campo: el control queda activo solo si el attr de referencia
     cumple la condición declarada. Un campo forzado nunca está activo: su valor
     ya no lo elige quien captura. */
  function fieldEnabled(field, manifest, valores) {
    if (valorForzado(field, manifest, valores) != null) return false;
    if (!field.habilitado_si) return true;
    return condicionCumple(manifest, valores, field.habilitado_si);
  }

  /* Valor que el manifiesto impone al campo cuando otra elección ya lo decidió
     (un Avento es de una sola puerta; con puerta de cajones no hay entrepaños).
     Gana la primera entrada de `forzar` cuyas condiciones se cumplan. */
  function valorForzado(field, manifest, valores) {
    var hit = null;
    (field.forzar || []).forEach(function (e) {
      if (hit != null) return;
      if ((e.si || []).every(function (c) { return condicionCumple(manifest, valores, c); })) hit = e.valor;
    });
    return hit;
  }

  /* Escribe los valores forzados en el registro. Se llama antes de leer la
     configuración (formulario, aplanado, validación) para que forzado y
     capturado no puedan discrepar: lo que se ve es lo que se inyecta. */
  function aplicarForzados(manifest, valores) {
    manifest.grupos.forEach(function (g) {
      g.campos.forEach(function (f) {
        var v = valorForzado(f, manifest, valores);
        if (v != null && valores[f.id] !== v) valores[f.id] = v;
      });
    });
  }

  /* Un campo llega al .skp si está visible y activo. Un valor forzado también
     viaja: el control se apaga, pero el atributo tiene que quedar escrito. */
  function fieldInyecta(field, manifest, valores) {
    return fieldVisible(field, manifest, valores) &&
           (fieldEnabled(field, manifest, valores) || valorForzado(field, manifest, valores) != null);
  }

  /* ¿El attr existe y está activo en esta configuración? (grupo habilitado +
     campo visible y activo). Es lo que decide si una regla que lo menciona
     aplica: un margen apagado no puede invalidar nada. */
  function attrActivo(manifest, valores, attr) {
    var res = false;
    manifest.grupos.forEach(function (g) {
      if (res || !groupEnabled(g, manifest, valores)) return;
      g.campos.forEach(function (f) {
        if (!res && f.attr === attr && fieldInyecta(f, manifest, valores)) res = true;
      });
    });
    return res;
  }

  /* Campo que puede quedarse vacío legítimamente: «Automático» reparte, y en un
     preset el valor vacío es una opción de la lista (Entrepaño). */
  function esAuto(field) { return !!field.auto; }

  /* Medida capturada, SIN el ajuste `suma` del manifiesto: las reglas
     geométricas comparan piezas del cuerpo entre sí (el zócalo contra el alto
     del cuerpo, no contra el alto ya compensado que ve SketchUp). */
  function attrMmCrudo(manifest, valores, attr) {
    var f = fieldByAttr(manifest, attr);
    return f ? parseMm(valorCapturado(f, valores)) : NaN;
  }

  // =========================================================================
  //  Presupuesto de alto de cajones — una pila por zona de fachada
  // -------------------------------------------------------------------------
  //  El gabinete por zonas reparte la fachada en 1 o 2 zonas y cada zona puede
  //  llevar su propia pila de 1–6 cajones. El componente hace el reparto solo
  //  (alturas iguales, o personalizadas con «0 = igual» y el último tomando el
  //  resto), pero NO conoce el alto físico mínimo de un cajón: con cajones
  //  demasiado bajos recorta hasta 10 mm y el herraje no entra. Aquí se repite
  //  su misma cuenta para bloquearlo antes de generar.
  //
  //  Todo vive en manifest.reglas_cajones (dato, no código):
  //    fachada          { attr_alto, restar[] }       alto total menos zoclo/márgenes
  //    margen_superior  [{ attr, si? }]               el primero que cumple manda
  //    separacion       [{ attr, si? }]               idem (gola vs tirador)
  //    zonas            { attr_cantidad, attr_alto_superior }
  //    pilas            [{ id, titulo, zona, si[], attr_cantidad, attr_modo,
  //                        valor_personalizado, attrs_alto[], max[] }]
  //  Espejo en Ruby: validar_cajones en main.rb.
  // =========================================================================

  /* Primer `attr` de la lista cuyas condiciones `si` se cumplen, en mm.
     0 si ninguna aplica o el campo no existe en el manifiesto. */
  function mmSegun(manifest, valores, lista) {
    var hit = (lista || []).filter(function (e) {
      return (e.si || []).every(function (c) { return condicionCumple(manifest, valores, c); });
    })[0];
    if (!hit) return 0;
    var mm = attrMm(manifest, valores, hit.attr);
    return isNaN(mm) ? 0 : mm;
  }

  /* Alto de la fachada = s01altofachada del componente:
     LenZ (ya con el zoclo sumado) − zoclo − margen superior − margen inferior. */
  function altoFachada(manifest, valores) {
    var R = manifest.reglas_cajones;
    var alto = attrMm(manifest, valores, R.fachada.attr_alto);
    if (isNaN(alto)) return NaN;
    (R.fachada.restar || []).forEach(function (a) {
      var v = attrMm(manifest, valores, a);
      if (!isNaN(v)) alto -= v;
    });
    return alto - mmSegun(manifest, valores, R.margen_superior);
  }

  function sepCajones(manifest, valores) {
    return mmSegun(manifest, valores, manifest.reglas_cajones.separacion);
  }

  /* Alto de la zona 1 (superior) o 2 (inferior) = zn11altozona1 / zn21altozona2.
     Con una sola zona, la zona 1 ocupa toda la fachada. La separación entre
     zonas es la misma que entre cajones (u02sepcajgola). */
  function altoZona(manifest, valores, zona) {
    var R = manifest.reglas_cajones;
    var F = altoFachada(manifest, valores);
    if (isNaN(F)) return NaN;
    var nz = attrNumber(manifest, valores, R.zonas.attr_cantidad);
    if (nz !== 2) return F;
    var sep = sepCajones(manifest, valores);
    var sup = attrMm(manifest, valores, R.zonas.attr_alto_superior);
    var z1 = Math.max(1, (!isNaN(sup) && sup > 0) ? sup : (F - sep) / 2);
    return zona === 1 ? z1 : Math.max(1, F - sep - z1);
  }

  function pilasCajones(manifest) {
    var R = manifest.reglas_cajones;
    return (R && R.pilas) || [];
  }
  function pilaPorId(manifest, id) {
    return pilasCajones(manifest).filter(function (p) { return p.id === id; })[0] || null;
  }

  function presupuestoCajones(manifest, valores, pilaId) {
    var R = manifest.reglas_cajones;
    var P = pilaPorId(manifest, pilaId);
    if (!R || !P) return { aplica: false };
    if (!(P.si || []).every(function (c) { return condicionCumple(manifest, valores, c); })) {
      return { aplica: false };
    }
    var n = attrNumber(manifest, valores, P.attr_cantidad);
    if (isNaN(n) || n < 1) return { aplica: false };

    var zona = altoZona(manifest, valores, P.zona);
    if (isNaN(zona)) return { aplica: false };
    var sep        = sepCajones(manifest, valores);
    var altoMin    = R.alto_min_mm || 0;
    var disponible = zona - sep * (n - 1);   // suma de los n frentes
    var igual      = disponible / n;
    var personal   = condicionCumple(manifest, valores, { attr: P.attr_modo, valor: P.valor_personalizado });
    var attrsAlto  = (P.attrs_alto || []).slice(0, n);

    // Mismo reparto que el componente: con «Personalizado» cada cajón toma su
    // valor (0 = igual) y el último se queda con lo que reste; con «Iguales»
    // todos miden lo mismo.
    var altos = [], fijos = [];
    for (var i = 0; i < n - 1; i++) {
      var v = personal ? attrMm(manifest, valores, attrsAlto[i]) : NaN;
      if (!isNaN(v) && v > 0) { altos.push(v); fijos.push({ mm: v, i: i }); }
      else altos.push(igual);
    }
    var asignado = altos.reduce(function (s, v) { return s + v; }, 0);
    var ultimo   = n === 1 ? disponible : disponible - asignado;
    altos.push(ultimo);

    var paso = altoMin + sep;
    // nMax = tope geométrico de la zona (todos los cajones al mínimo).
    var nMax = paso > 0 ? Math.max(1, Math.floor((zona + sep) / paso)) : n;

    var ok = true, mensaje = '';
    var tope = (P.max || []).filter(function (e) {
      return (e.si || []).every(function (c) { return condicionCumple(manifest, valores, c); });
    })[0];
    var chico = fijos.filter(function (f) { return f.mm < altoMin; })[0];
    if (tope && n > tope.n) {
      ok = false;
      mensaje = tope.mensaje || ('Máximo ' + tope.n + ' cajones en esta zona.');
    } else if (disponible <= 0) {
      ok = false;
      mensaje = 'La zona quedó en ' + fmt(zona) + ' mm. Revisa alto, zoclo, márgenes y alto de zonas.';
    } else if (!personal && igual < altoMin) {
      ok = false;
      mensaje = n + ' cajones iguales en ' + fmt(disponible) + ' mm = ' + fmt(igual) +
                ' mm cada uno, por debajo del mínimo de ' + altoMin + ' mm. En esta zona caben máximo ' +
                nMax + (nMax === 1 ? ' cajón.' : ' cajones.');
    } else if (chico) {
      ok = false;
      mensaje = 'El alto del cajón ' + (chico.i + 1) + ' (' + fmt(chico.mm) + ' mm) es menor al mínimo de ' +
                altoMin + ' mm.';
    } else if (ultimo < altoMin) {
      ok = false;
      mensaje = n === 1
        ? 'El cajón queda en ' + fmt(ultimo) + ' mm, por debajo del mínimo de ' + altoMin + ' mm.'
        : 'Los cajones 1–' + (n - 1) + ' suman ' + fmt(asignado) + ' mm y al último (el que toma el resto) le quedan ' +
          fmt(ultimo) + ' mm, por debajo del mínimo de ' + altoMin + ' mm.';
    }

    return {
      aplica: true, id: P.id, titulo: P.titulo || P.id, n: n, zona: zona, sep: sep,
      disponible: disponible, igual: igual, personal: personal, altos: altos,
      asignado: asignado, ultimo: ultimo, attrsAlto: attrsAlto,
      altoMin: altoMin, nMax: nMax, ok: ok, mensaje: mensaje
    };
  }

  /* Presupuestos de todas las pilas que aplican en esta configuración. */
  function presupuestosCajones(manifest, valores) {
    return pilasCajones(manifest)
      .map(function (P) { return presupuestoCajones(manifest, valores, P.id); })
      .filter(function (p) { return p.aplica; });
  }

  /* Alto máximo que puede tomar el cajón `attr` sin dejar al último (el que
     toma el resto) por debajo del mínimo. Lo usan los presets de alto. */
  function limiteAltoCajon(manifest, valores, attr) {
    var pila = pilasCajones(manifest).filter(function (P) {
      return (P.attrs_alto || []).indexOf(attr) >= 0;
    })[0];
    if (!pila) return Infinity;
    var p = presupuestoCajones(manifest, valores, pila.id);
    if (!p.aplica) return Infinity;
    var i = p.attrsAlto.indexOf(attr);
    if (i < 0 || i === p.n - 1) return Infinity;
    var otros = 0;
    p.altos.forEach(function (mm, j) { if (j !== i && j !== p.n - 1) otros += mm; });
    return p.disponible - otros - p.altoMin;
  }

  // =========================================================================
  //  Geometría de entrepaños, frentes y cajones (gráfico interactivo)
  // -------------------------------------------------------------------------
  //  Repite las fórmulas del componente, verificadas contra la geometría que
  //  genera SketchUp (2026-10-07). Coordenadas del CUERPO: z = 0 en la cara de
  //  abajo del cuerpo (arriba del zoclo), y = 0 en la cara frontal del cuerpo,
  //  creciendo hacia el fondo. Todo en mm.
  //
  //  Repisas (DIA01 bajo Estructura):
  //    interior  = cuerpo − 2 × espesor;  n repisas dejan n + 1 espacios
  //    «Iguales» → (interior − n × espesor) / (n + 1); «Personalizado» → cada
  //    espacio su medida y los vacíos/0 se reparten el resto
  //    fondo     = cuerpo − reserva del fondo (v41tamlenyrep1)
  //    repisa    = fondo − retiro (g01margenf = h2N)
  //  Frentes y cajones (Z1/Z2_PUERTA, Z1/Z2_CAJONES → Cajon):
  //    zonas como zn11/zn21; cajón 1 = el de ARRIBA; el último toma el resto
  //    caja      = desde el frente del cuerpo hacia atrás, largo = corredera
  //    base caja = borde inferior del frente + e34 (28 mm)
  //    lateral   = n12altolatfront acotado (ver altoLateralCajon)
  // =========================================================================

  /* Tipo de fondo del componente: Estructura!o01tipofondo =
     IF(i06_trasera=1, 1, IF(i05_ceja_trasera=1, 2, 3)). */
  function tipoFondo(manifest, valores, V) {
    if (condicionCumple(manifest, valores, V.fondo_tarja)) return 1;
    if (condicionCumple(manifest, valores, V.fondo_sin_ceja)) return 2;
    return 3;
  }

  /* Lo que el fondo ocupa detrás. Las repisas (v41tamlenyrep1) y los cajones
     (s04profinterior) usan tablas distintas: con tarja la repisa llega atrás
     del todo, pero el cajón sigue descontando el espesor del fondo. */
  function reservaFondo(manifest, valores, V, para) {
    var num = function (a) { var v = attrMmCrudo(manifest, valores, a); return isNaN(v) ? 0 : v; };
    var c03 = num(V.fondo), c01 = num(V.espesor_estructura);
    var ranura = (V.ranura_mm || 0) === 0 ? c01 : V.ranura_mm;      // i25 (técnico)
    var t = tipoFondo(manifest, valores, V);
    if (para === 'cajones') return [c03, c03, ranura + c03][t - 1];
    return [0, c03, ranura + c03][t - 1];
  }

  /* Valor de la fórmula del entrepaño: la repisa queda 5 cm más corta que el
     cuerpo (la misma que inyecta el preset «Entrepaño»). */
  function retiroFormulaMm(manifest, valores, V) {
    return 50 - reservaFondo(manifest, valores, V, 'repisas');
  }

  /* Retiro efectivo de una repisa: preset «Entrepaño» = fórmula, «Divisor» = 0,
     o la medida personalizada. */
  function retiroRepisa(manifest, valores, V, attr) {
    var f = fieldByAttr(manifest, attr);
    if (!f) return 0;
    var v = valorCapturado(f, valores);
    if (v === '') return retiroFormulaMm(manifest, valores, V);
    var mm = parseMm(v);
    return isNaN(mm) ? 0 : mm;
  }

  function geomEntrepanos(manifest, valores, V) {
    var num = function (a) { var v = a ? attrMmCrudo(manifest, valores, a) : NaN; return isNaN(v) ? 0 : v; };
    var on = condicionCumple(manifest, valores, V.activo);
    var esp    = num(V.espesor_estructura);
    var cuerpo = num(V.alto);
    var fondoC = num(V.profundidad);
    var alto   = cuerpo - 2 * esp;
    var ancho  = num(V.ancho) - 2 * esp;
    var reserva = reservaFondo(manifest, valores, V, 'repisas');
    var prof   = fondoC - reserva;
    var n      = on ? (attrNumber(manifest, valores, V.cantidad) || 0) : 0;
    var personal = condicionCumple(manifest, valores, { attr: V.modo, valor: V.modo_personalizado });
    var k      = n + 1;
    var libre  = alto - n * esp;

    var crudos = (V.espacios || []).slice(0, k).map(function (a) { return personal ? num(a) : 0; });
    while (crudos.length < k) crudos.push(0);
    var fijos  = crudos.reduce(function (s, v) { return s + (v > 0 ? v : 0); }, 0);
    var ceros  = crudos.filter(function (v) { return !(v > 0); }).length;
    var auto   = ceros > 0 ? (libre - fijos) / ceros : 0;
    var espacios = crudos.map(function (v) { return v > 0 ? v : auto; });

    var latIzq = num(V.lateral_izq), latDer = num(V.lateral_der);
    var repisas = [], z = 0;
    for (var i = 0; i < n; i++) {
      z += espacios[i];
      var retiro = retiroRepisa(manifest, valores, V, V.retiros[i]);
      var f = fieldByAttr(manifest, V.retiros[i]);
      repisas.push({ i: i, z: z, zCuerpo: esp + z, divisor: retiro < 0.5, retiro: retiro,
                     formula: !!f && valorCapturado(f, valores) === '',
                     profundidad: prof - retiro,
                     // La holgura lateral es UNA para todas las repisas en el
                     // componente: un divisor junto a entrepaños también la lleva.
                     lateralIzq: latIzq, lateralDer: latDer });
      z += esp;
    }
    var usado = espacios.reduce(function (s, v) { return s + v; }, 0) + n * esp;
    return { on: on, cuerpo: cuerpo, fondoCuerpo: fondoC, alto: alto, ancho: ancho, prof: prof,
             reserva: reserva, esp: esp, n: n, personal: personal,
             espacios: espacios, crudos: crudos, repisas: repisas, libre: libre, fijos: fijos,
             retiroFormula: retiroFormulaMm(manifest, valores, V),
             // Lo fijado que no cabe: si hay espacios en 0, ellos absorben (y quedan
             // negativos) en vez de que la suma total crezca.
             exceso: Math.max(usado - alto, fijos - libre), latIzq: latIzq, latDer: latDer };
  }

  /* Alto del lateral de la caja (Cajon!u02altolateral), en mm, para un frente
     de alto `h` mm. Las fórmulas del componente van en cm y redondean a 1 decimal:
       Tandem      n12 = ROUND(h·0.8808 − 5.735, 1)
       Antaro      n12 = ROUND(h·0.4301 + 0.229, 1)
       Telescópica n12 = e32 (12 cm)
     y luego se acota entre 3 cm y h − margen inferior. Un alto fijo de lateral
     (e35, Tandem/Antaro) reemplaza la fórmula. */
  function altoLateralCajon(tipo, hMm, C) {
    var h = hMm / 10;
    var r1 = function (x) { return Math.round(x * 10) / 10; };
    var fijo = (C.alto_lateral_tandem_antaro_mm || 0) / 10;
    var n12 = tipo === 3 ? (C.alto_lateral_telescopica_mm || 120) / 10
            : fijo > 0 ? fijo
            : tipo === 2 ? r1(h * 0.4301 + 0.229) : r1(h * 0.8808 - 5.735);
    var n13 = (C.margen_lateral_frontal_mm || 0) / 10, n15 = (C.margen_inferior_mm || 0) / 10;
    var lat = n12 - n13;
    if (lat < 3) lat = 3;
    else if (lat > h - n15 - n13) lat = h - n15 - n13;
    return lat * 10;
  }

  /* Largo de la caja (= corredera). Automático: n01corredauto =
     FLOOR(fondo, 5 cm) − IF(telescópica, 0, n05 + IF(Tandem, −1, 2.4)) cm. */
  function largoCajon(tipo, corrMm, fondoMm, C) {
    if (corrMm > 0) return corrMm;
    var base = Math.floor(fondoMm / 50 + 1e-9) * 50;
    if (tipo === 3) return base;
    return base - ((C.corredera_margen_post_mm || 0) + (tipo === 1 ? -10 : 24));
  }

  /* Frentes (puertas y cajones) y cajas de cajón de las zonas de fachada. */
  function geomFrentes(manifest, valores, V) {
    var C = V.cajones || {};
    var num = function (a) { var v = a ? attrMmCrudo(manifest, valores, a) : NaN; return isNaN(v) ? 0 : v; };
    var R = manifest.reglas_cajones;
    if (!R) return { zonas: [] };
    var cuerpo = num(V.alto), ancho = num(V.ancho), esp = num(V.espesor_estructura);
    var espPuerta = num(V.espesor_puerta);
    var k02 = num(V.margen_inf);
    var k03 = num(V.margen_izq), k04 = num(V.margen_der), k13 = num(V.sep_puertas);
    var sep = sepCajones(manifest, valores);
    var interior = condicionCumple(manifest, valores, V.montaje_interior);
    var nz = attrNumber(manifest, valores, R.zonas.attr_cantidad) === 2 ? 2 : 1;
    var h1 = altoZona(manifest, valores, 1), h2 = nz === 2 ? altoZona(manifest, valores, 2) : 0;
    var tipo = parseInt(attrRaw(manifest, valores, C.tipo), 10) || 1;
    var corr = num(C.corredera);
    var fondoCaj = num(V.profundidad) - reservaFondo(manifest, valores, V, 'cajones');
    var inset = esp + (tipo === 1 ? 10 : tipo === 2 ? 37.5 : (C.espesor_telescopica_mm || 13));

    var zonas = [];
    var defs = [{ zona: 1, z0: nz === 2 ? k02 + h2 + sep : k02, h: h1 }];
    if (nz === 2) defs.push({ zona: 2, z0: k02, h: h2 });
    defs.forEach(function (d) {
      var Z = (V.zonas || [])[d.zona - 1];
      var cont = String(attrRaw(manifest, valores, Z.contenido));
      var x0 = k03, x1 = ancho - k04;
      var zona = { zona: d.zona, z0: d.z0, z1: d.z0 + d.h, contenido: cont === '1' ? 'puerta' : cont === '2' ? 'cajones' : 'nada',
                   frentes: [], cajas: [] };
      // «Montaje interior» solo mete las PUERTAS dentro del cuerpo (Z?_PUERTA
      // usa f01posextintpu); los frentes de cajón siguen por fuera. Medido.
      if (zona.contenido === 'puerta') {
        var px0 = interior ? esp : x0, px1 = interior ? ancho - esp : x1;
        var fz0 = interior ? d.z0 + esp : d.z0, fz1 = interior ? d.z0 + d.h - esp : d.z0 + d.h;
        var v = parseInt(attrRaw(manifest, valores, Z.puertas), 10) || 1;
        var hojas = v <= 2 ? 1 : v - 1;
        var w = (px1 - px0 - (hojas - 1) * k13) / hojas;
        for (var i = 0; i < hojas; i++) {
          zona.frentes.push({ tipo: 'puerta', interior: interior, x0: px0 + i * (w + k13), x1: px0 + i * (w + k13) + w, z0: fz0, z1: fz1 });
        }
      } else if (zona.contenido === 'cajones') {
        var p = presupuestoCajones(manifest, valores, Z.pila);
        if (p.aplica) {
          var top = d.z0 + d.h;
          p.altos.forEach(function (hc, j) {
            var zf1 = top, zf0 = top - hc;
            top = zf0 - sep;
            zona.frentes.push({ tipo: 'cajon', n: j + 1, x0: x0, x1: x1, z0: zf0, z1: zf1 });
            var lat = altoLateralCajon(tipo, hc, C);
            var cz0 = zf0 + (C.margen_inferior_mm || 0);
            zona.cajas.push({ n: j + 1, x0: inset, x1: ancho - inset, z0: cz0, z1: cz0 + lat,
                              y0: 0, y1: largoCajon(tipo, corr, fondoCaj, C) });
          });
        }
      }
      zonas.push(zona);
    });
    return { zonas: zonas, cuerpo: cuerpo, ancho: ancho, espPuerta: espPuerta, interior: interior,
             tipoCajon: tipo, fondoCajones: fondoCaj };
  }

  /* Choques de las repisas con lo que hay en las zonas: cajas de cajón (en
     altura y en fondo) y puertas montadas por dentro del cuerpo. */
  function choquesRepisas(G, F) {
    var out = [];
    G.repisas.forEach(function (r) {
      var z0 = r.zCuerpo, z1 = r.zCuerpo + G.esp;
      F.zonas.forEach(function (zn) {
        // Un cajón usa todo el alto de su frente al abrirse y cerrarse (lo que se
        // guarda, el herraje), no solo el de su caja dibujada: la franja que
        // ocupan los cajones va de la base de la caja de abajo al tope de la zona.
        // La repisa ocupa del fondo hasta (frente + retiro) y la caja del frente
        // hasta su largo: se cruzan en fondo si el retiro es menor que la caja.
        if (!zn.cajas.length) return;
        var b0 = Math.min.apply(null, zn.cajas.map(function (c) { return c.z0; }));
        var largo = Math.max.apply(null, zn.cajas.map(function (c) { return c.y1; }));
        if (z1 > b0 + 0.5 && z0 < zn.z1 - 0.5 && r.retiro < largo) {
          out.push({ repisa: r.i, zona: zn.zona, motivo: 'cajon' });
        }
      });
      F.zonas.forEach(function (zn) {
        if (F.interior && zn.contenido === 'puerta' && z1 > zn.z0 && z0 < zn.z1 && r.retiro < F.espPuerta) {
          out.push({ repisa: r.i, zona: zn.zona, motivo: 'puerta' });
        }
      });
    });
    return out;
  }

  function visualesEntrepanos(manifest) {
    return manifest.grupos.filter(function (g) { return g.visual && g.visual.tipo === 'entrepanos'; });
  }

  // =========================================================================
  //  Presupuesto de alto de divisores  (R-14)
  // -------------------------------------------------------------------------
  //  A diferencia de los cajones, esto NO bloquea: los espacios personalizados
  //  que no llenan el alto pueden ser una variante legítima. Solo tienen que
  //  verse, con el mismo resumen que la pila de cajones.
  // =========================================================================
  function presupuestoDivisores(manifest, valores) {
    var D = manifest.reglas_divisores;
    var R = D && D.presupuesto;
    if (!R || !attrActivo(manifest, valores, D.attr_cantidad)) return { aplica: false };
    if (R.solo_si && !condicionCumple(manifest, valores, R.solo_si)) return { aplica: false };

    var n = attrNumber(manifest, valores, D.attr_cantidad);
    if (isNaN(n) || n < 1) return { aplica: false };

    // Crudo a propósito: el alto interior se mide contra el CUERPO, no contra el
    // alto ya compensado con el zócalo que se le manda a SketchUp.
    var util = attrMmCrudo(manifest, valores, R.attr_alto_util);
    if (isNaN(util)) return { aplica: false };
    (R.attr_restar || []).forEach(function (a) {
      var v = attrMmCrudo(manifest, valores, a);
      if (!isNaN(v)) util -= v;
    });

    var suma = 0, puestos = 0;
    (R.attrs_espacio || []).slice(0, n).forEach(function (a) {
      var v = attrMmCrudo(manifest, valores, a);
      if (!isNaN(v)) { suma += v; puestos++; }
    });

    return {
      aplica: true, n: n, util: util, suma: suma, puestos: puestos,
      exceso: suma - util, ok: suma - util <= 1
    };
  }

  // =========================================================================
  //  Validación de la configuración — una sola capa (DEV-21)
  // -------------------------------------------------------------------------
  //  La usan los tres caminos que pueden producir un .skp: el botón «Generar»,
  //  el pre-vuelo de «Generar todos» y la revisión de la importación. Tener una
  //  sola implementación es el punto de R-32: dos caminos que generan el mismo
  //  archivo no pueden aceptar cosas distintas.
  //
  //  Devuelve [{ ids, label, msg }]; `ids` son los campos que hay que marcar.
  // =========================================================================
  function erroresConfig(manifest, valores) {
    aplicarForzados(manifest, valores);
    var errs = [];

    // Campo por campo: requerido (R-27/R-20), medida válida (R-09/R-22) y signo
    // (R-08). Un campo apagado no se valida: no va a llegar al modelo.
    manifest.grupos.forEach(function (g) {
      var gOn = groupEnabled(g, manifest, valores);
      g.campos.forEach(function (f) {
        if (!gOn || !fieldVisible(f, manifest, valores) || !fieldEnabled(f, manifest, valores)) return;
        var v = valorCapturado(f, valores);
        if (v === '') {
          if (!esAuto(f)) errs.push({ ids: [f.id], label: f.label, msg: 'Falta el valor.' });
          return;
        }
        if (f.tipo !== 'numero' && f.tipo !== 'preset') return;
        var mm = parseMm(v);
        if (isNaN(mm))          errs.push({ ids: [f.id], label: f.label, msg: 'No es una medida válida: «' + v + '».' });
        else if (mm < 0)        errs.push({ ids: [f.id], label: f.label, msg: 'No puede ser negativo.' });
        else if (f.positivo && mm === 0) errs.push({ ids: [f.id], label: f.label, msg: 'Tiene que ser mayor que cero.' });
      });
    });

    // Imposibles geométricos declarados en el manifiesto (R-10/R-11/R-12/R-25):
    // la suma de unas piezas contra la dimensión de la que se descuentan.
    (manifest.reglas_geometria || []).forEach(function (r) {
      if (!attrActivo(manifest, valores, r.menor_que)) return;
      var objetivo = attrMmCrudo(manifest, valores, r.menor_que);
      if (isNaN(objetivo)) return;

      var suma = 0, hay = false, ids = [];
      (r.attrs || []).forEach(function (a) {
        if (!attrActivo(manifest, valores, a)) return;
        var v = attrMmCrudo(manifest, valores, a);
        if (isNaN(v)) return;
        var f = fieldByAttr(manifest, a);
        if (f) ids.push(f.id);
        suma += v; hay = true;
      });
      if (!hay) return;

      var mal = (r.modo === '<=') ? (suma > objetivo + 0.01) : (suma >= objetivo - 0.01);
      if (mal) errs.push({ ids: ids, label: '', msg: r.mensaje + ' (' + fmt(suma) + ' mm contra ' + fmt(objetivo) + ' mm).' });
    });

    presupuestosCajones(manifest, valores).forEach(function (p) {
      if (p.ok) return;
      var P = pilaPorId(manifest, p.id);
      var f = P && fieldByAttr(manifest, P.attr_cantidad);
      errs.push({ ids: p.attrsAlto.map(function (a) { var c = fieldByAttr(manifest, a); return c ? c.id : a; })
                    .concat(f ? [f.id] : []),
                  label: 'Cajones ' + p.titulo, msg: p.mensaje });
    });

    return errs;
  }

  /* Lo que debe verse pero no bloquea (R-14 y R-17). */
  function avisosConfig(manifest, valores) {
    var out = [];
    visualesEntrepanos(manifest).forEach(function (g) {
      if (!groupEnabled(g, manifest, valores)) return;
      var G = geomEntrepanos(manifest, valores, g.visual);
      if (!G.on || !G.n) return;
      if (G.exceso > 1) {
        out.push('Los espacios fijados entre repisas suman ' + fmt(G.fijos) + ' mm y solo caben ' + fmt(G.libre) +
                 ' mm: se pasan ' + fmt(G.exceso) + ' mm.');
      } else {
        G.espacios.forEach(function (e, i) {
          if (e < 1) out.push('El espacio ' + (i + 1) + ' entre repisas quedó en ' + fmt(e) + ' mm.');
        });
      }
      G.repisas.forEach(function (r) {
        if (r.profundidad < 50) out.push('La repisa ' + (r.i + 1) + ' queda de ' + fmt(r.profundidad) + ' mm de profundidad: revisa su retiro.');
      });
      choquesRepisas(G, geomFrentes(manifest, valores, g.visual)).forEach(function (c) {
        out.push(c.motivo === 'cajon'
          ? 'La repisa ' + (c.repisa + 1) + ' choca con los cajones de la zona ' + c.zona + ': súbela a la zona de puerta o quítala.'
          : 'La repisa ' + (c.repisa + 1) + ' choca con la puerta interior de la zona ' + c.zona +
            ': dale un retiro de al menos el espesor de puerta.');
      });
    });
    var d = presupuestoDivisores(manifest, valores);
    if (d.aplica && !d.ok) {
      out.push('Los espacios de los divisores suman ' + fmt(d.suma) + ' mm y el alto interior es ' + fmt(d.util) + ' mm.');
    }
    return out;
  }

  var RE_NOMBRE_INVALIDO = /[\\\/:*?"<>|]/;

  /* Todo lo que impide generar un registro, en texto listo para mostrar.
     Incluye el nombre de archivo (R-28), que no es parte del manifiesto. */
  function problemasRegistro(r) {
    var manifest = findManifest(r.familia);
    if (!manifest) return ['No se cargó el manifiesto de ' + r.titulo + '.'];

    var msgs = erroresConfig(manifest, r.valores).map(function (e) {
      return e.label ? e.label + ': ' + e.msg : e.msg;
    });
    var n = (r.nombre_salida || '').trim();
    if (!n) msgs.push('Falta el nombre del módulo.');
    else if (RE_NOMBRE_INVALIDO.test(n)) {
      msgs.push('El nombre no puede llevar \\ / : * ? " < > |');
    }
    return msgs;
  }

  /* Nombre libre en la sesión: al repetirse se numera en vez de sobrescribir el
     .skp del módulo anterior (R-29). */
  function nombreUnico(base, idPropio) {
    var usados = {};
    state.registros.forEach(function (r) {
      if (r.id !== idPropio && r.nombre_salida) usados[normTexto(r.nombre_salida)] = true;
    });
    var nombre = base, n = 2;
    while (usados[normTexto(nombre)]) { nombre = base + '-' + n; n++; }
    return nombre;
  }

  // ---- Defaults / registro nuevo ------------------------------------------
  function defaultValores(manifest) {
    var v = {};
    manifest.grupos.forEach(function (g) {
      g.campos.forEach(function (f) {
        if (f.tipo === 'preset') {
          // default "" es legítimo (ej. «Automático»); solo se cae al primer
          // preset cuando el manifiesto no declara default.
          v[f.id] = (f.default != null) ? f.default : (f.presets[0] ? f.presets[0].valor : '');
          v[f.id + '::custom'] = '';
        } else {
          v[f.id] = (f.default != null) ? f.default : '';
        }
      });
    });
    return v;
  }

  /* Patrón del nombre de archivo:
       {attr}        -> valor del attr, traducido por `nombre_codigos[attr]` si
                        lo declara (p. ej. Cajones = "C"). Un attr que no se
                        inyecta en esta configuración se escribe vacío.
       [ … ]         -> tramo opcional: desaparece si todos sus {attr} quedaron
                        vacíos (la zona 2 de un gabinete de una sola zona).
     Sin `nombre_codigos`, un {attr} vacío vale "0" como antes. */
  function autoNombre(manifest, valores) {
    var patron = manifest.nombre_patron;
    if (!patron) return manifest.titulo + '-' + state.seq;
    var codigos = manifest.nombre_codigos;
    function token(attr) {
      if (codigos && !attrActivo(manifest, valores, attr)) return '';
      var r = attrRaw(manifest, valores, attr);
      if (r == null || r === '') return codigos ? '' : '0';
      var mapa = codigos && codigos[attr];
      if (mapa && Object.prototype.hasOwnProperty.call(mapa, String(r))) return mapa[String(r)];
      return String(r);
    }
    function sustituir(txt) {
      var hubo = false;
      var out = txt.replace(/\{([^}]+)\}/g, function (_, attr) {
        var t = token(attr);
        if (t !== '') hubo = true;
        return t;
      });
      return { txt: out, hubo: hubo };
    }
    var conTramos = patron.replace(/\[([^\]]*)\]/g, function (_, dentro) {
      var s = sustituir(dentro);
      return s.hubo ? s.txt : '';
    });
    return sustituir(conTramos).txt;
  }

  /* El nombre del archivo describe la configuración, así que se recalcula en
     cada cambio mientras nadie haya escrito uno propio (R-30), y se numera si
     ya existe en la sesión (R-29). */
  function refrescarAutoNombre(manifest, registro) {
    if (registro.nombreManual) return;
    registro.nombre_salida = nombreUnico(autoNombre(manifest, registro.valores), registro.id);
    var input = $('#nombre-salida');
    if (input && state.activeId === registro.id && !state.importar) input.value = registro.nombre_salida;
  }

  // =========================================================================
  //  Render: sidebar
  // =========================================================================
  function renderSidebar() {
    var cont = $('#lista-modulos');
    cont.innerHTML = '';
    $('#modulos-vacio').hidden = state.registros.length > 0;

    state.registros.forEach(function (r) {
      var card = el('div', 'mod-card' + (r.id === state.activeId ? ' is-active' : ''));
      card.addEventListener('click', function () { selectRegistro(r.id); });

      var top = el('div', 'mod-card__top');
      top.appendChild(el('span', 'mod-card__name', r.nombre_salida || '(sin nombre)'));
      var del = el('button', 'mod-card__del', '×');
      del.title = 'Eliminar módulo';
      del.addEventListener('click', function (ev) { ev.stopPropagation(); deleteRegistro(r.id); });
      top.appendChild(del);

      var meta = el('div', 'mod-card__meta');
      meta.appendChild(el('span', null, (ICONOS[r.familia] || '•') + ' ' + r.titulo));
      var estado = el('span', null, ESTADOS[r.estado] || 'borrador');
      // El resumen del lote solo da conteos; el motivo del fallo vive aquí.
      if (r.estado === 'error') {
        estado.className = 'mod-card__error';
        estado.title = r.error || '';
      }
      meta.appendChild(estado);

      card.appendChild(top);
      card.appendChild(meta);
      cont.appendChild(card);
    });

    actualizarBotonLote();
  }

  function renderRoot() {
    var p = $('#root-path');
    p.textContent = state.projectRoot || '—';
    p.title = state.projectRoot || '';
    p.classList.toggle('is-bad', !state.rootValido);
  }

  // =========================================================================
  //  Render: editor (formulario)
  // =========================================================================
  function renderEditor() {
    // Con una importación en revisión, la tabla manda: cambiar de panel a media
    // corrección perdería lo capturado sin que nadie lo haya pedido.
    if (state.importar) { renderImport(); return; }
    var r = activeRegistro();
    if (!r) { showPane('empty'); return; }
    var manifest = findManifest(r.familia);
    if (!manifest) { requestManifest(r.familia, r.id); return; }
    showPane('editor');

    $('#editor-familia').textContent = manifest.titulo;
    var nameInput = $('#nombre-salida');
    nameInput.value = r.nombre_salida || '';

    var body = $('#form-grupos');
    body.innerHTML = '';
    // Lista de lo que impide generar; refreshErrores() la llena y la muestra.
    var errores = el('p', 'budget');
    errores.id = 'form-errores';
    errores.hidden = true;
    body.appendChild(errores);
    manifest.grupos.forEach(function (g) {
      body.appendChild(renderGroup(g, manifest, r));
    });
    updateConditionals(manifest, r);
  }

  function renderGroup(group, manifest, registro) {
    var sec = el('section', 'group');
    sec.dataset.group = group.id;

    var head = el('button', 'group__head');
    head.type = 'button';
    var left = el('span', null, group.titulo);
    head.appendChild(left);
    var right = el('span');
    if (group.condicion) {
      var badge = el('span', 'group__badge', 'Condicional');
      right.appendChild(badge);
    }
    var caret = el('span', 'group__caret', '▾');
    right.appendChild(caret);
    head.appendChild(right);
    head.addEventListener('click', function () { sec.classList.toggle('is-collapsed'); });
    sec.appendChild(head);

    var bodyEl = el('div', 'group__body');
    if (group.condicion && group.condicion.mensaje) {
      bodyEl.appendChild(el('p', 'group__note', group.condicion.mensaje));
    }
    if (group.presupuesto) {
      var pres = el('p', 'budget');
      pres.dataset.budget = group.presupuesto;   // "cajones" | "divisores"
      pres.hidden = true;            // updateConditionals() lo llena y lo muestra
      bodyEl.appendChild(pres);
    }
    // El editor de caja se lleva los cuatro márgenes; el resto de los campos
    // sigue en el grid normal, en su orden original.
    var caja = group.box_model ? renderBoxModel(group.box_model, manifest, registro) : null;
    if (caja) bodyEl.appendChild(caja.widget);
    // Gráfico interactivo del grupo: edita los mismos campos que siguen debajo,
    // así que el CSV y el formulario numérico conservan toda la información.
    if (group.visual && group.visual.tipo === 'entrepanos') {
      bodyEl.appendChild(renderVisualEntrepanos(group.visual, manifest, registro));
    }

    group.campos.forEach(function (f) {
      if (caja && caja.usados[f.attr]) return;
      bodyEl.appendChild(renderField(f, manifest, registro));
    });
    sec.appendChild(bodyEl);
    return sec;
  }

  /* Editor de caja: los cuatro márgenes se dibujan donde van (arriba, abajo,
     izquierda, derecha) alrededor de un rectángulo que representa la pieza.
     Los `.field` son los mismos que produce renderField(), así que conservan su
     data-field-id y updateConditionals() los sigue encontrando sin cambios. */
  function renderBoxModel(spec, manifest, registro) {
    var LADOS = ['arriba', 'izquierda', 'derecha', 'abajo'];
    var usados = {};

    var widget = el('div', 'boxmodel');
    if (spec.titulo) widget.appendChild(el('div', 'boxmodel__titulo', spec.titulo));

    var centro = el('div', 'boxmodel__centro', spec.centro || '');
    var slots  = {};
    LADOS.forEach(function (lado) {
      var attr = spec[lado];
      if (!attr) return;
      var f = fieldByAttr(manifest, attr);
      if (!f) return;                     // manifiesto incompleto: se ignora el lado
      usados[attr] = true;
      slots[lado] = el('div', 'boxmodel__' + lado);
      slots[lado].appendChild(renderField(f, manifest, registro, true));
    });

    if (slots.arriba) widget.appendChild(slots.arriba);
    if (slots.izquierda) widget.appendChild(slots.izquierda);
    widget.appendChild(centro);
    if (slots.derecha) widget.appendChild(slots.derecha);
    if (slots.abajo) widget.appendChild(slots.abajo);

    return { widget: widget, usados: usados };
  }

  /* Gráfico interactivo de entrepaños y divisores, a medida real del cuerpo.
       · Alzado (de frente): cuerpo, interior, frentes (punteado fino) y cajas de
         cajón (sombreado). Arrastrar una repisa arriba/abajo cambia los altos de
         los espacios (pasa a «Personalizado»); clic alterna Entrepaño ↔ Divisor.
       · Corte lateral: frentes con su espesor, cajas con su largo, reserva del
         fondo y repisas. Arrastrar el canto de una repisa cambia su retiro; en 0
         se vuelve «Divisor», y un divisor arrastrado hacia atrás deja de serlo.
     No guarda estado propio: lee y escribe los mismos campos del manifiesto
     que se ven debajo, así que formulario, plantilla y CSV dicen lo mismo. */
  function renderVisualEntrepanos(V, manifest, registro) {
    var NS = 'http://www.w3.org/2000/svg';
    var wrap = el('div', 'visual visual--entrepanos');
    var barra = el('div', 'visual__barra');
    var vistas = el('div', 'visual__vistas');
    var pie = el('p', 'visual__pie');
    wrap.appendChild(barra); wrap.appendChild(vistas); wrap.appendChild(pie);

    var ESC_ALTO = 280;                 // alto de dibujo del cuerpo (px)
    var drag = null;

    function campo(attr) { return fieldByAttr(manifest, attr); }
    function wrapDe(f) { return document.querySelector('.field[data-field-id="' + f.id + '"]'); }
    function setValor(attr, valor) {
      var f = campo(attr);
      if (!f) return;
      registro.valores[f.id] = String(valor);
      var w = wrapDe(f);
      if (w) Array.prototype.forEach.call(w.querySelectorAll('input, select'), function (c) {
        if (c !== document.activeElement) c.value = String(valor);
      });
    }
    /* Retiro de una repisa: null = «Entrepaño» (fórmula), 0 = «Divisor», o mm. */
    function setRetiro(i, mm) {
      var f = campo(V.retiros[i]);
      if (!f) return;
      if (mm === null) { registro.valores[f.id] = ''; registro.valores[f.id + '::custom'] = ''; }
      else if (mm <= 0) { registro.valores[f.id] = '0mm'; registro.valores[f.id + '::custom'] = ''; }
      else { registro.valores[f.id] = '__custom__'; registro.valores[f.id + '::custom'] = String(Math.round(mm)); }
      var w = wrapDe(f), p = w && w.querySelector('.preset');
      if (p && p.__sync) p.__sync();
    }
    function cambio() { onValueChange(manifest, registro); }
    function svg(tag, attrs, txt) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (txt != null) n.textContent = txt;
      return n;
    }
    function rect(x, y, w, h, cls, extra) {
      return svg('rect', Object.assign({ 'class': cls, x: x, y: y, width: Math.max(0, w), height: Math.max(0, h) }, extra || {}));
    }
    function boton(txt, title, fn) {
      var b = el('button', 'visual__btn', txt);
      b.type = 'button'; b.title = title;
      b.addEventListener('click', fn);
      return b;
    }

    // ---- barra: cantidad, modo y leyenda --------------------------------
    var lblN = el('span', 'visual__n');
    var bMenos = boton('−', 'Quitar repisa', function () {
      var f = campo(V.cantidad), n = parseInt(registro.valores[f.id], 10) || 1;
      if (n > (f.min || 1)) { setValor(V.cantidad, n - 1); cambio(); }
    });
    var bMas = boton('+', 'Agregar repisa', function () {
      var f = campo(V.cantidad), n = parseInt(registro.valores[f.id], 10) || 1;
      if (n < (f.max || 6)) { setValor(V.cantidad, n + 1); cambio(); }
    });
    var bIguales = boton('Repartir iguales', 'Vuelve a separaciones iguales', function () {
      var f = campo(V.modo);
      var iguales = (f.opciones || []).filter(function (o) { return o.valor !== V.modo_personalizado; })[0];
      if (!iguales) return;
      setValor(V.modo, iguales.valor);
      V.espacios.forEach(function (a) { setValor(a, ''); });   // en «Iguales» no significan nada
      cambio();
    });
    barra.appendChild(bMenos); barra.appendChild(lblN); barra.appendChild(bMas);
    barra.appendChild(bIguales);
    var ley = el('span', 'visual__leyenda');
    ley.innerHTML = '<i class="sw sw--ent"></i>Entrepaño <i class="sw sw--div"></i>Divisor ' +
                    '<i class="sw sw--caj"></i>Cajón <i class="sw sw--fre"></i>Frente';
    barra.appendChild(ley);

    // ---- refresco de los campos numéricos (valores recalculados) ----------
    function refrescarCampos(G) {
      V.espacios.forEach(function (a, j) {
        var f = campo(a), w = f && wrapDe(f), inp = w && w.querySelector('input');
        if (!inp) return;
        inp.placeholder = j < G.espacios.length ? 'auto · ' + fmt(G.espacios[j]) : '';
        // El de más arriba no está «bajo» ninguna repisa: se dice en pantalla
        // (la etiqueta del manifiesto, que es el encabezado del CSV, no cambia).
        var lbl = w.querySelector('.field__label');
        if (lbl) lbl.textContent = (G.on && j === G.n) ? 'Espacio ' + (j + 1) + ' · arriba de todo' : f.label;
      });
      V.retiros.forEach(function (a) {
        var f = campo(a), w = f && wrapDe(f), sel = w && w.querySelector('select');
        if (!sel) return;
        Array.prototype.forEach.call(sel.options, function (o) {
          var p = (f.presets || []).filter(function (x) { return x.valor === o.value; })[0];
          if (p && p.formula) o.textContent = p.label + ' · ' + fmt(G.retiroFormula) + ' mm';
        });
      });
    }

    // ---- dibujo -----------------------------------------------------------
    function pintar() {
      aplicarForzados(manifest, registro.valores);
      var G = geomEntrepanos(manifest, registro.valores, V);
      var F = geomFrentes(manifest, registro.valores, V);
      var choques = G.on ? choquesRepisas(G, F) : [];
      var chocan = {};
      choques.forEach(function (c) { chocan[c.repisa] = true; });

      vistas.innerHTML = '';
      var fN = campo(V.cantidad);
      lblN.textContent = G.on ? (G.n + (G.n === 1 ? ' repisa' : ' repisas')) : 'Sin repisas';
      bMenos.disabled = !G.on || G.n <= (fN.min || 1);
      bMas.disabled   = !G.on || G.n >= (fN.max || 6);
      bIguales.disabled = !G.on || !G.personal;
      if (!(G.cuerpo > 0) || !(G.ancho > 0) || !(G.fondoCuerpo > 0)) {
        pie.textContent = 'Faltan las dimensiones del cuerpo para dibujar.';
        return;
      }
      refrescarCampos(G);

      var s = ESC_ALTO / G.cuerpo;                       // px por mm, común a las dos vistas
      var M = { t: 12, b: 24, l: 48, r: 18 };
      var Y = function (z) { return M.t + (G.cuerpo - z) * s; };   // z en coordenadas del cuerpo
      var tPx = Math.max(3, G.esp * s);
      var anchoC = G.ancho + 2 * G.esp;

      // ===== Alzado ==========================================================
      var wA = anchoC * s;
      var A = svg('svg', { 'class': 'visual__svg', width: wA + M.l + M.r, height: ESC_ALTO + M.t + M.b,
                           viewBox: '0 0 ' + (wA + M.l + M.r) + ' ' + (ESC_ALTO + M.t + M.b) });
      var X = function (x) { return M.l + x * s; };
      A.appendChild(rect(X(0), Y(G.cuerpo), wA, ESC_ALTO, 'vs-cuerpo'));
      A.appendChild(rect(X(G.esp), Y(G.cuerpo - G.esp), G.ancho * s, G.alto * s, 'vs-caja'));
      F.zonas.forEach(function (zn) {
        zn.cajas.forEach(function (c) {
          A.appendChild(rect(X(c.x0), Y(c.z1), (c.x1 - c.x0) * s, (c.z1 - c.z0) * s, 'vs-cajon'));
        });
      });
      if (G.on) {
        // cotas de los espacios (interior)
        var zb = G.esp;
        G.espacios.forEach(function (e, j) {
          var y1 = Y(zb), y0 = Y(zb + e);
          A.appendChild(svg('line', { 'class': 'vs-cota', x1: M.l - 10, y1: y0, x2: M.l - 10, y2: y1 }));
          A.appendChild(svg('text', { 'class': 'vs-cota-txt' + (G.crudos[j] > 0 ? ' is-fijo' : ''),
                                      x: M.l - 14, y: (y0 + y1) / 2 + 4, 'text-anchor': 'end' }, fmt(e)));
          zb += e + (j < G.n ? G.esp : 0);
        });
        G.repisas.forEach(function (r) {
          var il = r.lateralIzq > 0 ? Math.max(2, r.lateralIzq * s) : 0;
          var id = r.lateralDer > 0 ? Math.max(2, r.lateralDer * s) : 0;
          var g = svg('g', { 'class': 'vs-repisa' + (r.divisor ? ' is-div' : '') + (chocan[r.i] ? ' is-choque' : ''), 'data-i': r.i });
          var y = Y(r.zCuerpo + G.esp);
          g.appendChild(rect(X(G.esp), y - 6, G.ancho * s, tPx + 12, 'vs-hit'));
          g.appendChild(rect(X(G.esp) + il, y, G.ancho * s - il - id, tPx, 'vs-tabla', { rx: 1.5 }));
          g.appendChild(svg('title', {}, (r.divisor ? 'Divisor ' : 'Entrepaño ') + (r.i + 1) +
                            ' · arrastra para mover · clic para cambiar a ' + (r.divisor ? 'entrepaño' : 'divisor')));
          g.addEventListener('pointerdown', function (ev) { empezar(ev, 'alto', r.i, A); });
          A.appendChild(g);
        });
      }
      // frentes al final, encima de todo pero sin estorbar (punteado fino)
      F.zonas.forEach(function (zn) {
        zn.frentes.forEach(function (fr) {
          A.appendChild(rect(X(fr.x0), Y(fr.z1), (fr.x1 - fr.x0) * s, (fr.z1 - fr.z0) * s, 'vs-frente-out'));
          A.appendChild(svg('text', { 'class': 'vs-frente-txt', x: X(fr.x0) + 4, y: Y(fr.z1) + 11 },
                            fr.tipo === 'puerta' ? 'P' : 'C' + fr.n));
        });
      });
      A.appendChild(svg('text', { 'class': 'vs-titulo', x: M.l + wA / 2, y: ESC_ALTO + M.t + 17, 'text-anchor': 'middle' },
                        'Frente · ' + fmt(anchoC) + ' × ' + fmt(G.cuerpo) + ' mm'));

      // ===== Corte lateral ===================================================
      // y = 0 en la cara frontal del cuerpo, creciendo hacia el fondo; el frente
      // queda a la derecha y sobresale el espesor de puerta.
      var salida = F.espPuerta;          // los frentes de cajón siempre van por fuera
      var wC = (G.fondoCuerpo + salida) * s;
      var C = svg('svg', { 'class': 'visual__svg', width: wC + M.l + M.r, height: ESC_ALTO + M.t + M.b,
                           viewBox: '0 0 ' + (wC + M.l + M.r) + ' ' + (ESC_ALTO + M.t + M.b) });
      var XF = M.l + G.fondoCuerpo * s;                     // cara frontal del cuerpo
      var XC = function (y) { return XF - y * s; };
      C.appendChild(rect(M.l, Y(G.cuerpo), G.fondoCuerpo * s, ESC_ALTO, 'vs-cuerpo'));
      C.appendChild(rect(XC(G.fondoCuerpo - G.reserva), Y(G.cuerpo - G.esp), (G.fondoCuerpo - G.reserva) * s, G.alto * s, 'vs-caja'));
      if (G.reserva > 0) {
        C.appendChild(rect(M.l, Y(G.cuerpo - G.esp), G.reserva * s, G.alto * s, 'vs-fondo'));
      }
      F.zonas.forEach(function (zn) {
        zn.cajas.forEach(function (c) {
          C.appendChild(rect(XC(c.y1), Y(c.z1), (c.y1 - c.y0) * s, (c.z1 - c.z0) * s, 'vs-cajon'));
        });
      });
      if (G.on) {
        G.repisas.forEach(function (r) {
          var y = Y(r.zCuerpo + G.esp);
          var xa = XC(G.fondoCuerpo - G.reserva), xb = XC(r.retiro);
          var g = svg('g', { 'class': 'vs-repisa' + (r.divisor ? ' is-div' : '') + (chocan[r.i] ? ' is-choque' : ''), 'data-i': r.i });
          g.appendChild(rect(xa, y, Math.max(4, xb - xa), tPx, 'vs-tabla', { rx: 1.5 }));
          g.appendChild(svg('title', {}, (r.divisor ? 'Divisor ' : 'Entrepaño ') + (r.i + 1) + ' · ' + fmt(r.profundidad) +
                            ' mm de fondo · clic para cambiar a ' + (r.divisor ? 'entrepaño' : 'divisor')));
          g.addEventListener('click', function () { if (!drag || !drag.movio) alternarTipo(r.i); });
          C.appendChild(g);
          var h = svg('g', { 'class': 'vs-tirador', 'data-i': r.i });
          h.appendChild(rect(xb - 8, y - 6, 16, tPx + 12, 'vs-hit'));
          h.appendChild(svg('circle', { cx: xb, cy: y + tPx / 2, r: 4.5 }));
          h.appendChild(svg('title', {}, 'Arrastra para cambiar el retiro del frente (en 0 es divisor)'));
          h.addEventListener('pointerdown', function (ev) { empezar(ev, 'retiro', r.i, C); });
          C.appendChild(h);
          if (!r.divisor) {
            C.appendChild(svg('text', { 'class': 'vs-retiro', x: xb - 7, y: y - 3, 'text-anchor': 'end' },
                              (r.formula ? 'ƒ ' : '') + fmt(r.retiro)));
          }
        });
      }
      F.zonas.forEach(function (zn) {
        zn.frentes.forEach(function (fr) {
          var x0 = fr.interior ? XC(F.espPuerta) : XF;
          C.appendChild(rect(x0, Y(fr.z1), F.espPuerta * s, (fr.z1 - fr.z0) * s, 'vs-frente-out'));
        });
      });
      C.appendChild(svg('text', { 'class': 'vs-titulo', x: M.l + wC / 2, y: ESC_ALTO + M.t + 17, 'text-anchor': 'middle' },
                        'Lado · fondo ' + fmt(G.fondoCuerpo) + ' mm · frente →'));

      vistas.appendChild(A); vistas.appendChild(C);

      var msg = G.on
        ? 'Interior ' + fmt(G.ancho) + ' × ' + fmt(G.alto) + ' × ' + fmt(G.prof) + ' mm · repisas de ' + fmt(G.esp) + ' mm · ' +
          (G.personal ? 'altos personalizados (los vacíos se reparten el resto)' : 'separaciones iguales') +
          ' · ƒ = retiro por fórmula (' + fmt(G.retiroFormula) + ' mm)'
        : 'Activa «Entrepaño: Sí» para acomodar repisas. Los frentes y cajones se dibujan como referencia.';
      if (G.exceso > 1) msg += ' — se pasan ' + fmt(G.exceso) + ' mm';
      if (choques.length) msg += ' — ' + choques.length + (choques.length === 1 ? ' choque' : ' choques') + ' (en rojo)';
      pie.textContent = msg;
      pie.classList.toggle('is-bad', G.exceso > 1 || choques.length > 0);

      wrap.__geom = { G: G, s: s, XF: XF };
    }

    function alternarTipo(i) {
      var f = campo(V.retiros[i]);
      if (!f || !fieldEnabled(f, manifest, registro.valores)) return;
      var G = wrap.__geom.G, r = G.repisas[i];
      setRetiro(i, r && r.divisor ? null : 0);   // divisor → entrepaño (fórmula), si no → divisor
      cambio();
    }

    function empezar(ev, modo, i, lienzo) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      var r = lienzo.getBoundingClientRect();
      drag = { modo: modo, i: i, x0: ev.clientX, y0: ev.clientY, left: r.left, movio: false, base: wrap.__geom };
      // Se fijan TODOS los espacios en su medida actual: mover una repisa no
      // hace saltar a las demás. El de arriba queda vacío (toma el resto).
      if (modo === 'alto') drag.espacios = drag.base.G.espacios.slice();
      // La captura mantiene el arrastre aunque el puntero salga del dibujo; si
      // el navegador la rechaza, el arrastre sigue funcionando dentro del widget.
      try { if (wrap.setPointerCapture) wrap.setPointerCapture(ev.pointerId); } catch (e) {}
    }

    wrap.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
      if (!drag.movio && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      drag.movio = true;
      var B = drag.base, G = B.G, s = B.s;
      if (drag.modo === 'alto') {
        var i = drag.i, e = drag.espacios.slice();
        var minEsp = 10;
        var abajo = Math.round(e[i] - dy / s), arriba = e[i] + e[i + 1] - abajo;
        if (abajo < minEsp) { arriba -= (minEsp - abajo); abajo = minEsp; }
        if (arriba < minEsp) { abajo -= (minEsp - arriba); arriba = minEsp; }
        e[i] = abajo; e[i + 1] = arriba;
        setValor(V.modo, V.modo_personalizado);
        for (var j = 0; j < G.n; j++) setValor(V.espacios[j], Math.round(e[j]));
        setValor(V.espacios[G.n], '');                       // el de arriba toma el resto
      } else {
        var retiro = Math.round((B.XF - (ev.clientX - drag.left)) / s);
        retiro = Math.max(0, Math.min(Math.round(G.prof - 50), retiro));
        setRetiro(drag.i, retiro);                            // 0 = «Divisor»
      }
      cambio();
    });

    function terminar(ev) {
      if (!drag) return;
      var d = drag;
      if (wrap.releasePointerCapture && ev && ev.pointerId != null) {
        try { wrap.releasePointerCapture(ev.pointerId); } catch (e) {}
      }
      // Sin movimiento sobre una repisa del alzado = clic: alterna el tipo.
      if (!d.movio && d.modo === 'alto') alternarTipo(d.i);
      setTimeout(function () { drag = null; }, 0);
    }
    wrap.addEventListener('pointerup', terminar);
    wrap.addEventListener('pointercancel', terminar);

    wrap.__refresh = pintar;
    pintar();
    return wrap;
  }

  function renderField(field, manifest, registro, corto) {
    // `data-field-id` es el único enlace DOM↔manifiesto: updateConditionals()
    // resuelve visible_si/habilitado_si leyendo el manifiesto, no el dataset.
    var wrap = el('div', 'field' + (field.requerido ? ' is-required' : ''));
    wrap.dataset.fieldId = field.id;
    // `columna` fija la columna del grid: deja «a la par» campos que van juntos
    // (repisa N a la izquierda, su espacio a la derecha), aunque otros se oculten.
    if (field.columna) wrap.style.gridColumn = String(field.columna);

    // Dentro del editor de caja la posición ya dice de qué margen se trata.
    var texto = (corto && field.label_corto) ? field.label_corto : field.label;
    var label = el('label', 'field__label', texto);
    wrap.appendChild(label);

    var control;
    switch (field.tipo) {
      case 'select':   control = ctrlSelect(field, registro); break;
      case 'preset':   control = ctrlPreset(field, manifest, registro); break;
      case 'derivado': control = ctrlStepper(field, manifest, registro); break;
      default:         control = ctrlNumber(field, registro);
    }
    wrap.appendChild(control);

    if (field.habilitado_si && field.habilitado_si.mensaje) {
      var hh = el('span', 'field__hint field__hint--cond', field.habilitado_si.mensaje);
      hh.dataset.hintHabilitado = '1';
      wrap.appendChild(hh);
    }
    if (field.forzar) {
      // El motivo depende de qué entrada de `forzar` aplicó: lo rellena
      // updateConditionals(), igual que el total de la suma.
      var hf = el('span', 'field__hint field__hint--cond');
      hf.dataset.hintForzar = '1';
      wrap.appendChild(hf);
    }
    if (field.nota) wrap.appendChild(el('span', 'field__hint', field.nota));
    // El campo captura la medida del cuerpo: sin este total la suma declarada en
    // el manifiesto sería invisible y parecería que el plugin ignora lo escrito.
    // updateConditionals() lo rellena, igual que el resumen del presupuesto.
    if (field.suma) {
      var tot = el('span', 'field__hint');
      tot.dataset.hintSuma = '1';
      tot.hidden = true;
      wrap.appendChild(tot);
    }
    return wrap;
  }

  function refrescarHintSuma(wrap, field, manifest, valores) {
    var span = wrap.querySelector('[data-hint-suma]');
    if (!span) return;
    var total = parseMm(effectiveValue(field, valores, manifest));
    var hay   = sumaExtra(manifest, field, valores) > 0 && !isNaN(total);
    span.hidden = !hay;
    span.textContent = hay ? 'Total en SketchUp: ' + fmt(total) + ' mm' : '';
  }

  function onValueChange(manifest, registro) {
    updateConditionals(manifest, registro);
    // refresca meta/estado (auto-nombre no se pisa si el usuario ya lo editó)
    refrescarAutoNombre(manifest, registro);
    registro.estado = 'borrador';
    registro.error  = null;   // tocar el módulo invalida el fallo anterior
    renderSidebar();
  }

  function ctrlNumber(field, registro) {
    var control = el('div', 'control' + (field.unidad ? ' control--unit' : ''));
    var input = el('input', 'input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = registro.valores[field.id] != null ? registro.valores[field.id] : '';
    // Un ejemplo en la unidad del campo dice más que la palabra «Automático».
    input.placeholder = field.placeholder || (field.auto ? 'Automático' : '');
    input.addEventListener('input', function () {
      registro.valores[field.id] = input.value.trim();
      onValueChange(findManifest(registro.familia), registro);
    });
    control.appendChild(input);
    if (field.unidad) control.appendChild(el('span', 'control__unit', field.unidad));
    return control;
  }

  function ctrlSelect(field, registro) {
    var control = el('div', 'control');
    var sel = el('select', 'select');
    field.opciones.forEach(function (o) {
      var opt = el('option', null, o.label);
      opt.value = o.valor;
      sel.appendChild(opt);
    });
    sel.value = registro.valores[field.id] != null ? registro.valores[field.id] : '';
    sel.addEventListener('change', function () {
      registro.valores[field.id] = sel.value;
      onValueChange(findManifest(registro.familia), registro);
    });
    control.appendChild(sel);
    return control;
  }

  /* Si el preset está en «Personalizado» con una medida igual a la de un preset
     de medida fija, cambia a ese preset. Devuelve true si cambió algo. */
  function normalizarPreset(field, valores) {
    if (valores[field.id] !== '__custom__') return false;
    var mm = parseMm(String(valores[field.id + '::custom'] || '') + (field.unidad || ''));
    if (isNaN(mm)) return false;
    var hit = (field.presets || []).filter(function (p) {
      var pm = parseMm(p.valor);
      return p.valor !== '' && !isNaN(pm) && Math.abs(pm - mm) < 0.05;
    })[0];
    if (!hit) return false;
    valores[field.id] = hit.valor;
    valores[field.id + '::custom'] = '';
    return true;
  }

  function ctrlPreset(field, manifest, registro) {
    var box = el('div', 'preset');
    var sel = el('select', 'select');
    field.presets.forEach(function (p) {
      var opt = el('option', null, p.label);
      opt.value = p.valor;
      sel.appendChild(opt);
    });
    if (field.permite_personalizado) {
      var optC = el('option', null, 'Personalizado…');
      optC.value = '__custom__';
      sel.appendChild(optC);
    }
    sel.value = registro.valores[field.id] != null ? registro.valores[field.id] : (field.presets[0] ? field.presets[0].valor : '');

    var custom = el('div', 'control control--unit preset__custom');
    var input = el('input', 'input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.placeholder = 'Medida';
    input.value = registro.valores[field.id + '::custom'] || '';
    if (field.unidad) custom.appendChild(input);
    if (field.unidad) custom.appendChild(el('span', 'control__unit', field.unidad));

    function sync() { box.classList.toggle('is-custom', sel.value === '__custom__'); }
    sel.addEventListener('change', function () {
      registro.valores[field.id] = sel.value;
      sync();
      onValueChange(findManifest(registro.familia), registro);
    });
    input.addEventListener('input', function () {
      registro.valores[field.id + '::custom'] = input.value.trim();
      onValueChange(findManifest(registro.familia), registro);
    });
    // Al salir del campo, una medida que coincide con un preset se vuelve ese
    // preset (0 mm en un retiro = «Divisor»): la lista dice lo que hay.
    input.addEventListener('change', function () {
      if (normalizarPreset(field, registro.valores)) {
        box.__sync();
        onValueChange(findManifest(registro.familia), registro);
      }
    });

    // Lo usa el gráfico de entrepaños cuando escribe en este campo.
    box.__sync = function () {
      sel.value = registro.valores[field.id] != null ? registro.valores[field.id] : '';
      if (document.activeElement !== input) input.value = registro.valores[field.id + '::custom'] || '';
      sync();
    };

    /* Deja de ofrecer los presets que ya no caben en el espacio restante. Lo
       llama updateConditionals() en cada cambio del formulario, igual que el
       tope del contador. «Automático», «Personalizado…» y la opción que está
       seleccionada nunca se ocultan: el select no debe saltar solo — si lo
       elegido dejó de caber, quien avisa es el presupuesto en rojo. */
    box.__refreshOptions = function () {
      var lim = limiteAltoCajon(manifest, registro.valores, field.attr);
      if (!isFinite(lim)) return;
      Array.prototype.forEach.call(sel.options, function (o) {
        if (o.value === '' || o.value === '__custom__' || o.value === sel.value) {
          o.hidden = false; o.disabled = false;
          return;
        }
        var mm = parseMm(o.value);
        var fuera = !isNaN(mm) && mm > lim + 0.5;   // 0.5 mm de tolerancia
        o.hidden = fuera;
        o.disabled = fuera;
      });
    };

    box.appendChild(sel);
    box.appendChild(custom);
    sync();
    box.__refreshOptions();
    return box;
  }

  function ctrlStepper(field, manifest, registro) {
    var min = field.min || 0;
    var step = el('div', 'stepper');
    var less = el('button', null, '−'); less.type = 'button';
    var val = el('div', 'stepper__val');
    var more = el('button', null, '+'); more.type = 'button';

    /* Tope efectivo: el del manifiesto, acotado por lo que físicamente cabe
       cuando el campo declara `max_regla` (evita el error 1 desde la captura). */
    function maxEfectivo() {
      var max = field.max || 99;
      // `max_regla: "cajones:<pila>"` topa el contador con lo que cabe en esa zona.
      var mr = /^cajones:(.+)$/.exec(field.max_regla || '');
      if (mr) {
        var p = presupuestoCajones(manifest, registro.valores, mr[1]);
        if (p.aplica && isFinite(p.nMax)) max = Math.min(max, Math.max(min, p.nMax));
      }
      return max;
    }

    function get() { return parseInt(registro.valores[field.id], 10) || min; }
    function pintar() {
      var n = get(), max = maxEfectivo();
      val.textContent = String(n);
      less.disabled = n <= min;
      more.disabled = n >= max;
    }
    function set(n) {
      registro.valores[field.id] = String(Math.max(min, Math.min(maxEfectivo(), n)));
      pintar();
      // Actualiza sobre el DOM existente (visibilidad de subcampos) sin re-render
      // completo, que perdería el foco y el estado colapsado de los grupos.
      onValueChange(findManifest(registro.familia), registro);
    }
    less.addEventListener('click', function () { set(get() - 1); });
    more.addEventListener('click', function () { set(get() + 1); });

    // Lo llama updateConditionals(): el tope depende de otros campos (alto,
    // zócalo, separación), así que se recalcula en cada cambio del formulario.
    step.__refreshLimits = pintar;
    pintar();

    step.appendChild(less); step.appendChild(val); step.appendChild(more);
    return step;
  }

  /* Pinta los resúmenes de los grupos con `presupuesto`. El de cajones bloquea
     (rojo) y el de divisores solo advierte (ámbar), igual que R-14/R-17. */
  function refreshBudget(manifest, valores) {
    // Un resumen por pila: el grupo declara `presupuesto: "cajones:<pila>"`.
    Array.prototype.forEach.call(document.querySelectorAll('.budget[data-budget^="cajones:"]'), function (box) {
      var p = presupuestoCajones(manifest, valores, box.dataset.budget.slice('cajones:'.length));
      box.hidden = !p.aplica;
      if (!p.aplica) return;
      box.classList.toggle('budget--bad', !p.ok);
      box.classList.remove('budget--warn');
      var partes = [
        'Alto de la zona ' + fmt(p.zona) + ' mm',
        p.n + (p.n === 1 ? ' cajón' : ' cajones' + (p.personal ? '' : ' iguales')),
        p.n === 1 ? fmt(p.ultimo) + ' mm'
                  : 'altos ' + p.altos.map(fmt).join(' / ') + ' mm' + (p.personal ? ' (el último toma el resto)' : '')
      ];
      box.textContent = partes.join(' · ') + (p.ok ? '' : ' — ' + p.mensaje);
    });

    var caja = document.querySelector('.budget[data-budget="divisores"]');
    if (!caja) return;
    var d = presupuestoDivisores(manifest, valores);
    caja.hidden = !d.aplica;
    if (!d.aplica) return;
    caja.classList.toggle('budget--warn', !d.ok);
    caja.textContent = 'Alto interior ' + fmt(d.util) + ' mm · ' + d.n +
      (d.n === 1 ? ' espacio' : ' espacios') + ' · asignado ' + fmt(d.suma) + ' mm' +
      (d.ok ? '' : ' — se pasan ' + fmt(d.exceso) + ' mm del alto interior; se genera igual.');
  }

  /* Panel de errores del editor: la lista de lo que impide generar. Vive arriba
     del formulario porque el botón «Generar» queda apagado y sin la lista no se
     sabría por qué. */
  function refreshErrores(manifest, registro) {
    var cont = $('#form-errores');
    if (!cont) return;
    var errs   = erroresConfig(manifest, registro.valores);
    var avisos = avisosConfig(manifest, registro.valores);

    var malos = {};
    errs.forEach(function (e) { (e.ids || []).forEach(function (id) { malos[id] = true; }); });
    Array.prototype.forEach.call(document.querySelectorAll('.field[data-field-id]'), function (w) {
      w.classList.toggle('is-bad', !!malos[w.dataset.fieldId]);
    });

    var lineas = problemasRegistro(registro);
    cont.hidden = lineas.length === 0 && avisos.length === 0;
    cont.classList.toggle('budget--bad', lineas.length > 0);
    cont.classList.toggle('budget--warn', lineas.length === 0 && avisos.length > 0);
    cont.textContent = lineas.length
      ? 'No se puede generar:\n· ' + lineas.join('\n· ')
      : (avisos.length ? 'Avisos:\n· ' + avisos.join('\n· ') : '');
    return lineas.length;
  }

  /* «Generar» solo se puede pulsar con una configuración válida (R-31). */
  function refrescarGenerar() {
    var btn = $('#btn-generar');
    if (!btn) return;
    var r = activeRegistro();
    var malo = !r || !findManifest(r.familia) || problemasRegistro(r).length > 0;
    btn.disabled = !!state.lote || malo;
    btn.title = malo ? 'Hay datos por corregir; la lista está arriba del formulario.' : '';
  }

  /* Recorre el DOM aplicando visible_si, habilitado_si y condicion de grupo. */
  function updateConditionals(manifest, registro) {
    var valores = registro.valores;
    // Primero lo impuesto por el manifiesto: lo demás se resuelve leyendo
    // `valores`, así que el forzado tiene que estar puesto antes de mirar nada.
    aplicarForzados(manifest, valores);

    // grupos condicionales
    manifest.grupos.forEach(function (g) {
      if (!g.condicion) return;
      var sec = document.querySelector('.group[data-group="' + g.id + '"]');
      if (sec) sec.classList.toggle('is-disabled', !groupEnabled(g, manifest, valores));
    });

    // Topes dinámicos de los contadores primero: el presupuesto de abajo se
    // dibuja ya con el valor topado.
    Array.prototype.forEach.call(document.querySelectorAll('.stepper'), function (s) {
      if (typeof s.__refreshLimits === 'function') s.__refreshLimits();
    });
    // Presets que ya no caben: se dejan de ofrecer conforme se asignan altos.
    Array.prototype.forEach.call(document.querySelectorAll('.preset'), function (p) {
      if (typeof p.__refreshOptions === 'function') p.__refreshOptions();
    });

    // Visibilidad y habilitación se resuelven desde el manifiesto (una sola
    // implementación de cada predicado, compartida con flatten()).
    manifest.grupos.forEach(function (g) {
      g.campos.forEach(function (f) {
        var wrap = document.querySelector('.field[data-field-id="' + f.id + '"]');
        if (!wrap) return;
        if (f.visible_si) wrap.hidden = !fieldVisible(f, manifest, valores);
        if (f.suma) refrescarHintSuma(wrap, f, manifest, valores);
        var forz = valorForzado(f, manifest, valores);
        if (forz != null) {
          // El control tiene que MOSTRAR lo que se va a inyectar, no lo último
          // que se eligió a mano antes de que la otra opción lo decidiera.
          Array.prototype.forEach.call(wrap.querySelectorAll('input, select'), function (ctrl) {
            ctrl.value = forz;
          });
          var hf = wrap.querySelector('[data-hint-forzar]');
          if (hf) {
            var ent = (f.forzar || []).filter(function (e) { return e.valor === forz; })[0];
            hf.textContent = (ent && ent.mensaje) || '';
          }
        }
        // Apagado solo por un forzado: el motivo es el del forzado, no la
        // condición de habilitación (que sí se cumple).
        var hh = wrap.querySelector('[data-hint-habilitado]');
        if (hh) hh.hidden = forz != null && condicionCumple(manifest, valores, f.habilitado_si);
        var hfz = wrap.querySelector('[data-hint-forzar]');
        if (hfz) hfz.hidden = forz == null;
        if (f.habilitado_si || f.forzar) {
          var on = fieldEnabled(f, manifest, valores);
          wrap.classList.toggle('is-disabled', !on);
          // Solo input/select: los botones del stepper gestionan su propio disabled
          // por min/max; la clase .is-disabled (pointer-events:none) bloquea su clic.
          Array.prototype.forEach.call(wrap.querySelectorAll('input, select'), function (ctrl) {
            ctrl.disabled = !on;
          });
        }
      });
    });

    refreshBudget(manifest, valores);
    Array.prototype.forEach.call(document.querySelectorAll('.visual'), function (v) {
      if (typeof v.__refresh === 'function') v.__refresh();
    });
    refreshErrores(manifest, registro);
    refrescarGenerar();
  }

  // =========================================================================
  //  Acciones
  // =========================================================================
  function showPane(which) {
    $('#pane-empty').hidden  = which !== 'empty';
    $('#pane-editor').hidden = which !== 'editor';
    $('#pane-import').hidden = which !== 'import';
  }

  function openFamiliaModal() { $('#modal-familia').hidden = false; }
  function closeFamiliaModal() { $('#modal-familia').hidden = true; }

  function renderFamilias() {
    var grid = $('#familias-grid');
    grid.innerHTML = '';
    state.familias.forEach(function (fam) {
      var card = el('div', 'fam-card' + (fam.activo ? '' : ' is-disabled'));
      card.appendChild(el('div', 'fam-card__icon', ICONOS[fam.id] || '•'));
      card.appendChild(el('div', 'fam-card__name', fam.titulo));
      if (!fam.activo) card.appendChild(el('span', 'fam-card__badge', 'Próximamente'));
      if (fam.activo) card.addEventListener('click', function () { crearRegistro(fam); });
      grid.appendChild(card);
    });
  }

  function crearRegistro(fam) {
    closeFamiliaModal();
    var manifest = findManifest(fam.id);
    if (!manifest) {
      // crea el registro y espera el manifest para sembrar defaults
      var idTmp = 'r' + (state.seq++);
      state.registros.push({ id: idTmp, familia: fam.id, titulo: fam.titulo, nombre_salida: '', valores: null, estado: 'borrador' });
      state.activeId = idTmp;
      requestManifest(fam.id, idTmp);
      renderSidebar();
      return;
    }
    finalizeRegistro(fam, manifest);
  }

  function finalizeRegistro(fam, manifest) {
    var id = 'r' + (state.seq++);
    var valores = defaultValores(manifest);
    var reg = {
      id: id, familia: fam.id, titulo: fam.titulo,
      valores: valores, estado: 'borrador', nombre_salida: ''
    };
    reg.nombre_salida = nombreUnico(autoNombre(manifest, valores), id);
    state.registros.push(reg);
    state.activeId = id;
    renderSidebar();
    renderEditor();
  }

  function selectRegistro(id) {
    state.activeId = id;
    renderSidebar();
    renderEditor();
  }

  function deleteRegistro(id) {
    state.registros = state.registros.filter(function (r) { return r.id !== id; });
    if (state.activeId === id) state.activeId = state.registros.length ? state.registros[0].id : null;
    renderSidebar();
    renderEditor();
  }

  function clonarActivo() {
    var r = activeRegistro();
    if (!r) return;
    var id = 'r' + (state.seq++);
    var copia = {
      id: id, familia: r.familia, titulo: r.titulo,
      valores: JSON.parse(JSON.stringify(r.valores)),
      estado: 'borrador', nombreManual: true,
      nombre_salida: nombreUnico((r.nombre_salida || 'modulo') + '-copia', id)
    };
    state.registros.push(copia);
    state.activeId = id;
    renderSidebar();
    renderEditor();
    toast('ok', 'Módulo clonado', copia.nombre_salida);
  }

  /* Aplana el registro activo a { attr: valorEfectivo } respetando visibilidad. */
  function flatten(manifest, registro) {
    var flat = {};
    aplicarForzados(manifest, registro.valores);
    manifest.grupos.forEach(function (g) {
      if (!groupEnabled(g, manifest, registro.valores)) return;
      g.campos.forEach(function (f) {
        if (!fieldInyecta(f, manifest, registro.valores)) return;
        var v = effectiveValue(f, registro.valores, manifest);
        // `vacio`: lo que se inyecta cuando el campo se deja en blanco. Un espacio
        // entre repisas vacío significa «reparto automático» y el componente lo
        // espera en 0; sin escribirlo, el .skp conservaría su valor anterior.
        if ((v === '' || v == null) && f.vacio != null) {
          flat[f.attr] = f.vacio;
          return;
        }
        if (v === '' || v == null) {
          // Un preset vacío («Entrepaño») puede traer su propia fórmula: se
          // inyecta explícita para no depender de que el componente base la
          // conserve intacta.
          if (f.tipo === 'preset') {
            var opt = buscarOpcion(f.presets, v);
            if (opt && opt.formula) flat[f.attr] = '=' + opt.formula;
          }
          return;
        }
        flat[f.attr] = v;   // duplicados de attr: gana el último (quirk conocido de la definición)
      });
    });
    return flat;
  }

  /* Nombre de la pieza de cada división, resuelto desde el MODO elegido en el
     desplegable del margen frontal. No se compara la medida contra 0: el dato
     explícito ya existe, y un margen personalizado de 0 mm sigue siendo
     entrepaño. Se resuelve una sola vez, aquí, y el motor solo aplica la lista
     (índice 0 = división 1 = la de más abajo). El mapeo modo→nombre vive en
     reglas_divisores del manifiesto, amarrado a los mismos valores de preset. */
  function nombresDivisores(manifest, registro) {
    var R = manifest.reglas_divisores;
    if (!R) return null;
    // Con la sección apagada («Entrepaño: No», o puerta de cajones) no hay
    // divisiones que nombrar: no se manda ninguna instrucción.
    if (!attrActivo(manifest, registro.valores, R.attr_cantidad)) return null;
    var n = attrNumber(manifest, registro.valores, R.attr_cantidad);
    if (isNaN(n) || n < 1) return null;

    var mapa = R.nombres_por_modo || {};
    var nombres = [];
    for (var i = 1; i <= n; i++) {
      // Sin `attr_modo` (Esquinero) no hay modo que elegir: van todas al default.
      var f = R.attr_modo ? fieldByAttr(manifest, R.attr_modo.replace('{i}', i)) : null;
      // Campo ausente, oculto o deshabilitado: no hay modo elegido, va el default.
      var modo = (f && fieldVisible(f, manifest, registro.valores) &&
                       fieldEnabled(f, manifest, registro.valores))
        ? registro.valores[f.id] : null;
      nombres.push(Object.prototype.hasOwnProperty.call(mapa, modo) ? mapa[modo] : R.nombre_default);
    }
    return { prefijo: R.prefijo, nombres: nombres };
  }

  /* Manda UN registro a generar. Devuelve { ok } o { ok:false, titulo, error }
     sin depender del registro activo ni del input del nombre, para que el lote
     no cambie de resultado según qué módulo esté abierto.

     Los dos toggles sí se leen del DOM: «Insertar en escena» y «Limpiar piezas
     ocultas» son estado de SESIÓN, no del registro (nunca se guardaron en él),
     así que el lote aplica los mismos que el botón individual. */
  function generarRegistro(r) {
    if (!state.rootValido) {
      return { ok: false, titulo: 'Falta configurar la carpeta',
               error: 'Selecciona la carpeta del proyecto (contiene «Main Components»).' };
    }
    var manifest = findManifest(r.familia);
    if (!manifest) {
      return { ok: false, titulo: 'Falta el manifiesto', error: 'No se cargó el manifiesto de ' + r.titulo + '.' };
    }
    // Una sola capa de validación para los tres caminos (R-31/R-32): lo que el
    // formulario rechaza también lo rechazan el lote y la importación. Incluye
    // el presupuesto de cajones, que es lo que evita que la pila traspase el
    // mueble cuando el componente recorta sin piso.
    var problemas = problemasRegistro(r);
    if (problemas.length) {
      return { ok: false, titulo: 'Configuración inválida', error: problemas.join('\n') };
    }

    // Repetir un nombre numera (-2, -3) en vez de sobrescribir el .skp anterior.
    r.nombre_salida = nombreUnico((r.nombre_salida || 'modulo').trim(), r.id);
    var payload = {
      // Vuelve en la respuesta: en lote el registro activo no es el que se generó.
      registro_id: r.id,
      familia: r.familia,
      nombre_salida: r.nombre_salida,
      insertar_en_escena: $('#toggle-escena').checked,
      limpiar_ocultos: $('#toggle-limpiar').checked,
      valores: flatten(manifest, r)
    };
    // Fuera de `valores`: no es un atributo del componente, es una instrucción
    // de nombrado para el motor.
    var div = nombresDivisores(manifest, r);
    if (div) payload.divisores = div;
    SU.generar(JSON.stringify(payload));
    return { ok: true };
  }

  function generar() {
    var r = activeRegistro();
    if (!r || state.lote) return;
    // Mientras el editor está abierto, el input manda sobre el registro.
    r.nombre_salida = ($('#nombre-salida').value || r.nombre_salida || 'modulo').trim();

    var res = generarRegistro(r);
    if (!res.ok) { toast('error', res.titulo, res.error); return; }
    $('#btn-generar').disabled = true;
    toast('warn', 'Generando…', r.nombre_salida);
  }

  function marcarError(r, mensaje) {
    r.estado = 'error';
    r.error  = mensaje || 'Error desconocido';
  }

  // =========================================================================
  //  Lote: «Generar todos»
  // -------------------------------------------------------------------------
  //  Estrictamente secuencial. El puente con Ruby es asíncrono y el cursor de
  //  auto-tiling (@cursor_x en main.rb) avanza por unidad: mandar N llamadas a
  //  la vez apilaría los muebles en el mismo punto. La cola se destraba en
  //  onGenerar, que es la única señal de que una unidad terminó.
  // =========================================================================

  /* Registros que no van a pasar la validación. El pre-vuelo corre TODAS las
     reglas, no solo el presupuesto de cajones (R-31): así el lote no da por
     buenos módulos sin medidas o con el nombre repetido. */
  function invalidosDelLote() {
    return state.registros.filter(function (r) { return problemasRegistro(r).length > 0; });
  }

  function generarTodos() {
    if (state.lote || !state.registros.length) return;
    if (!state.rootValido) {
      toast('error', 'Falta configurar la carpeta', 'Selecciona la carpeta del proyecto (contiene «Main Components»).');
      return;
    }

    var total = state.registros.length;
    var malos = invalidosDelLote().length;
    var cuerpo = 'Se generarán ' + total + (total === 1 ? ' módulo.' : ' módulos.') +
                 '\nLos que ya estaban generados se vuelven a guardar y sobrescriben su .skp.';
    if (malos) {
      cuerpo += '\n\n' + malos + (malos === 1 ? ' módulo no pasa' : ' módulos no pasan') +
                ' la validación: quedarán marcados con ✕ y el resto se genera igual.';
    }

    confirmar('Generar todos', cuerpo, function () {
      state.lote = {
        pendientes: state.registros.map(function (r) { return r.id; }),
        total: total, hechos: 0, ok: 0, fallos: 0, avisos: 0, cancelado: false
      };
      $('#btn-generar').disabled = true;
      siguienteDelLote();
    });
  }

  function siguienteDelLote() {
    var L = state.lote;
    if (!L) return;
    if (L.cancelado || !L.pendientes.length) { finLote(); return; }

    var id = L.pendientes.shift();
    var r  = state.registros.filter(function (x) { return x.id === id; })[0];
    if (!r) { L.hechos++; siguienteDelLote(); return; }   // lo borraron a media cola

    actualizarBotonLote(r.nombre_salida);
    var res = generarRegistro(r);
    if (res.ok) return;   // la cola sigue en onGenerar

    // El fallo es local: no llegó a Ruby, así que no vendrá respuesta y hay que
    // destrabar la cola aquí mismo.
    marcarError(r, res.error);
    L.hechos++; L.fallos++;
    renderSidebar();
    siguienteDelLote();
  }

  function finLote() {
    var L = state.lote;
    state.lote = null;
    refrescarGenerar();
    renderSidebar();
    if (!L) return;

    var partes = [L.ok + (L.ok === 1 ? ' generado' : ' generados')];
    if (L.fallos) partes.push(L.fallos + ' con error');
    if (L.avisos) partes.push(L.avisos + (L.avisos === 1 ? ' aviso' : ' avisos'));
    if (L.cancelado && L.pendientes.length) partes.push(L.pendientes.length + ' sin generar (cancelado)');
    toast(L.fallos ? 'warn' : 'ok', 'Lote terminado', partes.join(' · '));
  }

  /* El propio botón hace de indicador de progreso: no hay lugar en la barra
     lateral para una barra aparte y así el estado se ve donde se disparó. */
  function actualizarBotonLote(nombre) {
    var acciones = $('#lote-acciones');
    var btn      = $('#btn-generar-todos');
    var cancel   = $('#btn-cancelar-lote');
    if (!acciones) return;

    acciones.hidden = state.registros.length === 0;
    var L = state.lote;
    if (!L) {
      btn.disabled = false;
      btn.textContent = 'Generar todos (' + state.registros.length + ')';
      btn.title = '';
      cancel.hidden = true;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Generando ' + Math.min(L.hechos + 1, L.total) + '/' + L.total + '…';
    btn.title = nombre || btn.title;
    cancel.hidden = false;
    cancel.textContent = L.cancelado ? 'Cancelando…' : 'Cancelar';
  }

  // =========================================================================
  //  Importación — mapeo, validación y tabla de revisión
  // -------------------------------------------------------------------------
  //  Ruby entrega la tabla en crudo (encabezados + celdas de texto), el modelo
  //  de columnas de la plantilla y los tres manifiestos. Todo lo semántico se
  //  resuelve aquí reusando los mismos predicados del formulario
  //  (fieldVisible / fieldEnabled / parseMm / presupuestoCajones): son la única
  //  implementación de esas reglas y no deben tener un tercer espejo.
  // =========================================================================

  function normTexto(t) {
    return String(t == null ? '' : t).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function campoPorId(manifest, id) {
    return findField(manifest, function (f) { return f.id === id; });
  }

  function familiaPorTexto(modelo, t) {
    var n = normTexto(t), hit = null;
    modelo.familias.forEach(function (f) {
      if (!hit && (normTexto(f.titulo) === n || normTexto(f.id) === n)) hit = f.id;
    });
    return hit;
  }

  /* Encabezado -> columnas candidatas. Un encabezado de la plantilla identifica
     una columna exacta; uno crudo (`divisor>f03espacio1`, como el CSV viejo)
     puede corresponder a varias, y ahí decide la familia de cada fila. */
  function resolverHeader(modelo, header) {
    var n = normTexto(header);
    var exacta = null, porAttr = [];
    modelo.columnas.forEach(function (c) {
      if (!exacta && normTexto(c.header) === n) exacta = c;
      if (c.attr && c.attr === String(header).trim()) porAttr.push(c);
    });
    if (exacta) return [exacta];
    return porAttr.length ? porAttr : null;
  }

  function columnaParaFamilia(cands, familia) {
    var hit = null;
    cands.forEach(function (c) {
      if (hit) return;
      if (c.clase !== 'campo' || (familia && c.familias.indexOf(familia) >= 0)) hit = c;
    });
    return hit;
  }

  /* Texto de celda -> valor interno del formulario. */
  function convertirCelda(campo, texto) {
    var t = String(texto).trim();
    if (campo.tipo === 'select') {
      var o = buscarOpcion(campo.opciones, t);
      return o ? { valor: o.valor } : { error: 'Opción no válida.' };
    }
    if (campo.tipo === 'preset') {
      var p = buscarOpcion(campo.presets, t);
      if (p) return { valor: p.valor };
      if (!campo.permite_personalizado) return { error: 'Opción no válida.' };
      var n = numeroEnUnidad(t, campo.unidad);
      if (n === null) return { error: 'Escribe una opción de la lista o una medida.' };
      // Igual que en el formulario: «0» en un retiro es el preset «Divisor».
      var tmp = {}; tmp[campo.id] = '__custom__'; tmp[campo.id + '::custom'] = n;
      if (normalizarPreset(campo, tmp)) return { valor: tmp[campo.id] };
      return { valor: '__custom__', custom: n };
    }
    if (campo.tipo === 'derivado') {
      if (!/^-?\d+$/.test(t)) return { error: 'Debe ser un número entero.' };
      var v   = parseInt(t, 10);
      var min = campo.min != null ? campo.min : 0;
      var max = campo.max != null ? campo.max : 99;
      if (v < min || v > max) return { error: 'Fuera de rango (' + min + '–' + max + ').' };
      return { valor: String(v) };
    }
    var m = numeroEnUnidad(t, campo.unidad);
    return m === null ? { error: 'No es una medida válida.' } : { valor: m };
  }

  function buscarOpcion(lista, t) {
    var n = normTexto(t), hit = null;
    (lista || []).forEach(function (o) {
      if (hit) return;
      if (normTexto(o.label) === n || String(o.valor) === String(t).trim()) hit = o;
    });
    return hit;
  }

  /* El formulario guarda el número SIN unidad (la pone el campo al aplanar), así
     que una celda con unidad explícita («25cm») se convierte a la del campo. */
  function numeroEnUnidad(texto, unidad) {
    var mm = parseMm(texto);
    if (isNaN(mm)) return null;
    var v = unidad === 'cm' ? mm / 10 : (unidad === 'm' ? mm / 1000 : mm);
    return String(Math.round(v * 1000) / 1000);
  }

  // ---- Validación de una fila ---------------------------------------------
  function validarFila(f, imp) {
    f.errores = {};
    f.avisos  = [];
    f.error   = null;
    f.valores = null;

    var texto = function (i) { return i >= 0 ? String(f.celdas[i] == null ? '' : f.celdas[i]).trim() : ''; };

    f.familia = imp.idxFamilia >= 0 ? familiaPorTexto(imp.modelo, texto(imp.idxFamilia)) : null;
    if (!f.familia) {
      if (imp.idxFamilia >= 0) f.errores[imp.idxFamilia] = 'Familia desconocida.';
      else f.error = 'El archivo no trae columna «familia».';
    }

    f.nombre = texto(imp.idxNombre);
    if (imp.idxNombre < 0) {
      f.error = f.error || 'El archivo no trae columna «nombre_salida».';
    } else if (!f.nombre) {
      f.errores[imp.idxNombre] = 'Falta el nombre.';
    } else if (/[\\\/:*?"<>|]/.test(f.nombre)) {
      f.errores[imp.idxNombre] = 'Caracteres no válidos para un nombre de archivo.';
    } else if (imp.repetidos[normTexto(f.nombre)] > 1) {
      f.errores[imp.idxNombre] = 'Nombre repetido en el archivo.';
    } else if (nombreEnSesion(f.nombre)) {
      f.errores[imp.idxNombre] = 'Ya hay un módulo con ese nombre en la sesión.';
    }

    var manifest = f.familia ? findManifest(f.familia) : null;
    if (!manifest) { f.estado = 'error'; return; }

    var valores = defaultValores(manifest);
    imp.cols.forEach(function (c) {
      // familia y nombre_salida ya se consumieron arriba; no son campos del
      // manifiesto y avisar de ellas sería ruido en cada fila.
      if (c.indice === imp.idxFamilia || c.indice === imp.idxNombre) return;
      var t = texto(c.indice);
      if (t === '') return;
      var col = columnaParaFamilia(c.cands, f.familia);
      if (!col || col.clase !== 'campo') {
        f.avisos.push('«' + c.header + '» no aplica a ' + manifest.titulo + ': se ignora.');
        return;
      }
      var campo = campoPorId(manifest, col.ids[f.familia]);
      if (!campo) { f.avisos.push('«' + c.header + '» no existe en ' + manifest.titulo + ': se ignora.'); return; }
      var r = convertirCelda(campo, t);
      if (r.error) { f.errores[c.indice] = r.error; return; }
      valores[campo.id] = r.valor;
      if (r.custom != null) valores[campo.id + '::custom'] = r.custom;
    });
    f.valores = valores;

    // Errores: la MISMA capa que el formulario (R-32), ya con todos los valores
    // puestos. Se anclan a la celda cuando la columna existe; si no, al renglón.
    erroresConfig(manifest, valores).forEach(function (e) {
      var i = -1;
      (e.ids || []).forEach(function (id) { if (i < 0) i = indiceDeCampo(imp, f.familia, id); });
      if (i >= 0) f.errores[i] = f.errores[i] || e.msg;
      else f.error = f.error || (e.label ? e.label + ': ' + e.msg : e.msg);
    });

    // Dato capturado sobre un campo que la propia configuración apaga: no es un
    // error, pero conviene decir que no va a llegar al .skp.
    manifest.grupos.forEach(function (g) {
      var gOn = groupEnabled(g, manifest, valores);
      g.campos.forEach(function (campo) {
        var i = indiceDeCampo(imp, f.familia, campo.id);
        if (i < 0 || texto(i) === '') return;
        if (!gOn || !fieldInyecta(campo, manifest, valores)) {
          f.avisos.push('«' + campo.label + '» no aplica con esta configuración: se ignora.');
        }
      });
    });

    avisosConfig(manifest, valores).forEach(function (a) { f.avisos.push(a); });

    var hayErr = f.error || Object.keys(f.errores).length > 0;
    f.estado = hayErr ? 'error' : (f.avisos.length ? 'aviso' : 'ok');
  }

  function indiceDeCampo(imp, familia, campoId) {
    var idx = -1;
    imp.cols.forEach(function (c) {
      if (idx >= 0) return;
      var col = columnaParaFamilia(c.cands, familia);
      if (col && col.clase === 'campo' && col.ids[familia] === campoId) idx = c.indice;
    });
    return idx;
  }

  function nombreEnSesion(nombre) {
    var n = normTexto(nombre);
    return state.registros.some(function (r) { return normTexto(r.nombre_salida) === n; });
  }

  function recontarNombres(imp) {
    imp.repetidos = {};
    imp.filas.forEach(function (f) {
      var n = normTexto(f.celdas[imp.idxNombre]);
      if (n) imp.repetidos[n] = (imp.repetidos[n] || 0) + 1;
    });
  }

  function revalidarTodo(imp) {
    recontarNombres(imp);
    imp.filas.forEach(function (f) { validarFila(f, imp); });
  }

  // ---- Construcción desde la respuesta de Ruby -----------------------------
  function armarImportacion(res) {
    // Los manifiestos llegan con el archivo: así la tabla se puede validar de
    // inmediato aunque la sesión no haya abierto todavía esa familia.
    var mans = res.manifiestos || {};
    for (var fam in mans) {
      if (Object.prototype.hasOwnProperty.call(mans, fam)) state.manifests[fam] = mans[fam];
    }

    var imp = {
      modelo: res.modelo, ruta: res.ruta, cols: [], filas: [],
      desconocidos: [], idxFamilia: -1, idxNombre: -1, repetidos: {},
      truncado: !!res.truncado, maxFilas: res.max_filas
    };

    (res.headers || []).forEach(function (h, i) {
      if (String(h).trim() === '') return;
      var cands = resolverHeader(res.modelo, h);
      if (!cands) { imp.desconocidos.push(h); return; }
      if (cands[0].clase === 'familia') imp.idxFamilia = i;
      if (cands[0].clase === 'nombre')  imp.idxNombre  = i;
      imp.cols.push({ indice: i, header: String(h).trim(), cands: cands });
    });

    (res.filas || []).forEach(function (celdas) {
      imp.filas.push({ celdas: celdas.slice(), errores: {}, avisos: [], estado: 'ok' });
    });

    revalidarTodo(imp);
    state.importar = imp;
    renderImport();
  }

  // ---- Tabla ---------------------------------------------------------------
  function renderImport() {
    var imp = state.importar;
    if (!imp) { renderEditor(); return; }
    showPane('import');

    var tabla = $('#import-tabla');
    tabla.innerHTML = '';

    var thead = el('thead');
    var trh   = el('tr');
    trh.appendChild(el('th', null, ''));
    imp.cols.forEach(function (c) {
      var th = el('th', null, c.header);
      th.title = c.header;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    tabla.appendChild(thead);

    var tbody = el('tbody');
    imp.filas.forEach(function (f) { tbody.appendChild(filaImport(f, imp)); });
    tabla.appendChild(tbody);

    var avisos = [];
    if (imp.truncado) avisos.push('El archivo trae más de ' + imp.maxFilas + ' filas; solo se leyeron las primeras.');
    if (imp.desconocidos.length) {
      avisos.push('Columnas que no se reconocen y se ignoran: ' + imp.desconocidos.join(' · '));
    }
    var caja = $('#import-avisos');
    caja.hidden = avisos.length === 0;
    caja.textContent = avisos.join('\n');

    pintarValidacion(imp);
  }

  function filaImport(f, imp) {
    var tr = el('tr');
    f.__estado = el('td', 'celda-estado');
    tr.appendChild(f.__estado);
    f.__celdas = {};

    imp.cols.forEach(function (c) {
      var td = el('td');
      td.appendChild(controlCelda(f, c, imp));
      f.__celdas[c.indice] = td;
      tr.appendChild(td);
    });
    return tr;
  }

  /* Controles propios, no los del formulario: `ctrlSelect`/`ctrlPreset` y
     `updateConditionals` se buscan por `document.querySelector`, y con N filas
     todas las instancias chocarían entre sí. Aquí solo hace falta capturar
     texto, así que un input o un select bastan. */
  function controlCelda(f, c, imp) {
    var col = columnaParaFamilia(c.cands, f.familia) || c.cands[0];
    var val = f.celdas[c.indice] == null ? '' : String(f.celdas[c.indice]);
    var ctrl;

    if (col.opciones && col.opciones.length && (col.estricta || col.clase !== 'campo')) {
      ctrl = el('select');
      var vacia = el('option', null, '');
      vacia.value = '';
      ctrl.appendChild(vacia);
      var conocida = false;
      col.opciones.forEach(function (o) {
        var opt = el('option', null, o.label);
        opt.value = o.label;
        if (normTexto(o.label) === normTexto(val) || String(o.valor) === val) conocida = true;
        ctrl.appendChild(opt);
      });
      // Un valor que no está en la lista se agrega para poder mostrarlo: la celda
      // se marca en rojo, pero no se pierde lo que el archivo traía.
      if (val && !conocida) {
        var extra = el('option', null, val);
        extra.value = val;
        ctrl.appendChild(extra);
      }
      ctrl.value = val;
    } else {
      ctrl = el('input');
      ctrl.type = 'text';
      ctrl.value = val;
      if (col.opciones && col.opciones.length) {
        ctrl.title = 'Opciones: ' + col.opciones.map(function (o) { return o.label; }).join(' · ') +
                     ' — o una medida.';
      }
    }

    ctrl.addEventListener('change', function () {
      f.celdas[c.indice] = ctrl.value;
      revalidarTodo(imp);
      pintarValidacion(imp);
      // La familia decide qué columnas aplican y qué opciones ofrece cada celda.
      if (c.indice === imp.idxFamilia) renderImport();
    });
    return ctrl;
  }

  /* Repinta estados sin reconstruir controles: reconstruirlos perdería el foco
     a media corrección. */
  function pintarValidacion(imp) {
    var ICONO = { ok: '✔', aviso: '⚠', error: '✖' };
    var ok = 0, conError = 0;

    imp.filas.forEach(function (f) {
      if (!f.__estado) return;
      f.__estado.textContent = ICONO[f.estado] || '';
      f.__estado.className = 'celda-estado es-' + f.estado;
      f.__estado.title = f.error ? f.error : (f.avisos.length ? f.avisos.join('\n') : '');

      imp.cols.forEach(function (c) {
        var td = f.__celdas[c.indice];
        if (!td) return;
        var msg = f.errores[c.indice];
        var col = columnaParaFamilia(c.cands, f.familia);
        var na  = f.familia && (!col || (col.clase === 'campo' &&
                    col.familias.indexOf(f.familia) < 0));
        td.className = (msg ? 'is-bad' : '') + (na ? ' is-na' : '');
        td.title = msg || (na ? 'No aplica a esta familia.' : '');
      });

      if (f.estado === 'error') conError++; else ok++;
    });

    $('#import-resumen').textContent =
      imp.filas.length + ' filas · ' + ok + ' listas · ' + conError + ' con error';
    $('#btn-import-ok').disabled = ok === 0;
    $('#btn-import-ok').textContent = 'Importar ' + ok;
    $('#btn-import-descartar').disabled = conError === 0;
  }

  // ---- Acciones ------------------------------------------------------------
  function importarPedir() {
    if (!state.rootValido) {
      toast('error', 'Falta configurar la carpeta', 'Selecciona la carpeta del proyecto (contiene «Main Components»).');
      return;
    }
    $('#btn-importar').disabled = true;
    SU.importar_archivo();
  }

  function importarConfirmar() {
    var imp = state.importar;
    if (!imp) return;
    var buenas = imp.filas.filter(function (f) { return f.estado !== 'error'; });
    if (!buenas.length) return;

    buenas.forEach(function (f) {
      var manifest = findManifest(f.familia);
      state.registros.push({
        id: 'r' + (state.seq++), familia: f.familia, titulo: manifest.titulo,
        valores: f.valores, estado: 'borrador', nombre_salida: f.nombre,
        nombreManual: true   // el nombre vino del archivo: no lo pisa el patrón
      });
    });

    state.importar = null;
    state.activeId = state.registros[state.registros.length - 1].id;
    renderSidebar();
    renderEditor();
    toast('ok', 'Importados ' + buenas.length + (buenas.length === 1 ? ' módulo' : ' módulos'),
          'Quedan como borradores: revísalos y usa «Generar todos».');
  }

  function importarDescartarMalas() {
    var imp = state.importar;
    if (!imp) return;
    imp.filas = imp.filas.filter(function (f) { return f.estado !== 'error'; });
    revalidarTodo(imp);
    renderImport();
  }

  function importarCancelar() {
    state.importar = null;
    renderEditor();
  }

  // =========================================================================
  //  Confirmación
  // -------------------------------------------------------------------------
  //  Modal propio en vez de window.confirm(): el diálogo nativo dentro de
  //  UI::HtmlDialog es del navegador embebido y bloquea el hilo del diálogo.
  //  Reusa el mismo markup .modal del selector de familia.
  // =========================================================================
  function confirmar(titulo, cuerpo, onOk) {
    $('#modal-confirm-title').textContent = titulo;
    $('#modal-confirm-body').textContent  = cuerpo;

    // Se reemplaza el botón para no acumular listeners entre confirmaciones.
    var ok    = $('#modal-confirm-ok');
    var nuevo = ok.cloneNode(true);
    ok.parentNode.replaceChild(nuevo, ok);
    nuevo.addEventListener('click', function () { cerrarConfirm(); onOk(); });

    $('#modal-confirm').hidden = false;
  }
  function cerrarConfirm() { $('#modal-confirm').hidden = true; }

  // =========================================================================
  //  Toasts
  // =========================================================================
  function toast(tipo, titulo, cuerpo) {
    var t = el('div', 'toast toast--' + tipo);
    t.appendChild(el('div', 'toast__title', titulo));
    if (cuerpo) t.appendChild(el('div', 'toast__body', cuerpo));
    $('#toasts').appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 250); }, 4200);
  }

  // =========================================================================
  //  Bridge: solicitudes a Ruby
  // =========================================================================
  function requestManifest(familia, registroId) {
    state.pending = { registroId: registroId, familia: familia };
    SU.get_manifest(familia);
  }

  // =========================================================================
  //  Bridge: respuestas desde Ruby  (window.CC.*)
  // =========================================================================
  window.CC = {
    onSync: function (data) {
      state.familias = data.familias || [];
      state.projectRoot = data.project_root || '';
      state.rootValido = !!data.root_valido;
      renderFamilias();
      renderRoot();
      if (!state.rootValido) {
        toast('warn', 'Carpeta del proyecto no encontrada', 'Usa «Cambiar carpeta…» para señalar la carpeta que contiene «Main Components».');
      }
    },

    onManifest: function (res) {
      if (!res || !res.ok) {
        toast('error', 'No se pudo cargar el manifiesto', res && res.error ? res.error : '');
        return;
      }
      var manifest = res.manifest;
      state.manifests[manifest.familia] = manifest;

      var p = state.pending;
      state.pending = null;
      if (p && p.familia === manifest.familia) {
        var reg = state.registros.filter(function (r) { return r.id === p.registroId; })[0];
        if (reg && !reg.valores) {
          reg.valores = defaultValores(manifest);
          reg.nombre_salida = nombreUnico(autoNombre(manifest, reg.valores), reg.id);
        }
      }
      renderSidebar();
      renderEditor();
    },

    onImportar: function (res) {
      $('#btn-importar').disabled = false;
      if (!res || res.cancelado) return;
      if (!res.ok) { toast('error', 'No se pudo leer el archivo', res.error || 'Desconocido'); return; }
      armarImportacion(res);
    },

    /* Ya no hay selector de ruta: Ruby escribe en Descargas y devuelve dónde
       quedó. El toast lleva la ruta completa porque es lo único que dice a
       dónde fue el archivo. */
    onPlantilla: function (res) {
      $('#btn-plantilla').disabled = false;
      if (!res) return;
      if (res.ok) toast('ok', 'Plantilla descargada', res.ruta);
      else        toast('error', 'No se pudo descargar la plantilla', res.error || 'Desconocido');
    },

    onGenerar: function (res) {
      // El id viaja en el payload y vuelve aquí: durante un lote el registro
      // activo NO es el que se acaba de generar. Sin id (respuesta vieja) se
      // conserva el comportamiento anterior.
      var id = res && res.registro_id;
      var r  = id
        ? state.registros.filter(function (x) { return x.id === id; })[0]
        : activeRegistro();
      var L = state.lote;
      var avisos = (res && res.warnings) ? res.warnings.length : 0;

      if (res && res.ok) {
        if (r) { r.estado = 'generado'; r.error = null; }
        if (L) {
          L.ok++; L.avisos += avisos;   // en lote los avisos se suman al resumen final
        } else {
          toast('ok', 'Módulo generado', res.ruta || 'Insertado en la escena.');
          if (avisos) toast('warn', 'Avisos (' + avisos + ')', res.warnings.slice(0, 4).join(' · '));
        }
      } else {
        var msg = (res && res.error) ? res.error : 'Desconocido';
        if (r) marcarError(r, msg);
        if (L) L.fallos++;
        else   toast('error', 'Error al generar', msg);
      }

      if (L) {
        L.hechos++;
        renderSidebar();
        siguienteDelLote();
      } else {
        refrescarGenerar();
        renderSidebar();
      }
    }
  };

  /* Superficie mínima para el arnés de pruebas (test/reglas.test.js): la capa de
     validación es pura y se puede correr con los manifiestos reales sin DOM. */
  window.RCC_TEST = {
    defaultValores:       defaultValores,
    erroresConfig:        erroresConfig,
    avisosConfig:         avisosConfig,
    flatten:              flatten,
    presupuestoCajones:   presupuestoCajones,
    presupuestosCajones:  presupuestosCajones,
    altoZona:             altoZona,
    geomEntrepanos:       geomEntrepanos,
    geomFrentes:          geomFrentes,
    choquesRepisas:       choquesRepisas,
    altoLateralCajon:     altoLateralCajon,
    normalizarPreset:     normalizarPreset,
    presupuestoDivisores: presupuestoDivisores,
    fieldByAttr:          fieldByAttr,
    fieldVisible:         fieldVisible,
    nombresDivisores:     nombresDivisores,
    autoNombre:           autoNombre,
    problemasRegistro:    problemasRegistro,
    nombreUnico:          nombreUnico,
    state:                state
  };

  // =========================================================================
  //  Init / eventos globales
  // =========================================================================
  function init() {
    $('#btn-nuevo').addEventListener('click', openFamiliaModal);
    $('#btn-nuevo-2').addEventListener('click', openFamiliaModal);
    $('#btn-clonar').addEventListener('click', clonarActivo);
    $('#btn-generar').addEventListener('click', generar);
    $('#btn-generar-todos').addEventListener('click', generarTodos);
    // Se detiene DESPUÉS de la unidad en curso: cortar a media generación
    // dejaría la instancia a medio construir en la escena.
    $('#btn-cancelar-lote').addEventListener('click', function () {
      if (!state.lote) return;
      state.lote.cancelado = true;
      actualizarBotonLote();
    });
    $('#btn-carpeta').addEventListener('click', function () { SU.elegir_carpeta(); });
    $('#btn-plantilla').addEventListener('click', function () {
      $('#btn-plantilla').disabled = true;
      SU.exportar_plantilla();
    });
    $('#btn-importar').addEventListener('click', importarPedir);
    $('#btn-import-ok').addEventListener('click', importarConfirmar);
    $('#btn-import-descartar').addEventListener('click', importarDescartarMalas);
    $('#btn-import-cancelar').addEventListener('click', importarCancelar);

    // Escribir un nombre lo vuelve propio: a partir de ahí el patrón ya no lo
    // recalcula (R-30). Vaciarlo devuelve el módulo al auto-nombre.
    $('#nombre-salida').addEventListener('input', function () {
      var r = activeRegistro();
      if (!r) return;
      r.nombre_salida = this.value;
      r.nombreManual  = this.value.trim() !== '';
      if (!r.nombreManual) refrescarAutoNombre(findManifest(r.familia), r);
      renderSidebar();
      refrescarGenerar();
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', closeFamiliaModal);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-confirm-close]'), function (b) {
      b.addEventListener('click', cerrarConfirm);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      closeFamiliaModal();
      cerrarConfirm();
    });

    renderSidebar();   // deja el botón del lote en su estado inicial (oculto)

    SU.sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
