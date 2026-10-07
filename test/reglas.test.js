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
// Gabinete por zonas (GABINETE-BASE-ZONAS). Por omisión: 600 × 578 × 770 mm de
// cuerpo + zoclo 100, tirador, 2 zonas: zona 1 puerta doble, zona 2 3 cajones.
// Fachada = 870 − 100 − 13 (margen sup. tirador) = 757 mm → zonas de 377 mm.

prueba('Z-01 · todo se escribe en el padre: ningún attr con «prefijo>»', function () {
  Object.keys(plano('gabinete', {})).forEach(function (k) {
    assert.ok(k.indexOf('>') < 0, 'attr de hijo en el gabinete: ' + k);
  });
});

prueba('Z-02 · con 1 zona no se inyecta nada de la zona 2', function () {
  var f = plano('gabinete', { d01_cantidad_zonas: '1' });
  Object.keys(f).forEach(function (k) {
    assert.ok(!/^d[34]\d_/.test(k), 'zona 2 con 1 zona: ' + k);
  });
  assert.ok(!('d02_alto_zona_superior' in f), 'el alto de zona superior no aplica con 1 zona');
});

prueba('Z-03 · la puerta y los cajones de una zona se excluyen', function () {
  var p = plano('gabinete', { d11_z1_contenido: '1' });
  assert.ok('d15_z1_cant_puertas' in p);
  assert.ok(!('d12_z1_cant_cajones' in p), 'zona 1 con puerta no lleva cajones');
  var c = plano('gabinete', { d11_z1_contenido: '2' });
  assert.ok('d12_z1_cant_cajones' in c);
  assert.ok(!('d15_z1_cant_puertas' in c), 'zona 1 con cajones no lleva puertas');
  var s = plano('gabinete', { d11_z1_contenido: '3' });
  ['d12_z1_cant_cajones', 'd15_z1_cant_puertas', 'd16_z1_tirador_tipo']
    .forEach(function (a) { assert.ok(!(a in s), 'sin frente no lleva ' + a); });
});

prueba('Z-04 · con gola no se inyecta ningún tirador; con tirador no hay gola', function () {
  var g = plano('gabinete', { b01_gola_o_tirador: '2', d32_z2_cant_cajones: '2' });
  ['d16_z1_tirador_tipo', 'd36_z2_tirador_tipo', 'e01_tirador_tipo', 'd17_z1_tirador_posicion', 'e04_tirador_largo']
    .forEach(function (a) { assert.ok(!(a in g), 'con gola no debería inyectarse ' + a); });
  assert.strictEqual(g['g01_perfil_tipo'], '1');
  var t = plano('gabinete', {});
  assert.ok(!('g01_perfil_tipo' in t), 'con tirador no hay perfil de gola');
  assert.strictEqual(t['d16_z1_tirador_tipo'], '9');
});

prueba('Z-05 · «Sin tirador» apaga posición, orientación y largo', function () {
  var f = plano('gabinete', { d16_z1_tirador_tipo: '1' });
  ['d17_z1_tirador_posicion', 'd18_z1_tirador_orientacion', 'd19_z1_tirador_largo']
    .forEach(function (a) { assert.ok(!(a in f), a + ' no debería inyectarse'); });
});

prueba('Z-06 · herraje de cajones solo si alguna zona lleva cajones', function () {
  var f = plano('gabinete', { d31_z2_contenido: '1' });            // puerta y puerta
  ['b02_tipo_cajon', 'e05_corredera_largo', 'e01_tirador_tipo']
    .forEach(function (a) { assert.ok(!(a in f), a + ' no debería inyectarse'); });
  assert.strictEqual(plano('gabinete', {})['b02_tipo_cajon'], '1');
});

prueba('Z-07 · entrepaños solo con alguna puerta; sus medidas solo con «Sí»', function () {
  var sinPuerta = plano('gabinete', { d11_z1_contenido: '2' });     // cajones y cajones
  assert.ok(!('h01_entrepano' in sinPuerta));
  var no = plano('gabinete', {});
  assert.strictEqual(no['h01_entrepano'], '1');
  assert.ok(!('h02_cantidad' in no));
  var si = plano('gabinete', { h01_entrepano: '0', h02_cantidad: '2' });
  assert.strictEqual(si['h02_cantidad'], '2');
  assert.ok(!('h11_espacio1_alto' in si), 'con separaciones iguales no se inyectan alturas');
});

