# encoding: UTF-8
# =============================================================================
#  DIAGNÓSTICO DE UN SOLO USO — entrepaños del Esquinero
# =============================================================================
#  No forma parte del plugin: es una sonda para responder lo que no se puede
#  contestar leyendo ESQUINERO.skp desde fuera de SketchUp, y de lo que depende
#  el punto 2 de Issues/prompt-30.md (unir las dos medias piezas de cada
#  entrepaño en una sola y nombrarla «Entrepaño»):
#
#    a) ¿Cuál es el contenedor de las repisas? La primera corrida descartó
#       «ENTREPANO» (0 nodos) y encontró «DIVISORES#1» + «Repisa copy 001». Por
#       eso este script YA NO pide el nombre del contenedor: parte de los
#       ENTREPAÑO y sube imprimiendo su cadena de ancestros, que es el dato que
#       fija el prefijo de `reglas_union` sin adivinar.
#    b) ¿Dónde está el SÓLIDO? union exige dos entidades manifold. Si P01-ESQ
#       trae colgando un grupo auxiliar de escalado no lo es, y hay que
#       descender al panel real (como hace Engine.hoja_de con los divisores).
#    c) ¿Las copias comparten definición? Si la comparten, unir dentro de una
#       mutila a las demás y al componente base: habría que make_unique antes.
#    d) ¿Qué está oculto? La unión corre ANTES de eliminar_ocultos, así que unir
#       una copia que el componente escondió la resucitaría.
#    e) ¿Dónde queda el resultado de union? Ese es el mayor riesgo de
#       implementar a ciegas: que la pieza unida aparezca en la raíz del modelo
#       en vez de dentro del mueble.
#
#  USO
#  ---
#  1. Genera un Esquinero con «Insertar en escena» activado, con 2-3 entrepaños,
#     con medidas reales capturadas (no lo dejes en blanco) y con «Eliminar
#     piezas ocultas» APAGADO: así se ve el estado tal como lo encuentra la
#     unión, que corre antes de la limpieza.
#  2. Selecciónalo en el modelo (o no selecciones nada: recorre todas las
#     instancias del nivel raíz).
#  3. Ventana > Consola Ruby:
#       load 'C:/Users/usuario/Documents/KitchenCreator/Issues/diag_entrepanos.rb'
#  4. Pega la salida completa.
#
#  El ensayo de unión corre dentro de start_operation + abort_operation: prueba
#  de verdad y deshace, no deja rastro en el modelo. Si aun así ves algo raro en
#  la escena, Ctrl+Z y no guardes.
# =============================================================================

