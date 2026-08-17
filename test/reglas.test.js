/* ===========================================================================
   DEV-21 — restricciones lógicas de la interfaz.

   Corre la capa de validación de app.js contra los manifiestos REALES, sin
   navegador: app.js no toca el DOM al cargarse (init() espera a
   DOMContentLoaded), así que basta con un `document` de mentira.

     node test/reglas.test.js
   =========================================================================== */
'use strict';

var fs     = require('fs');
var path   = require('path');
var assert = require('assert');

var RAIZ = path.join(__dirname, '..', 'plugin', 'royal_catalog_creator');

var window   = {};
var document = {
  readyState: 'loading',            // así init() nunca corre
  addEventListener: function () {},
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function () { return {}; }
};
new Function('window', 'document', 'console',
  fs.readFileSync(path.join(RAIZ, 'html', 'js', 'app.js'), 'utf8')
)(window, document, console);

var T = window.RCC_TEST;
var man = {};
['gabinete', 'alacena', 'esquinero'].forEach(function (f) {
  man[f] = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest', f + '.json'), 'utf8'));
});

// ---- utilidades del arnés --------------------------------------------------
function registro(familia, cambios) {
  var v = T.defaultValores(man[familia]);
  Object.keys(cambios || {}).forEach(function (k) { v[k] = cambios[k]; });
  return { id: 'r1', familia: familia, titulo: familia, valores: v, nombre_salida: 'X' };
}
function errores(familia, cambios) {
  var r = registro(familia, cambios);
  return T.erroresConfig(man[familia], r.valores).map(function (e) { return e.msg; });
}
function plano(familia, cambios) {
  var r = registro(familia, cambios);
  return T.flatten(man[familia], r);
}
function campo(familia, id) {
  var hit = null;
  man[familia].grupos.forEach(function (g) {
    g.campos.forEach(function (f) { if (f.id === id) hit = f; });
  });
  return hit;
}

var fallos = 0, corridas = 0;
function prueba(nombre, fn) {
  corridas++;
  try { fn(); }
  catch (e) { fallos++; console.error('✕ ' + nombre + '\n    ' + e.message); }
}

// ---- (a) combinaciones mutuamente excluyentes ------------------------------
prueba('R-01 · con puerta de cajones no hay entrepaños ni divisores', function () {
  var f = plano('gabinete', { EstiloPuerta: '6', c24entrepano: '0' });
  assert.strictEqual(f['c24entrepano'], '1', 'el entrepaño debe quedar forzado a No');
  Object.keys(f).forEach(function (k) {
    assert.ok(k.indexOf('divisor>') !== 0, 'no debe inyectarse ' + k);
  });
  assert.strictEqual(T.nombresDivisores(man.gabinete, registro('gabinete',
    { EstiloPuerta: '6', c24entrepano: '0' })), null);
});

prueba('R-02 · sin puerta no hay cantidad, posición, separación, márgenes ni tirador', function () {
  var f = plano('gabinete', { EstiloPuerta: '0' });
  ['puerta>e07cantpuerta', 'puerta>f01posextintpu', 'f04seppuertas',
   'f11margsupcaj', 'f12marginfcaj', 'f13margizqcaj', 'f14margdercaj',
   'puerta>f21tipotirador', 'puerta>f22postirador', 'puerta>f23orienttirador'
  ].forEach(function (a) { assert.ok(!(a in f), a + ' no debería inyectarse'); });
});

prueba('R-03 · «Sin tirador» apaga posición y orientación', function () {
  var f = plano('gabinete', { f21tipotirador: '1' });
  assert.ok(!('puerta>f22postirador' in f));
  assert.ok(!('puerta>f23orienttirador' in f));
  var g = plano('gabinete', { f21tipotirador: '4' });
  assert.strictEqual(g['puerta>f22postirador'], '3');
});

prueba('R-04 · sin diseño de cajones no se inyecta nada del grupo Cajones', function () {
  var f = plano('gabinete', { EstiloPuerta: '1' });
  ['b03tipocajon', 'cajon>a21cantcajon', 'f02sepcajtirad', 'cajon>n02corredpers',
   'b11altocaj1'].forEach(function (a) { assert.ok(!(a in f), a + ' no debería inyectarse'); });
});

prueba('R-05 · «Entrepaño» es el interruptor maestro de Divisores', function () {
  assert.ok(!('divisor>f01cantdiv' in plano('gabinete', { c24entrepano: '1' })));
  assert.strictEqual(plano('gabinete', { c24entrepano: '0' })['divisor>f01cantdiv'], '1');
});

