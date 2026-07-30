# encoding: UTF-8
# =============================================================================
#  DIAGNÓSTICO DE UN SOLO USO — dónde se pierden los entrepaños al unir
# =============================================================================
#  Tras entregar la unión de mitades aparecieron tres fallas en Esquinero:
#  la cantidad de entrepaños queda en 1 (antes sí respondía), los márgenes del
#  entrepaño no se aplican, y las piezas unidas salen sin material.
#
#  El material ya está corregido en engine.rb (el material vive en la INSTANCIA
#  y la copia nacía sin él). Este script ataca los otros dos.
#
#  Hay CUATRO candidatas para la pérdida de copias y probarlas una por una son
#  cuatro ciclos de empaquetar → instalar → reiniciar. Este script las separa en
#  una sola corrida porque reejecuta el flujo real de generar_unidad llamando a
#  las funciones del Engine, y cuenta los entrepaños entre etapa y etapa:
#
#     cae tras redraw                 -> el componente nunca creó las copias
#     cae tras buscar_para_modificar  -> la cascada de make_unique las colapsa
#     cae tras unir_piezas            -> la unión misma
#     cae tras eliminar_ocultos       -> la limpieza se lleva lo que quedó
#     cae tras commit_operation       -> las Solid Tools rompen la transacción
#
#  Esa última es la sospechosa principal: `union` abre y cierra su propia
#  operación de modelo, y llamarla dentro de la operación de generar_unidad
#  puede cerrar la externa antes de tiempo. Encaja con lo observado — la unión se
#  ve bien pero lo demás se pierde. Por eso el flujo corre DOS veces: envuelto en
#  start_operation (como en producción) y sin envolver.
#
#  De paso vuelca los atributos dinámicos con su fórmula del subárbol de
#  divisores, para ver dónde viven de verdad `copies`, `f01cantdiv` y
#  `e31_marg1..e34_marg4` y resolver el síntoma de los márgenes en la misma
#  corrida. Es lo que hace introspeccion.rb, pero acotado: el volcado completo
#  son 2 MB impegables.
#
#  USO
#  ---
#  1. Ten instalada la extensión (usa su Engine) y un modelo abierto, mejor
#     vacío: el script inserta y borra sus propias unidades de prueba.
#  2. Ventana > Consola Ruby:
#       load 'C:/Users/usuario/Documents/KitchenCreator/Issues/diag_union.rb'
#  3. Pega la salida completa.
#
#  Si algo queda en la escena al terminar, Ctrl+Z y no guardes.
# =============================================================================

