# encoding: UTF-8
# =============================================================================
#  DIAGNÓSTICO DE UN SOLO USO — árbol de los divisores/entrepaños
# =============================================================================
#  No forma parte del plugin: es una sonda para responder tres preguntas que no
#  se pueden contestar leyendo el .skp desde fuera de SketchUp, y de las que
#  depende el punto 1 de Issues/errors.md (nombrar cada copia Divisor/Entrepaño):
#
#    a) ¿Cuál es el nodo hoja real dentro de cada copia? (el grupo auxiliar
#       «Scale» cuelga de cada pieza y NO es el objetivo).
#    b) ¿Las copias comparten definición? Si la comparten, renombrar la hoja de
#       una las renombra todas y hay que make_unique cada copia antes.
#    c) ¿En qué orden salen las copias respecto a los índices 1..n de
#       g01margenf{i}? (la asunción a verificar es: copia 1 = la de abajo).
#
#  Además marca lo que está oculto, porque eliminar_ocultos corre DESPUÉS del
#  renombrado y se llevaría cualquier pieza que el componente haya escondido.
#
#  USO
#  ---
#  1. Genera una unidad con «Insertar en escena» activado y con varios
#     divisores (idealmente mezclando márgenes 0 y > 0, para distinguirlos).
#  2. Selecciónala en el modelo (o no selecciones nada: recorre todas las
#     instancias del nivel raíz).
#  3. Ventana > Consola Ruby:
#       load 'C:/Users/usuario/Documents/KitchenCreator/Issues/diag_divisores.rb'
#  4. Pega la salida completa.
# =============================================================================

module DiagDivisores

  DICT   = 'dynamic_attributes'.freeze
  PREFIJO = 'divisor'.freeze
  # Grupo auxiliar de escalado que el componente cuelga de cada pieza; se marca
  # en la salida para poder descartarlo al elegir el nodo hoja.
  AUX = %w[scale группа grupo].freeze

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

  # Oculto según el mismo criterio de Engine.oculto? (bandera o atributo del DC).
  def oculto(ent)
    banderas = []
    banderas << 'hidden?' if ent.respond_to?(:hidden?) && ent.hidden?
    v = ent.get_attribute(DICT, 'hidden')
    banderas << "attr=#{v}" unless v.nil?
    banderas.empty? ? '' : "  [OCULTO #{banderas.join(' ')}]"
  end

  def aux?(ent)
    n = (ent.name.to_s + ' ' + ent.definition.name.to_s).downcase
    AUX.any? { |a| n.include?(a) }
  end

  # Imprime el subárbol. `prof` es la profundidad relativa al contenedor.
  def volcar(ent, prof, max_prof)
    return if prof > max_prof
    o     = ent.transformation.origin
    tipo  = ent.is_a?(Sketchup::Group) ? 'Group' : 'Comp '
    hijos = ent.definition.entities.grep(Sketchup::ComponentInstance).size +
            ent.definition.entities.grep(Sketchup::Group).size

    marca = ''
    marca << '  <-- AUXILIAR (ignorar)' if aux?(ent)
    marca << '  <== HOJA (sin hijos contenedores)' if hijos.zero?

    puts format('%s[%d] %s inst=%-28s def=%-28s instancias_de_la_def=%-3d  x=%-9s y=%-9s z=%-9s  hijos=%d%s%s',
                '  ' * (prof + 2), prof, tipo,
                ent.name.to_s.empty? ? '(sin nombre)' : ent.name.to_s,
                ent.definition.name.to_s,
                ent.definition.instances.size,
                mm(o.x).to_s, mm(o.y).to_s, mm(o.z).to_s,
                hijos, oculto(ent), marca)

    ent.definition.entities.each do |h|
      volcar(h, prof + 1, max_prof) if h.is_a?(Sketchup::ComponentInstance) || h.is_a?(Sketchup::Group)
    end
  end

  def unidad(inst, max_prof)
    puts ''
    puts '=' * 100
    puts "UNIDAD: inst=#{inst.name.inspect}  def=#{inst.definition.name.inspect}"

    # Atributos que decidieron el reparto, para poder cruzar copias contra índices.
    cont = buscar(inst, PREFIJO).reject { |e| e == inst }
    puts "Contenedores que matchean #{PREFIJO.inspect}: #{cont.size}"
    puts '=' * 100

    if cont.empty?
      puts '  (ninguno — revisa que la unidad tenga divisores)'
      return
    end

    cont.each_with_index do |c, i|
      o = c.transformation.origin
      puts ''
      puts format('--- CONTENEDOR %d/%d --- inst=%s  def=%s  instancias_de_la_def=%d  z=%s mm%s',
                  i + 1, cont.size, c.name.to_s.inspect, c.definition.name.to_s.inspect,
                  c.definition.instances.size, mm(o.z).to_s, oculto(c))

      # Los atributos del contenedor dicen cuántas copias pidió el DC y con qué
      # márgenes: es el enlace entre los índices 1..n de la UI y lo que se ve.
      %w[copies f01cantdiv f02tipomedida
         g01margenf1 g01margenf2 g01margenf3 g01margenf4 g01margenf5 g01margenf6].each do |k|
        v = c.get_attribute(DICT, k)
        f = c.get_attribute(DICT, "_#{k}_formula")
        next if v.nil? && f.nil?
        puts format('      %-14s valor=%-12s formula=%s', k, v.inspect, f.inspect)
      end

      puts '    ÁRBOL:'
      c.definition.entities.each do |h|
        volcar(h, 0, max_prof) if h.is_a?(Sketchup::ComponentInstance) || h.is_a?(Sketchup::Group)
      end
    end
  end

  def run(max_prof = 4)
    model = Sketchup.active_model
    sel   = model.selection.grep(Sketchup::ComponentInstance)
    objetivos = sel.empty? ? model.entities.grep(Sketchup::ComponentInstance) : sel

    puts ''
    puts "### DIAG DIVISORES — #{objetivos.size} unidad(es), profundidad máx #{max_prof}"
    puts "### (selección vacía = se recorre todo el nivel raíz del modelo)"
    objetivos.each { |i| unidad(i, max_prof) }
    puts ''
    puts '### FIN'
    nil
  end
end

DiagDivisores.run
