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
      if (!f || !fieldVisible(f, manifest, valores) || !fieldEnabled(f, manifest, valores)) return;
      // Sin manifiesto: el sumando se lee crudo, para que un ajuste no pueda
      // encadenarse con otro (ni entrar en recursión).
      var mm = parseMm(valorCapturado(f, valores));
      if (!isNaN(mm)) total += mm;
    });
    return total;
  }

  /* Valor numérico simple de un attr (para visible_si / patrón de nombre). */
  function attrNumber(manifest, valores, attr) {
    var f = fieldByAttr(manifest, attr);
    if (!f) return NaN;
    var v = valores[f.id];
    var n = parseInt(v, 10);
    return isNaN(n) ? NaN : n;
  }
  function attrRaw(manifest, valores, attr) {
    var f = fieldByAttr(manifest, attr);
    return f ? valores[f.id] : undefined;
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
    if (field.visible_si.min_cajones != null) {
      // En modo uniforme el componente hace los cajones copia del primero: un
      // solo alto manda sobre todos, así que los demás campos no se muestran.
      if (indiceAlto(manifest, field.attr) > 0 && cajonesUniformes(manifest, valores)) return false;
      return cajonesEfectivos(manifest, valores) >= field.visible_si.min_cajones;
    }
    var n = attrNumber(manifest, valores, field.visible_si.attr);
    if (isNaN(n)) return true;
    return n >= field.visible_si.min;
  }
  function groupEnabled(group, manifest, valores) {
    if (!group.condicion) return true;
    return String(attrRaw(manifest, valores, group.condicion.attr)) === String(group.condicion.valor);
  }
  /* Predicado de condición del manifiesto, en una sola implementación para que
     habilitado_si y los sumandos de `suma` no puedan divergir:
       { attr, valor }        -> igual a ese valor
       { attr, valores: [] }  -> igual a alguno
       { attr, excepto: [] }  -> distinto de todos (ej. «puerta ≠ Ninguna») */
  function condicionCumple(manifest, valores, cond) {
    var actual = String(attrRaw(manifest, valores, cond.attr));
    if (cond.excepto) {
      return !cond.excepto.some(function (v) { return String(v) === actual; });
    }
    var esperado = cond.valores || [cond.valor];
    return esperado.some(function (v) { return String(v) === actual; });
  }
  /* Habilitación por campo: el control queda activo solo si el attr de referencia
     cumple la condición declarada. */
  function fieldEnabled(field, manifest, valores) {
    if (!field.habilitado_si) return true;
    return condicionCumple(manifest, valores, field.habilitado_si);
  }

  // =========================================================================
  //  Presupuesto de alto de cajones  (errores 1 y 2 de Issues/errors.md)
  // -------------------------------------------------------------------------
  //  La fórmula interna del componente reparte el alto en partes iguales
  //  (=(LenZ - f02sepcajtirad*(a21cantcajon-1))/a21cantcajon) pero NO tiene
  //  piso: si el reparto queda por debajo del alto físico mínimo del cajón, el
  //  componente lo recorta hacia arriba y la pila traspasa el mueble. Aquí se
  //  hace la misma cuenta antes de generar, para bloquear lo que no cabe.
  //  Todos los parámetros viven en manifest.reglas_cajones (dato, no código).
  // =========================================================================

  /* Cajones efectivos según el diseño de puerta: "n" toma el contador,
     7/8/9 son los componentes fijos de 2/3/4 cajones. 0 = no aplica. */
  function cajonesEfectivos(manifest, valores) {
    var R = manifest.reglas_cajones;
    if (!R) return 0;
    var estilo = String(attrRaw(manifest, valores, R.attr_estilo_puerta));
    var mapa = R.estilos_con_cajones || {};
    if (!Object.prototype.hasOwnProperty.call(mapa, estilo)) return 0;
    if (mapa[estilo] === 'n') {
      var n = attrNumber(manifest, valores, R.attr_cantidad);
      return isNaN(n) ? 0 : n;
    }
    return parseInt(mapa[estilo], 10) || 0;
  }

  /* Modo uniforme: con «N cajones» el componente genera los cajones como copias
     del primero (Cajon.copies), así que todos miden lo mismo y solo se captura
     un alto. Se declara en reglas_cajones.uniforme_si_n. */
  function cajonesUniformes(manifest, valores) {
    var R = manifest.reglas_cajones;
    if (!R || !R.uniforme_si_n) return false;
    var estilo = String(attrRaw(manifest, valores, R.attr_estilo_puerta));
    return (R.estilos_con_cajones || {})[estilo] === 'n';
  }

  /* Posición del attr dentro de attrs_alto; -1 si no es un alto de cajón. */
  function indiceAlto(manifest, attr) {
    var R = manifest.reglas_cajones;
    return (R && R.attrs_alto) ? R.attrs_alto.indexOf(attr) : -1;
  }

  function presupuestoCajones(manifest, valores) {
    var R = manifest.reglas_cajones;
    var n = cajonesEfectivos(manifest, valores);
    if (!R || n < 1) return { aplica: false };

    // attrMm devuelve el alto YA compensado (LenZ incluye el zócalo por el ajuste
    // `suma`), que es exactamente lo que se inyecta y lo que revalida main.rb.
    // Por eso attr_restar sigue quitando el zócalo aquí: no hay doble descuento,
    // los dos espejos parten del mismo número. Ver validar_cajones en main.rb.
    var util = attrMm(manifest, valores, R.attr_alto_util);
    if (isNaN(util)) return { aplica: false };
    (R.attr_restar || []).forEach(function (a) {
      var v = attrMm(manifest, valores, a);
      if (!isNaN(v)) util -= v;
    });

    var sep = attrMm(manifest, valores, R.attr_separacion);
    if (isNaN(sep)) sep = 0;

    var altoMin    = R.alto_min_mm || 0;
    var disponible = util - sep * (n - 1);   // suma de los n frentes
    var uniforme   = cajonesUniformes(manifest, valores);

    // Altos que la diseñadora fijó; los que están en «Automático» van vacíos.
    // En modo uniforme solo existe el primero y aplica a los n cajones. Si no,
    // y n supera la cantidad de campos, esos cajones también quedan automáticos
    // (los reparte la fórmula del componente).
    var attrsAlto = (R.attrs_alto || []).slice(0, uniforme ? 1 : n);
    var altos     = attrsAlto.map(function (a) { return attrMm(manifest, valores, a); });

    var fijos = [], libresIdx = [], libres, asignado;
    if (uniforme) {
      if (isNaN(altos[0])) {
        libres = n; libresIdx = [0]; asignado = 0;
      } else {
        libres = 0; fijos = [{ mm: altos[0], i: 0 }]; asignado = altos[0] * n;
      }
    } else {
      altos.forEach(function (v, i) {
        if (isNaN(v)) libresIdx.push(i); else fijos.push({ mm: v, i: i });
      });
      libres   = n - fijos.length;
      asignado = fijos.reduce(function (s, f) { return s + f.mm; }, 0);
    }
    var restante = disponible - asignado;
    var porCajon = libres > 0 ? restante / libres : (uniforme ? altos[0] : NaN);
    var paso     = altoMin + sep;
    // nMax = tope geométrico del mueble (todos los cajones al mínimo). No depende
    // de n ni de los altos fijados, así que sirve de tope estable del contador.
    var nMax     = paso > 0 ? Math.floor((util + sep) / paso) : n;
    // cabenTotal = cuántos caben respetando los altos que ya fijó la diseñadora.
    var cabenTotal;
    if (uniforme) {
      var pasoU  = (fijos.length ? altos[0] : altoMin) + sep;
      cabenTotal = pasoU > 0 ? Math.floor((util + sep) / pasoU) : n;
    } else {
      cabenTotal = paso > 0 ? fijos.length + Math.max(0, Math.floor((restante + sep) / paso)) : n;
    }

    var ok = true, mensaje = '';
    var chico = fijos.filter(function (f) { return f.mm < altoMin; })[0];
    if (disponible <= 0) {
      ok = false;
      mensaje = 'El alto útil del mueble quedó en ' + fmt(util) + ' mm. Revisa alto, zócalo y márgenes.';
    } else if (chico) {
      ok = false;
      mensaje = (uniforme ? 'El alto de cada cajón (' : 'El alto del cajón ' + (chico.i + 1) + ' (') +
                fmt(chico.mm) + ' mm) es menor al mínimo de ' + altoMin + ' mm.';
    } else if (restante < -1) {
      // Solo bloquea lo que se PASA. Que sobre alto deja un hueco, no un desborde.
      ok = false;
      mensaje = uniforme
        ? 'Cada cajón de ' + fmt(altos[0]) + ' mm × ' + n + ' = ' + fmt(asignado) + ' mm y solo caben ' +
          fmt(disponible) + ' mm: con ese alto caben ' + cabenTotal + (cabenTotal === 1 ? ' cajón.' : ' cajones.')
        : 'Los altos fijados suman ' + fmt(asignado) + ' mm y solo caben ' + fmt(disponible) +
          ' mm: se pasan ' + fmt(-restante) + ' mm.';
    } else if (libres > 0 && porCajon < altoMin) {
      ok = false;
      mensaje = 'Quedan ' + fmt(restante) + ' mm para ' + libres + (libres === 1 ? ' cajón = ' : ' cajones = ') +
                fmt(porCajon) + ' mm cada uno, por debajo del mínimo de ' + altoMin + ' mm. ' +
                (fijos.length
                  ? 'Con esos altos fijados caben ' + cabenTotal + (cabenTotal === 1 ? ' cajón' : ' cajones') + ' en total.'
                  : 'Con ' + fmt(util) + ' mm de alto útil caben máximo ' + nMax + (nMax === 1 ? ' cajón.' : ' cajones.'));
    }

    return {
      aplica: true, n: n, util: util, sep: sep, disponible: disponible,
      asignado: asignado, restante: restante, porCajon: porCajon, libres: libres,
      libresIdx: libresIdx, attrsAlto: attrsAlto, altos: altos, uniforme: uniforme,
      altoMin: altoMin, nMax: nMax, cabenTotal: cabenTotal, ok: ok, mensaje: mensaje
    };
  }

  /* Alto máximo que puede tomar el cajón `attr` sin dejar a los demás por debajo
     del mínimo. Es lo que decide qué presets (CH/G) se siguen ofreciendo. */
  function limiteAltoCajon(manifest, valores, attr) {
    var p = presupuestoCajones(manifest, valores);
    if (!p.aplica) return Infinity;
    var i = p.attrsAlto.indexOf(attr);
    if (i < 0) return Infinity;
    if (p.uniforme) return p.disponible / p.n;   // el alto se multiplica por n
    var otrosFijos = 0, otrosLibres = 0;
    p.altos.forEach(function (mm, j) {
      if (j === i) return;
      if (isNaN(mm)) otrosLibres++; else otrosFijos += mm;
    });
    // Los cajones sin campo propio (n > attrs_alto.length) también piden su mínimo.
    otrosLibres += p.n - p.altos.length;
    return p.disponible - otrosFijos - p.altoMin * otrosLibres;
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

  function autoNombre(manifest, valores) {
    var patron = manifest.nombre_patron;
    if (!patron) return manifest.titulo + '-' + state.seq;
    return patron.replace(/\{([^}]+)\}/g, function (_, attr) {
      var r = attrRaw(manifest, valores, attr);
      return (r == null || r === '') ? '0' : String(r);
    });
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
    if (group.presupuesto === 'cajones') {
      var pres = el('p', 'budget');
      pres.dataset.budget = 'cajones';
      pres.hidden = true;            // updateConditionals() lo llena y lo muestra
      bodyEl.appendChild(pres);
    }
    // El editor de caja se lleva los cuatro márgenes; el resto de los campos
    // sigue en el grid normal, en su orden original.
    var caja = group.box_model ? renderBoxModel(group.box_model, manifest, registro) : null;
    if (caja) bodyEl.appendChild(caja.widget);

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

  function renderField(field, manifest, registro, corto) {
    // `data-field-id` es el único enlace DOM↔manifiesto: updateConditionals()
    // resuelve visible_si/habilitado_si leyendo el manifiesto, no el dataset.
    var wrap = el('div', 'field' + (field.requerido ? ' is-required' : ''));
    wrap.dataset.fieldId = field.id;

    // Dentro del editor de caja la posición ya dice de qué margen se trata.
    var texto = (corto && field.label_corto) ? field.label_corto : field.label;
    wrap.dataset.labelBase = texto;          // updateConditionals() puede sustituirlo
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
      wrap.appendChild(el('span', 'field__hint field__hint--cond', field.habilitado_si.mensaje));
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
    if (field.auto) { input.placeholder = 'Automático'; }
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
      if (field.max_regla === 'cajones') {
        var p = presupuestoCajones(manifest, registro.valores);
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

  /* Pinta el resumen de alto de cajones del grupo con `presupuesto: "cajones"`. */
  function refreshBudget(manifest, valores) {
    var box = document.querySelector('.budget[data-budget="cajones"]');
    if (!box) return;

    var p = presupuestoCajones(manifest, valores);
    box.hidden = !p.aplica;
    if (!p.aplica) return;

    box.classList.toggle('budget--bad', !p.ok);
    var partes = [
      'Alto útil ' + fmt(p.util) + ' mm',
      p.n + (p.n === 1 ? ' cajón' : ' cajones' + (p.uniforme ? ' iguales' : '')),
      'asignado ' + fmt(p.asignado) + ' mm'
    ];
    if (p.libres > 0) {
      partes.push('restante ' + fmt(p.restante) + ' mm → ' + fmt(p.porCajon) + ' mm c/u');
    } else if (p.restante > 1) {
      partes.push('sobran ' + fmt(p.restante) + ' mm sin usar');
    }
    box.textContent = partes.join(' · ') + (p.ok ? '' : ' — ' + p.mensaje);
  }

  /* Recorre el DOM aplicando visible_si, habilitado_si y condicion de grupo. */
  function updateConditionals(manifest, registro) {
    var valores = registro.valores;

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
    var uniforme = cajonesUniformes(manifest, valores);
    manifest.grupos.forEach(function (g) {
      g.campos.forEach(function (f) {
        var wrap = document.querySelector('.field[data-field-id="' + f.id + '"]');
        if (!wrap) return;
        if (f.visible_si) wrap.hidden = !fieldVisible(f, manifest, valores);
        if (f.suma) refrescarHintSuma(wrap, f, manifest, valores);
        // El primer alto pasa a mandar sobre todos los cajones: se renombra para
        // que la etiqueta no siga prometiendo un control por cajón.
        if (indiceAlto(manifest, f.attr) === 0) {
          var lbl = wrap.querySelector('.field__label');
          var alt = manifest.reglas_cajones.label_uniforme;
          if (lbl && alt) lbl.textContent = uniforme ? alt : wrap.dataset.labelBase;
        }
        if (f.habilitado_si) {
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
    reg.nombre_salida = autoNombre(manifest, valores);
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
      estado: 'borrador',
      nombre_salida: (r.nombre_salida || 'modulo') + '-copia'
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
    manifest.grupos.forEach(function (g) {
      if (!groupEnabled(g, manifest, registro.valores)) return;
      g.campos.forEach(function (f) {
        if (!fieldVisible(f, manifest, registro.valores)) return;
        if (!fieldEnabled(f, manifest, registro.valores)) return;
        var v = effectiveValue(f, registro.valores, manifest);
        if (v === '' || v == null) return;
        flat[f.attr] = v;   // duplicados de attr: gana el último (quirk conocido de la definición)
      });
    });
    aplicarAltosAutomaticos(manifest, registro, flat);
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
    var n = attrNumber(manifest, registro.valores, R.attr_cantidad);
    if (isNaN(n) || n < 1) return null;

    var mapa = R.nombres_por_modo || {};
    var nombres = [];
    for (var i = 1; i <= n; i++) {
      var f = fieldByAttr(manifest, R.attr_modo.replace('{i}', i));
      // Campo ausente, oculto o deshabilitado: no hay modo elegido, va el default.
      var modo = (f && fieldVisible(f, manifest, registro.valores) &&
                       fieldEnabled(f, manifest, registro.valores))
        ? registro.valores[f.id] : null;
      nombres.push(Object.prototype.hasOwnProperty.call(mapa, modo) ? mapa[modo] : R.nombre_default);
    }
    return { prefijo: R.prefijo, nombres: nombres };
  }

  /* Cierra el reparto: los cajones en «Automático» reciben el alto restante ya
     calculado, para que el .skp coincida con lo que mostró el presupuesto en vez
     de depender de la fórmula sin piso del componente. */
  function aplicarAltosAutomaticos(manifest, registro, flat) {
    var p = presupuestoCajones(manifest, registro.valores);
    if (!p.aplica || !p.ok || p.libres <= 0) return;
    p.libresIdx.forEach(function (i) {
      var attr = p.attrsAlto[i];
      var f = fieldByAttr(manifest, attr);
      if (!f || !fieldVisible(f, manifest, registro.valores)) return;
      flat[attr] = (Math.round(p.porCajon * 100) / 100) + 'mm';
    });
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
    // Sin esto el componente recorta los cajones y la pila traspasa el mueble.
    var presupuesto = presupuestoCajones(manifest, r.valores);
    if (presupuesto.aplica && !presupuesto.ok) {
      return { ok: false, titulo: 'Los cajones no caben', error: presupuesto.mensaje };
    }

    r.nombre_salida = (r.nombre_salida || 'modulo').trim();
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

  /* Registros que el motor rechazaría por presupuesto de cajones. Se detectan
     antes de arrancar para poder advertirlo en la confirmación en vez de a
     media cola. */
  function invalidosDelLote() {
    return state.registros.filter(function (r) {
      var m = findManifest(r.familia);
      if (!m) return true;
      var p = presupuestoCajones(m, r.valores);
      return p.aplica && !p.ok;
    });
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
    $('#btn-generar').disabled = false;
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

    // Requeridos y campos apagados se resuelven con los MISMOS predicados que el
    // formulario, ya con todos los valores puestos.
    manifest.grupos.forEach(function (g) {
      g.campos.forEach(function (campo) {
        var vis = fieldVisible(campo, manifest, valores);
        var on  = fieldEnabled(campo, manifest, valores);
        var i   = indiceDeCampo(imp, f.familia, campo.id);
        if (campo.requerido && vis && on && valorCapturado(campo, valores) === '') {
          if (i >= 0) f.errores[i] = 'Requerido.';
          else f.error = f.error || 'Falta «' + campo.label + '» y no viene en el archivo.';
        }
        // Dato capturado sobre un campo que la propia configuración apaga: no es
        // un error, pero conviene decir que no va a llegar al .skp.
        if ((!vis || !on) && i >= 0 && texto(i) !== '') {
          f.avisos.push('«' + campo.label + '» no aplica con esta configuración: se ignora.');
        }
      });
    });

    var p = presupuestoCajones(manifest, valores);
    if (p.aplica && !p.ok) f.error = f.error || p.mensaje;

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
        valores: f.valores, estado: 'borrador', nombre_salida: f.nombre
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
          reg.nombre_salida = autoNombre(manifest, reg.valores);
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

    onPlantilla: function (res) {
      $('#btn-plantilla').disabled = false;
      if (!res || res.cancelado) return;
      if (res.ok) toast('ok', 'Plantilla generada', res.ruta);
      else        toast('error', 'No se pudo generar la plantilla', res.error || 'Desconocido');
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
        $('#btn-generar').disabled = false;
        renderSidebar();
      }
    }
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

    $('#nombre-salida').addEventListener('input', function () {
      var r = activeRegistro();
      if (r) { r.nombre_salida = this.value; renderSidebar(); }
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