module DiagUnion

  RAIZ  = 'C:/Users/usuario/Documents/KitchenCreator'.freeze
  BASE  = File.join(RAIZ, 'Main Components', 'ESQUINERO.skp').freeze
  DICT  = 'dynamic_attributes'.freeze

  ANCLA  = 'entrepaño'.freeze
  PIEZAS = %w[p01-esq p02-esq].freeze
  NOMBRE = 'Entrepaño'.freeze

  # Se piden 3 divisores y márgenes DISTINTOS entre sí: si alguno se aplica, se
  # sabrá cuál por su medida, y si ninguno se mueve queda claro que el atributo
  # no está llegando al nodo que lo lee.
  FILA = {
    'LenX'                => '900mm',
    'LenY'                => '900mm',
    'LenZ'                => '700mm',
    'a0101profizq'        => '500mm',
    'a0102profder'        => '500mm',
    'divisor>f01cantdiv'  => '3',
    'divisor>e31_marg1'   => '11mm',
    'divisor>e32_marg2'   => '22mm',
    'divisor>e33_marg3'   => '33mm',
    'divisor>e34_marg4'   => '44mm'
  }.freeze

  # Variables que interesan de la raíz; volcarla entera son cientos de líneas.
  FILTRO_RAIZ = /cantdiv|marg|espacio|copies|prof|entrepan/i

  module_function

  def engine
    RoyalKitchen::CatalogCreator::Engine
  end

  def mm(pulgadas)
    (pulgadas.to_f * 25.4).round(1)
  end

  def nombre_de(ent)
    n = ent.name.to_s
    n.empty? ? "(def #{ent.definition.name})" : n
  end

  def material_de(ent)
    m = ent.material
    m ? m.name : '(sin material)'
  end

  # ---------------------------------------------------------------------------
  # Conteos. Se separan por tipo porque tras la unión el grupo resultante se
  # llama «Entrepaño» y también matchearía una búsqueda por nombre: contarlos
  # juntos daría un número inflado que no dice nada.
  # ---------------------------------------------------------------------------
  def contenedores(inst)
    engine.buscar_componentes_hijos(inst, ANCLA)
          .reject { |e| e == inst }
          .select { |e| e.is_a?(Sketchup::ComponentInstance) }
  end

  def unidos(inst)
    engine.buscar_componentes_hijos(inst, ANCLA)
          .reject { |e| e == inst }
          .select { |e| e.is_a?(Sketchup::Group) }
  end

  def mitades_sueltas(inst)
    PIEZAS.map { |p| engine.buscar_componentes_hijos(inst, p).reject { |e| e == inst }.size }
  end

  def etapa(titulo, inst)
    unless inst.valid?
      puts format('    %-32s *** LA UNIDAD YA NO ES VÁLIDA ***', titulo)
      return
    end
    c = contenedores(inst)
    u = unidos(inst)
    puts format('    %-32s contenedores=%-3d unidos=%-3d mitades=%s',
                titulo, c.size, u.size, mitades_sueltas(inst).inspect)
  end

  # ---------------------------------------------------------------------------
  # Volcado de atributos dinámicos con su fórmula: es lo único que dice dónde
  # vive de verdad cada variable y qué la calcula.
  # ---------------------------------------------------------------------------
  def volcar_attrs(ent, etiqueta, filtro = nil)
    d = ent.attribute_dictionary(DICT, false)
    if d.nil?
      puts "    #{etiqueta}: (sin diccionario '#{DICT}')"
      return
    end
    reales = d.keys.reject { |k| k.to_s.start_with?('_') }
    reales = reales.select { |k| k.to_s =~ filtro } if filtro
    puts "    #{etiqueta}  (#{reales.size} variables#{filtro ? ' que pasan el filtro' : ''})"
    reales.sort.each do |k|
      f = d["_#{k}_formula"]
      puts format('        %-20s = %-16s%s', k, d[k].inspect, f ? "  <FÓRMULA: #{f}>" : '')
    end
  end

  def volcar_subarbol(inst)
    puts ''
    puts '--- ATRIBUTOS DEL SUBÁRBOL DE DIVISORES ---'

    volcar_attrs(inst, "RAÍZ  #{nombre_de(inst)}", FILTRO_RAIZ)

    divs = engine.buscar_componentes_hijos(inst, 'divisor').reject { |e| e == inst }
    puts "    (nodos que matchean \"divisor\": #{divs.size})"
    divs.each_with_index do |d, i|
      puts ''
      volcar_attrs(d, "DIVISOR #{i + 1}  #{nombre_de(d)}")

      # Las repisas son las instancias hijas del contenedor; el que lleva
      # `copies` es el que genera las demás, y ahí es donde hay que mirar.
      hijas = d.definition.entities.grep(Sketchup::ComponentInstance)
      puts "        (instancias hijas del contenedor: #{hijas.size})"
      hijas.first(2).each_with_index do |h, j|
        o = h.transformation.origin
        puts ''
        volcar_attrs(h, "  REPISA #{j + 1}  #{nombre_de(h)}  z=#{mm(o.z)}mm")
      end
    end

    conts = contenedores(inst)
    conts.first(1).each do |c|
      puts ''
      volcar_attrs(c, "ENTREPAÑO  #{nombre_de(c)}")
      PIEZAS.each do |p|
        mitad = engine.buscar_componentes_hijos(c, p).reject { |e| e == c }.first
        next if mitad.nil?
        puts ''
        volcar_attrs(mitad, "  MITAD #{nombre_de(mitad)}  material=#{material_de(mitad)}")
      end
    end
  end

  # ---------------------------------------------------------------------------
  # Una corrida completa del flujo de generar_unidad, midiendo entre etapas.
  # ---------------------------------------------------------------------------
  def corrida(envuelto, volcar)
    model = Sketchup.active_model

    puts ''
    puts '=' * 100
    puts "CORRIDA #{envuelto ? 'ENVUELTA en start_operation (como en producción)' : 'SIN operación envolvente'}"
    puts '=' * 100

    base_def = model.definitions.load(BASE)
    model.start_operation("diag_union_#{envuelto ? 'op' : 'sinop'}", true) if envuelto

    inst = model.entities.add_instance(base_def, Geom::Transformation.new)
    inst.make_unique
    inst.name = "DIAG-#{envuelto ? 'OP' : 'SINOP'}"

    FILA.each do |col, val|
      w = engine.inyectar_atributo(inst, col, val)
      puts "    AVISO de inyección: #{w}" if w
    end
    etapa('tras inyectar', inst)

    begin
      $dc_observers.get_latest_class.redraw_with_undo(inst)
    rescue => e
      puts "    redraw LANZÓ: #{e.class}: #{e.message}"
    end
    etapa('tras redraw', inst)

    volcar_subarbol(inst) if volcar

    hallados = engine.buscar_para_modificar(inst, ANCLA).reject { |e| e == inst }
    puts format('    %-32s devolvió=%d', 'buscar_para_modificar', hallados.size)
    etapa('tras buscar_para_modificar', inst)

    avisos = engine.unir_piezas(inst, grupo: ANCLA, piezas: PIEZAS, nombre: NOMBRE)
    avisos.each { |a| puts "    AVISO de unión: #{a}" }
    etapa('tras unir_piezas', inst)
    unidos(inst).each_with_index do |u, i|
      puts format('        unido %d: nombre=%-12s material=%-20s caras=%d',
                  i + 1, u.name.to_s.inspect, material_de(u),
                  u.definition.entities.grep(Sketchup::Face).size)
    end

    borradas = engine.eliminar_ocultos(inst)
    puts format('    %-32s borró=%d piezas ocultas', 'eliminar_ocultos', borradas)
    etapa('tras eliminar_ocultos', inst)

    if envuelto
      model.commit_operation
      # LA MEDICIÓN CLAVE: si el conteo cae aquí, la operación de las Solid Tools
      # rompió la transacción y se revirtió lo hecho después de la unión.
      etapa('tras commit_operation', inst)
    end

    inst.erase! if inst.valid?
    model.definitions.purge_unused
  rescue => e
    puts "    *** LA CORRIDA ABORTÓ: #{e.class}: #{e.message}"
    puts e.backtrace.first(5).map { |l| "        #{l}" }
    model.abort_operation if envuelto
  end

  def run
    puts ''
    puts "### DIAG UNIÓN — SketchUp #{Sketchup.version}  is_pro?=#{Sketchup.is_pro?}"

    unless defined?(RoyalKitchen::CatalogCreator::Engine)
      puts '### La extensión no está cargada: instala el .rbz y reinicia SketchUp.'
      return nil
    end
    unless File.exist?(BASE)
      puts "### No se encontró el componente base: #{BASE}"
      return nil
    end

    puts "### Fila inyectada: #{FILA.inspect}"
    puts '### Se esperan 3 (o 4) entrepaños; «contenedores» es el número real de repisas.'

    corrida(true, true)    # como en producción, con volcado de atributos
    corrida(false, false)  # misma secuencia sin operación envolvente

    puts ''
    puts '### FIN'
    nil
  end
end

DiagUnion.run