prueba('Z-08 · LenZ y LenY llevan sumados el zoclo y el espesor de puerta', function () {
  var f = plano('gabinete', {});
  assert.strictEqual(f.LenZ, '870mm');
  assert.strictEqual(f.LenY, '600mm');
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
  [['alacena', 'c25tipopuerta'], ['esquinero', 'EstiloPuerta']]
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
  assert.ok(errores('gabinete', { c01_espesor_estructura: '0' }).length > 0);
  assert.strictEqual(errores('gabinete', { k02_margen_inferior: '0' }).length, 0, '0 mm de margen es válido');
});

prueba('R-09/R-22 · lo que no es una medida se rechaza en el campo', function () {
  ['ochocientos', '1e9', '12,5,7'].forEach(function (t) {
    assert.ok(errores('gabinete', { LenX: t }).length > 0, t + ' debería rechazarse');
  });
});

prueba('R-11 · los márgenes no pueden comerse el frente', function () {
  assert.ok(errores('gabinete', { LenX: '600', k03_margen_izquierdo: '400', k04_margen_derecho: '400' }).length > 0);
  assert.ok(errores('gabinete', { d02_alto_zona_superior: '900' }).length > 0, 'zona superior más alta que el cuerpo');
});

prueba('R-12 · un espesor no puede alcanzar la dimensión que atraviesa', function () {
  assert.ok(errores('gabinete', { c01_espesor_estructura: '999' }).length > 0);
  assert.ok(errores('gabinete', { c03_espesor_fondo: '600' }).length > 0);   // LenY = 578
});

prueba('R-13 · descartada: la cantidad de puertas no se acota contra el ancho', function () {
  assert.strictEqual(errores('gabinete', { LenX: '300', d15_z1_cant_puertas: '11' }).length, 0);
});

prueba('R-14 · los espacios de los divisores advierten, no bloquean', function () {
  var cambios = { LenX: '800', LenY: '350', LenZ: '700', c24entrepano: '0', f02tipomedida: '2', f01cantdiv: '3',
                  f03espacio1: '5000', f03espacio2: '5000', f03espacio3: '5000' };
  assert.strictEqual(errores('alacena', cambios).length, 0, 'no debe bloquear');
  var r = registro('alacena', cambios);
  assert.ok(T.avisosConfig(man.alacena, r.valores).length > 0, 'debe advertir');
});

prueba('R-15 · el séptimo espacio no existe en ningún manifiesto', function () {
  ['gabinete', 'alacena', 'esquinero'].forEach(function (f) {
    assert.strictEqual(campo(f, 'f03espacio7'), null, f + ' todavía declara f03espacio7');
  });
});

// ---- (c) presupuesto de cajones por zona ----------------------------------
prueba('C-01 · el alto de cada zona sigue las fórmulas del componente', function () {
  var r = registro('gabinete', {});
  assert.ok(Math.abs(T.altoZona(man.gabinete, r.valores, 1) - 377) < 0.01);
  assert.ok(Math.abs(T.altoZona(man.gabinete, r.valores, 2) - 377) < 0.01);
  var s = registro('gabinete', { d02_alto_zona_superior: '500' });
  assert.ok(Math.abs(T.altoZona(man.gabinete, s.valores, 2) - 254) < 0.01, '757 − 3 − 500');
  var u = registro('gabinete', { d01_cantidad_zonas: '1' });
  assert.ok(Math.abs(T.altoZona(man.gabinete, u.valores, 1) - 757) < 0.01, 'una zona = toda la fachada');
  var g = registro('gabinete', { b01_gola_o_tirador: '2' });
  assert.ok(Math.abs(T.altoZona(man.gabinete, g.valores, 1) - 345) < 0.01, 'gola: (870−100−40−40)/2');
});

prueba('C-02 · cajones iguales: bloquea por debajo del mínimo y topa el contador', function () {
  var ok = registro('gabinete', { d32_z2_cant_cajones: '3' });
  var p = T.presupuestoCajones(man.gabinete, ok.valores, 'z2');
  assert.ok(p.aplica && p.ok, JSON.stringify(p));
  assert.strictEqual(p.nMax, 3);
  assert.ok(errores('gabinete', { d32_z2_cant_cajones: '4' }).length > 0, '4 × 92 mm no cabe');
  assert.strictEqual(errores('gabinete', { d01_cantidad_zonas: '1', d11_z1_contenido: '2', d12_z1_cant_cajones: '6' }).length, 0,
                     '6 cajones en una sola zona sí caben');
});