prueba('R-06 · cada diseño de puerta de alacena trae sus propios campos', function () {
  var ala = function (extra) {
    var v = { LenX: '800', LenY: '350', LenZ: '700' };
    Object.keys(extra).forEach(function (k) { v[k] = extra[k]; });
    return plano('alacena', v);
  };

  // Puerta normal: solo la cantidad, con la lista del gabinete (11 = Puerta - 10).
  var n = ala({ c25tipopuerta: '3', e07cantpuerta: '11' });
  assert.strictEqual(n['puerta>e07cantpuerta'], '11');
  ['puerta>e08cantpuvert', 'puerta>e09tipapertura']
    .forEach(function (a) { assert.ok(!(a in n), a + ' no aplica a puerta normal'); });

  // Avento S: cantidad 1-10 + tipo de apertura, sin abatible.
  var s = ala({ c25tipopuerta: '7', e07cantpuerta_avento: '10', e09tipapertura: '1' });
  assert.strictEqual(s['puerta>e07cantpuerta'], '10');
  assert.strictEqual(s['puerta>e09tipapertura'], '1');
  assert.ok(!('puerta>e08cantpuvert' in s), 'el Avento S no lleva abatible');

  // Avento D: cantidad 1-10 + abatible, sin tipo de apertura.
  var d = ala({ c25tipopuerta: '11', e07cantpuerta_avento: '2', e08cantpuvert: '3' });
  assert.strictEqual(d['puerta>e07cantpuerta'], '2');
  assert.strictEqual(d['puerta>e08cantpuvert'], '3');
  assert.ok(!('puerta>e09tipapertura' in d), 'el Avento D no lleva tipo de apertura');

  // Sin puerta no se cuenta nada, con cualquiera de los dos campos.
  var cero = ala({ c25tipopuerta: '0' });
  assert.ok(!('puerta>e07cantpuerta' in cero));
});

prueba('R-06b · el vidrio completo y el uñero no llevan tirador', function () {
  [['gabinete', 'EstiloPuerta'], ['alacena', 'c25tipopuerta'], ['esquinero', 'EstiloPuerta']]
    .forEach(function (par) {
      ['3', '5'].forEach(function (diseno) {
        var v = {}; v[par[1]] = diseno;
        var f = plano(par[0], v);
        ['puerta>f21tipotirador', 'puerta>f22postirador', 'puerta>f23orienttirador']
          .forEach(function (a) {
            assert.ok(!(a in f), par[0] + ' con diseño ' + diseno + ' no debería inyectar ' + a);
          });
      });
      // Una puerta lisa sí lo lleva: la condición no puede apagar el grupo entero.
      var w = {}; w[par[1]] = '1';
      assert.ok('puerta>f21tipotirador' in plano(par[0], w), par[0] + ' lisa sí lleva tirador');
    });

  // La alacena repite la regla en sus Avento de vidrio (8 y 12). No hay Avento
  // uñero; el vidrio-madera (9 y 13) sí monta tirador porque tiene madera.
  ['8', '12'].forEach(function (d) {
    assert.ok(!('puerta>f21tipotirador' in plano('alacena', { c25tipopuerta: d })),
              'Avento de vidrio ' + d + ' no lleva tirador');
  });
  ['6', '9', '10', '13'].forEach(function (d) {
    assert.ok('puerta>f21tipotirador' in plano('alacena', { c25tipopuerta: d }),
              'Avento ' + d + ' sí lleva tirador');
  });
});

prueba('R-07 · el esquinero no tiene separación entre puertas', function () {
  assert.strictEqual(campo('esquinero', 'f04seppuertas'), null);
});

// ---- (b) valores fuera de rango -------------------------------------------
prueba('R-08 · ni negativos ni cero en las dimensiones', function () {
  assert.ok(errores('gabinete', { LenX: '-800' }).length > 0);
  assert.ok(errores('gabinete', { LenX: '0' }).length > 0);
  assert.ok(errores('gabinete', { c01espestr: '0' }).length > 0);
  assert.strictEqual(errores('gabinete', { f11margsupcaj: '0' }).length, 0, '0 mm de margen es válido');
});

prueba('R-09/R-22 · lo que no es una medida se rechaza en el campo', function () {
  ['ochocientos', '1e9', '12,5,7'].forEach(function (t) {
    assert.ok(errores('gabinete', { LenX: t }).length > 0, t + ' debería rechazarse');
  });
});

prueba('R-10 · el zócalo no puede alcanzar el alto del cuerpo', function () {
  assert.ok(errores('gabinete', { LenZ: '300', a02zocalo: '500' }).length > 0);
  assert.strictEqual(errores('gabinete', { LenZ: '600', a02zocalo: '100' }).length, 0);
});

