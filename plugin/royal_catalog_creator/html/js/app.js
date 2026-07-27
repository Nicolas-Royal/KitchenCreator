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

  function fieldVisible(field, manifest, valores) {
    if (!field.visible_si) return true;
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

  // ---- Defaults / registro nuevo ------------------------------------------
  function defaultValores(manifest) {
    var v = {};
    manifest.grupos.forEach(function (g) {
      g.campos.forEach(function (f) {
        if (f.tipo === 'preset') {
          v[f.id] = (f.default != null && f.default !== '') ? f.default : (f.presets[0] ? f.presets[0].valor : '');
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
    group.campos.forEach(function (f) {
      bodyEl.appendChild(renderField(f, manifest, registro));
    });
    sec.appendChild(bodyEl);
    return sec;
  }

  function renderField(field, manifest, registro) {
    var wrap = el('div', 'field' + (field.requerido ? ' is-required' : ''));
    wrap.dataset.fieldId = field.id;
    if (field.visible_si) {
      wrap.dataset.visibleAttr = field.visible_si.attr;
      wrap.dataset.visibleMin = field.visible_si.min;
    }
    if (field.habilitado_si) {
      wrap.dataset.enableAttr = field.habilitado_si.attr;
      var esperado = field.habilitado_si.valores || [field.habilitado_si.valor];
      wrap.dataset.enableValores = esperado.join('|');
    }

    var label = el('label', 'field__label', field.label);
    wrap.appendChild(label);

    var control;
    switch (field.tipo) {
      case 'select':   control = ctrlSelect(field, registro); break;
      case 'preset':   control = ctrlPreset(field, registro); break;
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

  function ctrlPreset(field, registro) {
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

    box.appendChild(sel);
    box.appendChild(custom);
    sync();
    return box;
  }

  function ctrlStepper(field, manifest, registro) {
    var min = field.min || 0, max = field.max || 99;
    var step = el('div', 'stepper');
    var less = el('button', null, '−'); less.type = 'button';
    var val = el('div', 'stepper__val');
    var more = el('button', null, '+'); more.type = 'button';

    function get() { return parseInt(registro.valores[field.id], 10) || min; }
    function set(n) {
      n = Math.max(min, Math.min(max, n));
      registro.valores[field.id] = String(n);
      val.textContent = String(n);
      less.disabled = n <= min;
      more.disabled = n >= max;
      // Actualiza sobre el DOM existente (visibilidad de subcampos) sin re-render
      // completo, que perdería el foco y el estado colapsado de los grupos.
      onValueChange(findManifest(registro.familia), registro);
    }
    less.addEventListener('click', function () { set(get() - 1); });
    more.addEventListener('click', function () { set(get() + 1); });

    val.textContent = String(get());
    less.disabled = get() <= min;
    more.disabled = get() >= max;

    step.appendChild(less); step.appendChild(val); step.appendChild(more);
    return step;
  }

  /* Recorre el DOM aplicando visible_si, habilitado_si y condicion de grupo. */
  function updateConditionals(manifest, registro) {
    // grupos condicionales
    manifest.grupos.forEach(function (g) {
      if (!g.condicion) return;
      var sec = document.querySelector('.group[data-group="' + g.id + '"]');
      if (sec) sec.classList.toggle('is-disabled', !groupEnabled(g, manifest, registro.valores));
    });
    // campos con visible_si
    var fields = document.querySelectorAll('.field[data-visible-attr]');
    Array.prototype.forEach.call(fields, function (wrap) {
      var attr = wrap.dataset.visibleAttr;
      var min = parseInt(wrap.dataset.visibleMin, 10);
      var n = attrNumber(manifest, registro.valores, attr);
      wrap.hidden = !isNaN(n) && n < min;
    });
    // campos con habilitado_si
    var condFields = document.querySelectorAll('.field[data-enable-attr]');
    Array.prototype.forEach.call(condFields, function (wrap) {
      var attr = wrap.dataset.enableAttr;
      var esperado = (wrap.dataset.enableValores || '').split('|');
      var actual = String(attrRaw(manifest, registro.valores, attr));
      var on = esperado.some(function (v) { return String(v) === actual; });
      wrap.classList.toggle('is-disabled', !on);
      // Solo input/select: los botones del stepper gestionan su propio disabled
      // por min/max; la clase .is-disabled (pointer-events:none) bloquea su clic.
      Array.prototype.forEach.call(wrap.querySelectorAll('input, select'), function (ctrl) {
        ctrl.disabled = !on;
      });
    });
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
    return flat;
  }

  function generar() {
    var r = activeRegistro();
    if (!r) return;
    var manifest = findManifest(r.familia);
    if (!manifest) return;
    if (!state.rootValido) { toast('error', 'Falta configurar la carpeta', 'Selecciona la carpeta del proyecto (contiene «Main Components»).'); return; }

    var nombre = ($('#nombre-salida').value || r.nombre_salida || 'modulo').trim();
    r.nombre_salida = nombre;
    var payload = {
      familia: r.familia,
      nombre_salida: nombre,
      insertar_en_escena: $('#toggle-escena').checked,
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