prueba('C-03 · personalizado: el último cajón toma el resto y no baja del mínimo', function () {
  var base = { d33_z2_medida_cajones: '2', d32_z2_cant_cajones: '3' };
  assert.strictEqual(errores('gabinete', Object.assign({ d41_z2_cajon1_alto: '120' }, base)).length, 0);
  assert.ok(errores('gabinete', Object.assign({ d41_z2_cajon1_alto: '200' }, base)).length > 0,
            'al último le quedan 47 mm');
  assert.ok(errores('gabinete', Object.assign({ d41_z2_cajon1_alto: '80' }, base)).length > 0,
            'un cajón fijado bajo el mínimo');
  var r = registro('gabinete', Object.assign({ d41_z2_cajon1_alto: '120' }, base));
  var p = T.presupuestoCajones(man.gabinete, r.valores, 'z2');
  assert.strictEqual(p.altos.length, 3);
  assert.ok(Math.abs(p.altos.reduce(function (s, v) { return s + v; }, 0) - p.disponible) < 0.01);
});

prueba('C-04 · con gola van máximo 2 cajones por zona', function () {
  assert.strictEqual(errores('gabinete', { b01_gola_o_tirador: '2', d32_z2_cant_cajones: '2' }).length, 0);
  assert.ok(errores('gabinete', { b01_gola_o_tirador: '2', d32_z2_cant_cajones: '3' }).length > 0);
});

prueba('C-05 · una zona sin cajones no tiene presupuesto', function () {
  var r = registro('gabinete', {});
  assert.strictEqual(T.presupuestoCajones(man.gabinete, r.valores, 'z1').aplica, false);
  var u = registro('gabinete', { d01_cantidad_zonas: '1' });
  assert.strictEqual(T.presupuestoCajones(man.gabinete, u.valores, 'z2').aplica, false, 'zona 2 no existe con 1 zona');
});

// ---- (d) dependencias entre campos ----------------------------------------
prueba('R-19 · Alacena y Esquinero no tienen techo que medir', function () {
  assert.strictEqual(campo('alacena', 'e23ancamtecho'), null);
  assert.strictEqual(campo('esquinero', 'e23ancamtecho'), null);
});

prueba('R-20 · «Personalizado» exige todos los espacios visibles', function () {
  var dims = { LenX: '800', LenY: '350', LenZ: '700' };
  var e = errores('alacena', Object.assign({ c24entrepano: '0', f02tipomedida: '2', f01cantdiv: '2' }, dims));
  assert.strictEqual(e.length, 2, 'faltan los dos espacios: ' + JSON.stringify(e));
  assert.strictEqual(errores('alacena', Object.assign({ c24entrepano: '0', f02tipomedida: '1', f01cantdiv: '2' }, dims)).length, 0);
});

prueba('R-21 · la separación entre cajones nace en 3 mm (40 con gola)', function () {
  assert.strictEqual(campo('gabinete', 'k11_sep_cajones').default, '3');
  assert.strictEqual(campo('gabinete', 'k12_sep_cajones_gola').default, '40');
});

prueba('R-25 · la corredera nace en 50 cm', function () {
  assert.strictEqual(campo('gabinete', 'e05_corredera_largo').default, '510mm');
});

prueba('R-26 · el esquinero nombra sus divisiones; el gabinete ya no', function () {
  var div = T.nombresDivisores(man.esquinero, registro('esquinero', { c24entrepano: '0', f01cantdiv: '2' }));
  assert.deepStrictEqual(div, { prefijo: 'divisor', nombres: ['Entrepaño', 'Entrepaño'] });
  assert.strictEqual(T.nombresDivisores(man.gabinete, registro('gabinete', { h01_entrepano: '0' })), null);
});