prueba('R-11 · los márgenes no pueden comerse el frente', function () {
  assert.ok(errores('gabinete', { LenX: '800', f13margizqcaj: '600', f14margdercaj: '600' }).length > 0);
  assert.ok(errores('gabinete', { LenZ: '600', f11margsupcaj: '400', f12marginfcaj: '400' }).length > 0);
});

prueba('R-12 · un espesor no puede alcanzar la dimensión que atraviesa', function () {
  assert.ok(errores('gabinete', { c01espestr: '999' }).length > 0);
  assert.ok(errores('gabinete', { c03espfondo: '600' }).length > 0);   // LenY = 600
});

prueba('R-13 · descartada: la cantidad de puertas no se acota contra el ancho', function () {
  assert.strictEqual(errores('gabinete', { LenX: '300', e07cantpuerta: '11' }).length, 0);
});

prueba('R-14 · los espacios de los divisores advierten, no bloquean', function () {
  var cambios = { c24entrepano: '0', f02tipomedida: '2', f01cantdiv: '3',
                  f03espacio1: '5000', f03espacio2: '5000', f03espacio3: '5000' };
  assert.strictEqual(errores('gabinete', cambios).length, 0, 'no debe bloquear');
  var r = registro('gabinete', cambios);
  assert.ok(T.avisosConfig(man.gabinete, r.valores).length > 0, 'debe advertir');
});

prueba('R-15 · el séptimo espacio no existe en ningún manifiesto', function () {
  ['gabinete', 'alacena', 'esquinero'].forEach(function (f) {
    assert.strictEqual(campo(f, 'f03espacio7'), null, f + ' todavía declara f03espacio7');
  });
});

prueba('R-17 · el alto de cajones que sobra se advierte y se genera', function () {
  // 2 cajones CH fijados a mano en 600 mm útiles: sobran ~217 mm bajo la pila.
  var r = registro('gabinete', { EstiloPuerta: '7', b11altocaj1: '190mm', b12altocaj2: '190mm' });
  assert.strictEqual(T.erroresConfig(man.gabinete, r.valores).length, 0);
  assert.ok(T.avisosConfig(man.gabinete, r.valores).join(' ').indexOf('Sobran') >= 0);
});

prueba('R-17b · con «N cajones» el alto no se captura, se calcula', function () {
  var r = registro('gabinete', { EstiloPuerta: '6', a21cantcajon: '3', b11altocaj1: '190mm' });

  // Ningún campo de alto se muestra: los tres cajones son copias del primero.
  man.gabinete.reglas_cajones.attrs_alto.forEach(function (a) {
    var f = T.fieldByAttr(man.gabinete, a);
    assert.ok(!T.fieldVisible(f, man.gabinete, r.valores), a + ' no debería mostrarse');
  });

  // El 190 mm que quedó capturado se ignora: reparte el alto útil entre los 3.
  var p = T.presupuestoCajones(man.gabinete, r.valores);
  assert.strictEqual(p.libres, 3);
  assert.strictEqual(p.asignado, 0);
  assert.ok(Math.abs(p.porCajon - p.disponible / 3) < 0.01);

  // Y ese alto calculado sí llega al .skp, aunque el campo esté oculto.
  var f = plano('gabinete', { EstiloPuerta: '6', a21cantcajon: '3', b11altocaj1: '190mm' });
  assert.strictEqual(f['b11altocaj1'], (Math.round(p.porCajon * 100) / 100) + 'mm');
  ['b12altocaj2', 'b13altocaj3', 'b14altocaj4']
    .forEach(function (a) { assert.ok(!(a in f), a + ' lo copia el componente'); });
});

// ---- (c) dependencias entre campos ----------------------------------------
prueba('R-18 · el ancho de amarres solo aplica con amarres', function () {
  assert.ok(!('estructura>e23ancamtecho' in plano('gabinete', { e22tipotecho: '5', e23ancamtecho: '80' })));
  assert.strictEqual(plano('gabinete', { e22tipotecho: '2', e23ancamtecho: '80' })['estructura>e23ancamtecho'], '80mm');
});

prueba('R-19 · Alacena y Esquinero no tienen techo que medir', function () {
  assert.strictEqual(campo('alacena', 'e23ancamtecho'), null);
  assert.strictEqual(campo('esquinero', 'e23ancamtecho'), null);
});

prueba('R-20 · «Personalizado» exige todos los espacios visibles', function () {
  var e = errores('gabinete', { c24entrepano: '0', f02tipomedida: '2', f01cantdiv: '2' });
  assert.strictEqual(e.length, 2, 'faltan los dos espacios: ' + JSON.stringify(e));
  assert.strictEqual(errores('gabinete', { c24entrepano: '0', f02tipomedida: '1', f01cantdiv: '2' }).length, 0);
});