module DiagEntrepanos

  DICT = 'dynamic_attributes'.freeze

  # Nodo que agrupa las dos medias piezas de una repisa. Es el ancla del
  # diagnóstico: de aquí se sube a los ancestros y se baja a las piezas.
  ANCLA  = 'entrepaño'.freeze
  PIEZAS = %w[p01-esq p02-esq].freeze

  # Sondas de nombre: cuántos nodos matcharía buscar_componentes_hijos con cada
  # una. Sirven para fijar los prefijos de `reglas_union` en datos.
  SONDAS = ['entrepano', 'entrepaño', 'p01-esq', 'p02-esq', 'divisor', 'repisa'].freeze

  module_function

  # Misma búsqueda que usa el motor, para diagnosticar lo que él vería. Se
  # reusa Engine si la extensión está cargada; si no, la copia local.
  def buscar(entidad, buscado, resultados = [])
    if defined?(RoyalKitchen::CatalogCreator::Engine)
      return RoyalKitchen::CatalogCreator::Engine.buscar_componentes_hijos(entidad, buscado, resultados)
    end
    b = buscado.downcase.strip
    if entidad.name.to_s.downcase.include?(b) || entidad.definition.name.to_s.downcase.include?(b)
      resultados << entidad
    end
    entidad.definition.entities.each do |h|
      buscar(h, b, resultados) if h.is_a?(Sketchup::ComponentInstance) || h.is_a?(Sketchup::Group)
    end
    resultados
  end

  def mm(pulgadas)
    (pulgadas.to_f * 25.4).round(1)
  end

  # Criterio EXACTO de Engine.oculto?: la bandera de SketchUp o el atributo del
  # DC valiendo 1. Ojo, `hidden = 0.0` es visible — la corrida anterior de este
  # script marcaba OCULTO por la mera presencia del atributo y era falso.
  def oculto?(ent)
    return true if ent.respond_to?(:hidden?) && ent.hidden?
    v = ent.get_attribute(DICT, 'hidden')
    return false if v.nil?
    !!(v.to_s.strip.downcase =~ /\A(1|1\.0|true|yes)\z/)
  end

  def marca_oculto(ent)
    v = ent.get_attribute(DICT, 'hidden')
    oculto?(ent) ? "  [OCULTO hidden=#{v.inspect}]" : ''
  end

  # manifold? = sólido cerrado; es el requisito de las Solid Tools.
  def solido?(ent)
    ent.respond_to?(:manifold?) && ent.manifold?
  end

  def etiqueta(ent)
    inst = ent.name.to_s.empty? ? '(sin nombre)' : ent.name.to_s
    tipo = ent.is_a?(Sketchup::Group) ? 'Group' : 'Comp '
    format('%s inst=%-22s def=%-22s inst_de_la_def=%-3d', tipo, inst,
           ent.definition.name.to_s, ent.definition.instances.size)
  end

  def detalle(ent)
    ents = ent.definition.entities
    o    = ent.transformation.origin
    format('caras=%-4d aristas=%-4d hijos=%-2d x=%-8s y=%-8s z=%-8s%s%s',
           ents.grep(Sketchup::Face).size, ents.grep(Sketchup::Edge).size,
           ents.grep(Sketchup::ComponentInstance).size + ents.grep(Sketchup::Group).size,
           mm(o.x).to_s, mm(o.y).to_s, mm(o.z).to_s,
           solido?(ent) ? '  <== SÓLIDO' : '', marca_oculto(ent))
  end

  # ---------------------------------------------------------------------------
  # Rutas (cadena de ancestros) hasta cada nodo que matchea el prefijo. Esto es
  # lo que responde "cuál es el contenedor": no hay que conocer su nombre de
  # antemano, sale impreso en la ruta.
  # ---------------------------------------------------------------------------
  def rutas(entidad, buscado, camino = [], acc = [])
    b = buscado.downcase.strip
    aqui = camino + [entidad]
    if entidad.name.to_s.downcase.include?(b) || entidad.definition.name.to_s.downcase.include?(b)
      acc << aqui
      return acc   # no se baja más: los nodos anidados del mismo nombre no aportan
    end
    entidad.definition.entities.each do |h|
      rutas(h, b, aqui, acc) if h.is_a?(Sketchup::ComponentInstance) || h.is_a?(Sketchup::Group)
    end
    acc
  end

  # Baja buscando el primer nodo sólido. Devuelve [nodo, ruta] o [nil, ruta] si
  # no aparece ninguno: eso significaría que la unión no se puede hacer sobre
  # esta pieza sin tocar la geometría antes.
  def nodo_solido(ent, ruta = [])
    ruta << (ent.name.to_s.empty? ? ent.definition.name.to_s : ent.name.to_s)
    return [ent, ruta] if solido?(ent)
    hijos = ent.definition.entities.grep(Sketchup::ComponentInstance) +
            ent.definition.entities.grep(Sketchup::Group)
    return [nil, ruta] if hijos.size != 1   # ambigüedad: se para y se reporta
    nodo_solido(hijos.first, ruta)
  end

  # Subárbol de un nodo, limitado en profundidad.
  def volcar(ent, prof, max_prof)
    return if prof > max_prof
    puts format('%s[%d] %s %s', '  ' * (prof + 3), prof, etiqueta(ent), detalle(ent))
    ent.definition.entities.each do |h|
      volcar(h, prof + 1, max_prof) if h.is_a?(Sketchup::ComponentInstance) || h.is_a?(Sketchup::Group)
    end
  end

  # ---------------------------------------------------------------------------
  # Ensayo de unión sobre UN entrepaño. Todo se imprime dentro de la operación,
  # porque después del abort las referencias a lo creado quedan inválidas.
  # ---------------------------------------------------------------------------
  def ensayo_union(ancla, model)
    puts '    ENSAYO DE UNIÓN:'

    partes = PIEZAS.map do |pref|
      hallados = buscar(ancla, pref).reject { |e| e == ancla }
      puts format('      prefijo %-9s -> %d nodo(s)%s', pref.inspect, hallados.size,
                  hallados.empty? ? '  *** NO ENCONTRADO ***' : '')
      hallados.first
    end
    return puts('      (no se puede ensayar: falta alguna de las dos piezas)') if partes.any?(&:nil?)

    solidos = partes.map do |p|
      nodo, ruta = nodo_solido(p)
      puts format('      %s -> sólido en %s%s', p.definition.name.to_s, ruta.join(' > '),
                  nodo ? '' : '  *** SIN NODO SÓLIDO ***')
      nodo
    end
    return puts('      (no se puede ensayar: alguna pieza no tiene nodo sólido)') if solidos.any?(&:nil?)

    padre_esperado = solidos[0].parent
    puts format('      padre esperado del resultado: %s', padre_esperado.inspect)

    model.start_operation('diag_entrepanos_ensayo', true)
    begin
      res = solidos[0].union(solidos[1])
      if res.nil?
        puts '      union -> nil  *** LA UNIÓN FALLÓ ***'
      else
        puts format('      union -> %s  nombre=%s  manifold=%s  caras=%d',
                    res.class, res.name.to_s.inspect, solido?(res),
                    res.definition.entities.grep(Sketchup::Face).size)
        puts format('      padre real = %s   ¿mismo padre? %s',
                    res.parent.inspect, (res.parent == padre_esperado))
      end
    rescue NotImplementedError => e
      puts "      union LANZÓ NotImplementedError (¿SketchUp Make?): #{e.message}"
    rescue => e
      puts "      union LANZÓ #{e.class}: #{e.message}"
    ensure
      model.abort_operation   # el ensayo no debe dejar rastro en el modelo
      puts '      (operación abortada: el modelo queda como estaba)'
    end
  end

  # ---------------------------------------------------------------------------
  def unidad(inst, max_prof, ensayar)
    model = Sketchup.active_model

    puts ''
    puts '=' * 110
    puts "UNIDAD: inst=#{inst.name.inspect}  def=#{inst.definition.name.inspect}"
    puts '=' * 110

    puts ''
    puts '--- SONDAS DE NOMBRE (lo que vería buscar_componentes_hijos) ---'
    SONDAS.each do |s|
      hallados = buscar(inst, s).reject { |e| e == inst }
      puts format('  %-12s -> %d nodo(s)', s.inspect, hallados.size)
      hallados.first(8).each { |e| puts format('        %s%s', etiqueta(e), marca_oculto(e)) }
      puts '        …' if hallados.size > 8
    end

    anclas = rutas(inst, ANCLA)
    if anclas.empty?
      puts ''
      puts "  (ningún nodo matchea #{ANCLA.inspect}: revisa las sondas de arriba)"
      return
    end

    anclas.each_with_index do |ruta, i|
      ancla = ruta.last
      puts ''
      puts format('--- ENTREPAÑO %d/%d ---', i + 1, anclas.size)
      puts '    CADENA DE ANCESTROS (el nivel 1 es el hijo directo de la unidad;'
      puts '    el contenedor de las repisas es el que tiene varias copias):'
      ruta.each_with_index do |e, n|
        next if n.zero?   # n=0 es la unidad misma, ya impresa arriba
        puts format('      %s%d. %s %s', '  ' * (n - 1), n, etiqueta(e), detalle(e))
      end

      puts '    SUBÁRBOL DEL ENTREPAÑO:'
      ancla.definition.entities.each do |h|
        volcar(h, 0, max_prof) if h.is_a?(Sketchup::ComponentInstance) || h.is_a?(Sketchup::Group)
      end

      # Basta ensayar el primero para saber si union funciona y dónde deja el
      # resultado; repetirlo en todos solo alargaría la salida.
      ensayo_union(ancla, model) if ensayar && i.zero?
    end
  end

  def run(max_prof = 3, ensayar = true)
    model = Sketchup.active_model
    sel   = model.selection.grep(Sketchup::ComponentInstance)
    objetivos = sel.empty? ? model.entities.grep(Sketchup::ComponentInstance) : sel

    puts ''
    puts "### DIAG ENTREPAÑOS — #{objetivos.size} unidad(es), profundidad máx #{max_prof}"
    puts "### (selección vacía = se recorre todo el nivel raíz del modelo)"
    puts "### SketchUp #{Sketchup.version}  is_pro?=#{Sketchup.is_pro?}  " \
         "(las Solid Tools que necesita `union` son exclusivas de Pro)"
    objetivos.each { |i| unidad(i, max_prof, ensayar) }
    puts ''
    puts '### FIN'
    nil
  end
end

DiagEntrepanos.run