// ---- (e) estados que impiden generar --------------------------------------
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
  var n = function (c) { return T.autoNombre(man.gabinete, registro('gabinete', c).valores); };
  assert.strictEqual(n({}), 'GAB-600-T-Z1P2-Z2C3');
  assert.strictEqual(n({ LenX: '900' }), 'GAB-900-T-Z1P2-Z2C3');
  assert.strictEqual(n({ d01_cantidad_zonas: '1' }), 'GAB-600-T-Z1P2', 'sin zona 2');
  assert.strictEqual(n({ d01_cantidad_zonas: '1', d11_z1_contenido: '3' }), 'GAB-600-T-Z1S');
  assert.strictEqual(n({ b01_gola_o_tirador: '2', g01_perfil_tipo: '2', d32_z2_cant_cajones: '2' }), 'GAB-600-GM-Z1P2-Z2C2');
  assert.strictEqual(n({ h01_entrepano: '0', b02_tipo_cajon: '2', d15_z1_cant_puertas: '1' }), 'GAB-600-T-Z1P1I-Z2C3-E-AN');
  // Alacena y esquinero conservan su patrón sin códigos.
  assert.strictEqual(T.autoNombre(man.esquinero, registro('esquinero', {}).valores).indexOf('ESQ'), 0);
});


// ---- (f) entrepaños y divisores (gráfico) ----------------------------------
// Cuerpo 770 − 2 × 18 = 734 mm de interior; repisas de 18 mm.
function geom(c) { var r = registro('gabinete', c); return T.geomEntrepanos(man.gabinete, r.valores, campoGrupo('entrepanos').visual); }
function campoGrupo(id) { return man.gabinete.grupos.filter(function (g) { return g.id === id; })[0]; }

prueba('E-01 · iguales: n repisas dejan n + 1 espacios iguales', function () {
  var G = geom({ h01_entrepano: '0', h02_cantidad: '2' });
  assert.strictEqual(G.espacios.length, 3);
  assert.ok(Math.abs(G.alto - 734) < 0.01);
  assert.ok(Math.abs(G.espacios[0] - (734 - 36) / 3) < 0.01);
  assert.ok(Math.abs(G.repisas[1].z - (2 * G.espacios[0] + 18)) < 0.01, 'repisa 2 sobre espacio 1 + repisa 1 + espacio 2');
});

prueba('E-02 · personalizado: los espacios en 0 se reparten el resto', function () {
  var G = geom({ h01_entrepano: '0', h02_cantidad: '2', h03_tipo_medida: '2', h11_espacio1_alto: '300' });
  assert.strictEqual(G.espacios[0], 300);
  assert.ok(Math.abs(G.espacios[1] - (734 - 36 - 300) / 2) < 0.01);
  assert.ok(Math.abs(G.exceso) < 0.01);
});

prueba('E-03 · divisor: retiro 0 y sin holgura; entrepaño: retiro y holgura', function () {
  var f = plano('gabinete', { h01_entrepano: '0', h02_cantidad: '2', h22_tipo: 'D', h21_entrepano1_retiro_fondo: '40' });
  assert.strictEqual(f.h21_entrepano1_retiro_fondo, '40mm');
  assert.strictEqual(f.h22_entrepano2_retiro_fondo, '0mm', 'el divisor se fuerza a 0');
  assert.strictEqual(f.h33_margen_izquierdo, '1.5mm', 'con algún entrepaño queda la holgura');
  var todos = plano('gabinete', { h01_entrepano: '0', h02_cantidad: '2', h21_tipo: 'D', h22_tipo: 'D' });
  assert.strictEqual(todos.h33_margen_izquierdo, '0mm');
  assert.strictEqual(todos.h34_margen_derecho, '0mm');
  // Un divisor de una repisa que no existe no cuenta.
  assert.strictEqual(plano('gabinete', { h01_entrepano: '0', h02_cantidad: '1', h22_tipo: 'E', h21_tipo: 'D' }).h33_margen_izquierdo, '0mm');
  var G = geom({ h01_entrepano: '0', h02_cantidad: '2', h22_tipo: 'D' });
  assert.ok(Math.abs(G.repisas[1].profundidad - G.prof) < 0.01, 'el divisor llega al frente');
  // Medido en SketchUp (2026-10-07): 578 − 12 (fondo) − 12 (ranura) = 554 para el divisor.
  assert.ok(Math.abs(G.prof - 554) < 0.01, 'profundidad interior real: ' + G.prof);
  assert.strictEqual(G.repisas[1].lateralIzq, 1.5, 'la holgura es global: el divisor también la lleva si hay entrepaños');
  assert.ok(Math.abs(G.repisas[0].profundidad - (G.prof - 26)) < 0.01, 'entrepaño con su retiro por omisión');
});

prueba('E-04 · el tipo es virtual: va en la plantilla, no al .skp', function () {
  var f = plano('gabinete', { h01_entrepano: '0', h02_cantidad: '3' });
  Object.keys(f).forEach(function (k) { assert.ok(!/^h2\d_tipo$/.test(k), 'no debería inyectarse ' + k); });
  assert.ok(campo('gabinete', 'h21_tipo').virtual);
});