prueba('R-21 · la separación entre cajones nace en 3 mm', function () {
  assert.strictEqual(campo('gabinete', 'f02sepcajtirad').default, '3');
});

prueba('R-23 · CH y G son los únicos altos estándar de cajón', function () {
  var vals = campo('gabinete', 'b11altocaj1').presets.map(function (p) { return p.valor; });
  assert.deepStrictEqual(vals, ['', '190mm', '383mm']);
});

prueba('R-25 · la corredera nace en 50 cm y no pasa de la profundidad', function () {
  assert.strictEqual(campo('gabinete', 'n02corredpers').default, '50');
  assert.strictEqual(errores('gabinete', { EstiloPuerta: '6' }).length, 0);
  assert.ok(errores('gabinete', { EstiloPuerta: '6', LenY: '600', n02corredpers: '70' }).length > 0);
});

prueba('R-26 · el esquinero nombra sus divisiones', function () {
  var div = T.nombresDivisores(man.esquinero, registro('esquinero', { c24entrepano: '0', f01cantdiv: '2' }));
  assert.deepStrictEqual(div, { prefijo: 'divisor', nombres: ['Entrepaño', 'Entrepaño'] });
});

// ---- (d) estados que impiden generar --------------------------------------
prueba('R-27 · una alacena recién creada no se genera sin dimensiones', function () {
  var e = errores('alacena', {});
  assert.strictEqual(e.length, 3, 'LenX/LenY/LenZ: ' + JSON.stringify(e));
  assert.strictEqual(errores('alacena', { LenX: '800', LenY: '350', LenZ: '700' }).length, 0);
});

prueba('R-27 · el gabinete por omisión sí es válido (sin falsos positivos)', function () {
  assert.deepStrictEqual(errores('gabinete', {}), []);
  assert.deepStrictEqual(errores('esquinero', { LenX: '900', LenY: '900', LenZ: '600',
                                                a0101profizq: '600', a0102profder: '600' }), []);
});

prueba('R-28 · el nombre se valida con la misma regla que la importación', function () {
  T.state.manifests.gabinete = man.gabinete;
  var r = registro('gabinete', {});
  r.nombre_salida = 'MISMO/NOMBRE:*';
  assert.ok(T.problemasRegistro(r).length > 0);
  r.nombre_salida = '';
  assert.ok(T.problemasRegistro(r).length > 0);
  r.nombre_salida = 'GAB-800';
  assert.deepStrictEqual(T.problemasRegistro(r), []);
});

prueba('R-29 · un nombre repetido se numera en vez de sobrescribir', function () {
  T.state.registros = [{ id: 'a', nombre_salida: 'GAB-800-1div' },
                       { id: 'b', nombre_salida: 'GAB-800-1div-2' }];
  assert.strictEqual(T.nombreUnico('GAB-800-1div', 'c'), 'GAB-800-1div-3');
  assert.strictEqual(T.nombreUnico('GAB-800-1div', 'a'), 'GAB-800-1div');   // el propio no choca
  T.state.registros = [];
});

prueba('R-30 · el auto-nombre describe la configuración vigente', function () {
  var r = registro('gabinete', {});
  assert.strictEqual(T.autoNombre(man.gabinete, r.valores), 'GAB-800-1div');
  r.valores.LenX = '900';
  assert.strictEqual(T.autoNombre(man.gabinete, r.valores), 'GAB-900-1div');
});

// ---- barrido: ninguna combinación válida queda bloqueada -------------------
prueba('sin falsos positivos: todo diseño de puerta con medidas válidas genera', function () {
  var base = {
    gabinete:  {},
    alacena:   { LenX: '800', LenY: '350', LenZ: '700' },
    esquinero: { LenX: '900', LenY: '900', LenZ: '600', a0101profizq: '600', a0102profder: '600' }
  };
  Object.keys(base).forEach(function (fam) {
    var puerta = campo(fam, 'EstiloPuerta') || campo(fam, 'c25tipopuerta');
    puerta.opciones.forEach(function (o) {
      var cambios = Object.assign({}, base[fam]);
      cambios[puerta.id] = o.valor;
      var e = errores(fam, cambios);
      assert.strictEqual(e.length, 0, fam + ' con «' + o.label + '»: ' + JSON.stringify(e));
    });
    // y con la sección de divisores encendida
    var conDiv = Object.assign({ c24entrepano: '0', f01cantdiv: '3' }, base[fam]);
    assert.strictEqual(errores(fam, conDiv).length, 0, fam + ' con divisores: ' +
      JSON.stringify(errores(fam, conDiv)));
  });
});

// ---------------------------------------------------------------------------
console.log((corridas - fallos) + '/' + corridas + ' pruebas OK');
process.exit(fallos ? 1 : 0);
