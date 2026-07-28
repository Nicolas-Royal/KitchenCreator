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
    elegir_carpeta: function () { console.warn('[CC] sketchup.elegir_carpeta no disponible.'); }
  };

  var ICONOS = { gabinete: '🗄️', alacena: '📦', esquinero: '📐' };

  // ---- Estado --------------------------------------------------------------
  var state = {
    familias: [],
    projectRoot: '',
    rootValido: false,
    manifests: {},        // familia -> manifest
    registros: [],        // { id, familia, titulo, nombre_salida, valores, estado }
    activeId: null,
    seq: 1,
    pending: null         // { registroId } esperando manifest
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

  /* Valor "efectivo" de un campo tal como se inyectará (incluye unidad). */
  function effectiveValue(field, valores) {
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
  /* Medida de un attr en mm, tal como se va a inyectar (resuelve presets). */
  function attrMm(manifest, valores, attr) {
    var f = fieldByAttr(manifest, attr);
    return f ? parseMm(effectiveValue(f, valores)) : NaN;
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
  /* Habilitación por campo: el control queda activo solo si el attr de referencia
     tiene alguno de los valores esperados (habilitado_si.valor o .valores[]). */
  function fieldEnabled(field, manifest, valores) {
    if (!field.habilitado_si) return true;
    var esperado = field.habilitado_si.valores || [field.habilitado_si.valor];
    var actual = String(attrRaw(manifest, valores, field.habilitado_si.attr));
    return esperado.some(function (v) { return String(v) === actual; });
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
      var estado = el('span', null, r.estado === 'generado' ? '✓ generado' : 'borrador');
      meta.appendChild(estado);

      card.appendChild(top);
      card.appendChild(meta);
      cont.appendChild(card);
    });
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
    return wrap;
  }

  function onValueChange(manifest, registro) {
    updateConditionals(manifest, registro);
    // refresca meta/estado (auto-nombre no se pisa si el usuario ya lo editó)
    registro.estado = 'borrador';
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
    $('#pane-empty').hidden = which !== 'empty';
    $('#pane-editor').hidden = which !== 'editor';
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
        var v = effectiveValue(f, registro.valores);
        if (v === '' || v == null) return;
        flat[f.attr] = v;   // duplicados de attr: gana el último (quirk conocido de la definición)
      });
    });
    aplicarAltosAutomaticos(manifest, registro, flat);
    return flat;
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

  function generar() {
    var r = activeRegistro();
    if (!r) return;
    var manifest = findManifest(r.familia);
    if (!manifest) return;
    if (!state.rootValido) { toast('error', 'Falta configurar la carpeta', 'Selecciona la carpeta del proyecto (contiene «Main Components»).'); return; }

    // Sin esto el componente recorta los cajones y la pila traspasa el mueble.
    var presupuesto = presupuestoCajones(manifest, r.valores);
    if (presupuesto.aplica && !presupuesto.ok) {
      toast('error', 'Los cajones no caben', presupuesto.mensaje);
      return;
    }

    var nombre = ($('#nombre-salida').value || r.nombre_salida || 'modulo').trim();
    r.nombre_salida = nombre;
    var payload = {
      familia: r.familia,
      nombre_salida: nombre,
      insertar_en_escena: $('#toggle-escena').checked,
      limpiar_ocultos: $('#toggle-limpiar').checked,
      valores: flatten(manifest, r)
    };
    $('#btn-generar').disabled = true;
    toast('warn', 'Generando…', nombre);
    SU.generar(JSON.stringify(payload));
  }

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

    onGenerar: function (res) {
      $('#btn-generar').disabled = false;
      var r = activeRegistro();
      if (res && res.ok) {
        if (r) { r.estado = 'generado'; renderSidebar(); }
        toast('ok', 'Módulo generado', res.ruta || 'Insertado en la escena.');
        if (res.warnings && res.warnings.length) {
          toast('warn', 'Avisos (' + res.warnings.length + ')', res.warnings.slice(0, 4).join(' · '));
        }
      } else {
        toast('error', 'Error al generar', res && res.error ? res.error : 'Desconocido');
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
    $('#btn-carpeta').addEventListener('click', function () { SU.elegir_carpeta(); });

    $('#nombre-salida').addEventListener('input', function () {
      var r = activeRegistro();
      if (r) { r.nombre_salida = this.value; renderSidebar(); }
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', closeFamiliaModal);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeFamiliaModal(); });

    SU.sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