prueba('E-05 · con n repisas se inyectan los n + 1 espacios en personalizado', function () {
  var f = plano('gabinete', { h01_entrepano: '0', h02_cantidad: '1', h03_tipo_medida: '2', h11_espacio1_alto: '200', h12_espacio2_alto: '0' });
  assert.strictEqual(f.h11_espacio1_alto, '200mm');
  assert.strictEqual(f.h12_espacio2_alto, '0mm', 'el espacio de arriba también viaja (si no, el .skp conserva el suyo)');
  assert.ok(!('h13_espacio3_alto' in f));
});

prueba('E-06 · espacios que se pasan del interior advierten, no bloquean', function () {
  var c = { h01_entrepano: '0', h02_cantidad: '2', h03_tipo_medida: '2', h11_espacio1_alto: '500', h12_espacio2_alto: '500' };
  assert.strictEqual(errores('gabinete', c).length, 0);
  var r = registro('gabinete', c);
  assert.ok(T.avisosConfig(man.gabinete, r.valores).join(' ').indexOf('se pasan') >= 0);
});

prueba('M-02 · todo campo tiene id y attr, y ningún id se repite', function () {
  ['gabinete', 'alacena', 'esquinero'].forEach(function (fam) {
    var vistos = {};
    man[fam].grupos.forEach(function (g) {
      g.campos.forEach(function (c) {
        assert.ok(c.id && c.attr, fam + ' · campo sin id/attr: ' + JSON.stringify(c).slice(0, 80));
        assert.ok(!vistos[c.id], fam + ' · id repetido: ' + c.id);
        vistos[c.id] = true;
      });
    });
  });
});

prueba('M-01 · todo select del manifiesto trae su lista de opciones', function () {
  ['gabinete', 'alacena', 'esquinero'].forEach(function (fam) {
    man[fam].grupos.forEach(function (g) {
      g.campos.forEach(function (c) {
        if (c.tipo === 'select') assert.ok(Array.isArray(c.opciones) && c.opciones.length > 0, fam + ' · ' + c.id + ' sin opciones');
      });
    });
  });
});

// ---- barrido: ninguna combinación válida queda bloqueada -------------------
prueba('sin falsos positivos: todo acomodo de zonas que cabe genera', function () {
  var contenidos = ['1', '2', '3'];
  [['1', '2'], ['2', '2']].forEach(function (sis) {          // tirador / gola
    var gola = sis[0] === '2';
    ['1', '2'].forEach(function (nz) {
      contenidos.forEach(function (c1) {
        contenidos.forEach(function (c2) {
          if (nz === '1' && c2 !== '1') return;
          var cambios = { b01_gola_o_tirador: sis[0], d01_cantidad_zonas: nz,
                          d11_z1_contenido: c1, d31_z2_contenido: c2,
                          d12_z1_cant_cajones: gola ? '2' : (nz === '1' ? '6' : '3'),
                          d32_z2_cant_cajones: gola ? '2' : '3' };
          var e = errores('gabinete', cambios);
          assert.strictEqual(e.length, 0, JSON.stringify(cambios) + ': ' + JSON.stringify(e));
        });
      });
    });
  });
  ['alacena', 'esquinero'].forEach(function (fam) {
    var base = fam === 'alacena' ? { LenX: '800', LenY: '350', LenZ: '700' }
                                 : { LenX: '900', LenY: '900', LenZ: '600', a0101profizq: '600', a0102profder: '600' };
    var puerta = campo(fam, 'EstiloPuerta') || campo(fam, 'c25tipopuerta');
    puerta.opciones.forEach(function (o) {
      var cambios = Object.assign({}, base);
      cambios[puerta.id] = o.valor;
      var e = errores(fam, cambios);
      assert.strictEqual(e.length, 0, fam + ' con «' + o.label + '»: ' + JSON.stringify(e));
    });
    var conDiv = Object.assign({ c24entrepano: '0', f01cantdiv: '3' }, base);
    assert.strictEqual(errores(fam, conDiv).length, 0, fam + ' con divisores: ' +
      JSON.stringify(errores(fam, conDiv)));
  });
});

// ---------------------------------------------------------------------------
console.log((corridas - fallos) + '/' + corridas + ' pruebas OK');
process.exit(fallos ? 1 : 0);
