# encoding: UTF-8
# =============================================================================
#  Royal Catalog Creator — Motor de inyección de atributos
# =============================================================================
#  Refactor del motor validado en script.rb (gm_interpret, buscar_componentes_hijos
#  y el bucle de inyección) a un módulo reutilizable. La UI del plugin aplana el
#  formulario a una "fila plana" { "prefijo>attr" => "800mm" } equivalente a una
#  fila del CSV, y este motor la inyecta en una copia del componente base.
# =============================================================================

require 'sketchup.rb'
require 'fileutils'

module RoyalKitchen
  module CatalogCreator
    module Engine

      DICT = 'dynamic_attributes'.freeze

      # Variables estándar de tamaño: se fijan como cadena nominal (bloqueo estructural).
      STANDARD_KEYS = %w[lenx leny lenz x y z].freeze

      module_function

      # ---------------------------------------------------------------------
      # Convierte un valor crudo del formulario/CSV a un valor listo para el
      # atributo dinámico. mm/cm/m/in -> pulgadas (unidad nativa de SketchUp).
      #   nil -> celda vacía (ignorar)
      #
      # La convención heredada de escribir «no» para omitir una variable se
      # retiró (DEV-21, R-24): era inalcanzable desde el formulario, donde el
      # campo concatena su unidad y producía "nomm".
      # ---------------------------------------------------------------------
      def interpret(raw)
        s = raw.to_s.strip
        return nil if s.empty?

        m = s.match(/\A(-?[\d.,]+)\s*(mm|cm|cms|m|in|"|pulg)?\z/i)
        if m
          num_str = m[1].tr(',', '.')
          num     = num_str.to_f
          unit    = (m[2] || '').downcase

          if unit.empty?
            return (num_str =~ /\A-?\d+\z/) ? num.to_i : num
          end

          inches = case unit
                   when 'mm'               then num / 25.4
                   when 'cm', 'cms'        then num / 2.54
                   when 'm'                then num * 39.3700787
                   when 'in', '"', 'pulg'  then num
                   end

          return inches.to_f
        end

        s
      end

      # ---------------------------------------------------------------------
      # Busca recursivamente instancias/grupos hijos cuyo nombre (instancia o
      # definición) contenga el prefijo buscado (puerta/estructura/divisor/cajon).
      # ---------------------------------------------------------------------
      def buscar_componentes_hijos(entidad, nombre_buscado, resultados = [])
        buscado = nombre_buscado.downcase.strip

        nombre_instancia  = entidad.name.to_s.downcase
        nombre_definicion = entidad.definition.name.to_s.downcase

        if nombre_instancia.include?(buscado) || nombre_definicion.include?(buscado)
          resultados << entidad
        end

        entidad.definition.entities.each do |hijo|
          if hijo.is_a?(Sketchup::ComponentInstance) || hijo.is_a?(Sketchup::Group)
            buscar_componentes_hijos(hijo, buscado, resultados)
          end
        end

        resultados
      end

      # ---------------------------------------------------------------------
      # Inyecta un atributo (col => valor) en una instancia raíz. Maneja el
      # split por '>' para atributos de piezas hijas. Devuelve un warning
      # (string) si la pieza hija no se encontró, o nil si todo bien.
      # ---------------------------------------------------------------------
      def inyectar_atributo(inst, col, valor_raw)
        valor_math = interpret(valor_raw)
        return nil if valor_math.nil?

        if col.include?('>')
          partes          = col.split('>')
          nombre_objetivo = partes[0]
          key             = partes[1].strip.downcase
          objetivos       = buscar_componentes_hijos(inst, nombre_objetivo)
          return "Pieza no encontrada: '#{nombre_objetivo}' para #{key}." if objetivos.empty?
        else
          key       = col.strip.downcase
          objetivos = [inst]
        end

        is_standard = STANDARD_KEYS.include?(key)

        # Un valor "=formula" (p.ej. el preset «Entrepaño» de un margen frontal)
        # no es una medida: es la fórmula nativa del componente, reinyectada a
        # propósito para no depender de que el .skp base la conserve intacta.
        es_formula = valor_math.is_a?(String) && valor_math.start_with?('=')

        objetivos.each do |target_inst|
          [target_inst, target_inst.definition].each do |ent|
            if es_formula
              ent.set_attribute(DICT, "_#{key}_formula", valor_math[1..-1])
              next
            end

            ent.delete_attribute(DICT, "_#{key}_formula") rescue nil
            ent.set_attribute(DICT, key, valor_math)

            if is_standard
              # Bloqueo estructural: fija la pulgada matemática como cadena nominal.
              ent.set_attribute(DICT, "_#{key}_nominal", valor_math.to_s)
            else
              # Variables secundarias: conservan el texto para la interfaz.
              ent.set_attribute(DICT, "_#{key}_nominal", valor_raw.to_s)
            end
          end
        end

        nil
      end

      # ---------------------------------------------------------------------
      # Borra las piezas que el componente dinámico dejó ocultas.
      #
      # El componente trae todas las variantes de puerta y cajón dentro y oculta
      # (hidden = 1) las que no aplican a la configuración; el .skp de salida se
      # llevaría decenas de componentes muertos. Aquí se eliminan.
      #
      # OJO con lo compartido: inst.make_unique solo independiza la definición
      # raíz. Las definiciones anidadas siguen siendo las mismas del componente
      # base y de las unidades ya insertadas en la escena, así que borrar dentro
      # de ellas las corrompería. Por eso cada hijo se hace único ANTES de tocar
      # su contenido.
      #
      # Devuelve la cantidad de piezas borradas.
      # ---------------------------------------------------------------------
      def eliminar_ocultos(inst)
        borradas = 0
        pila     = [inst.definition]

        until pila.empty?
          defn = pila.shift
          next unless defn.valid?

          # Se clasifica ANTES de borrar: después de erase_entities las
          # referencias a lo borrado (y a lo que arrastre) quedan inválidas.
          ocultos, contenedores = [], []
          defn.entities.to_a.each do |e|
            next unless e.respond_to?(:hidden?)
            if oculto?(e)
              ocultos << e
            elsif e.is_a?(Sketchup::ComponentInstance) || e.is_a?(Sketchup::Group)
              contenedores << e
            end
          end

          unless ocultos.empty?
            borradas += ocultos.size
            defn.entities.erase_entities(ocultos)
          end

          contenedores.each do |hijo|
            next unless hijo.valid?
            # Si la definición está compartida hay que independizarla antes de
            # entrar: si no, borrar aquí mutilaría el componente base y las
            # unidades ya insertadas en la escena.
            hijo.make_unique if hijo.definition.instances.size > 1
            pila << hijo.definition
          end
        end

        borradas
      end

      # ---------------------------------------------------------------------
      # Pone a cada división el nombre que ya resolvió la UI (Divisor/Entrepaño
      # según el modo elegido en su margen frontal). Aquí no se infiere nada: el
      # motor recibe la lista hecha y solo la aplica, en orden 1..n.
      #
      # Estructura confirmada por diagnóstico sobre GABINETE.skp (2026-07-29):
      #
      #   <unidad> > "DIA01 - ESPACIO 1 - DivisorHorizontal" > PanelXY#nn > Panel#nnn
      #
      #   - Cada división es una ComponentInstance hija directa del contenedor;
      #     la caja de referencia que vive ahí también es un Group, y por eso el
      #     filtro es por tipo y no por nombre.
      #   - Cada copia trae definición propia (instances.size == 1): el DC ya las
      #     independizó, así que no hace falta make_unique para nombrarlas por
      #     separado.
      #   - Salen ordenadas de abajo hacia arriba por z, que es justo el orden de
      #     los índices 1..n de g01margenf{i} (verificado cruzando el margen
      #     inyectado contra el desplazamiento en y de cada pieza).
      #
      # Se escribe SOLO el nombre de instancia: las definiciones se comparten con
      # el componente base y renombrarlas contaminaría otras unidades.
      #
      # Devuelve la lista de warnings (vacía si todo salió bien).
      # ---------------------------------------------------------------------
      def nombrar_divisores(inst, spec)
        nombres = Array(spec[:nombres])
        return [] if nombres.empty?

        contenedor = buscar_componentes_hijos(inst, spec[:prefijo].to_s)
                     .reject { |e| e == inst }   # la raíz puede matchear por su propio nombre
                     .first
        return ["Divisores: no se encontró la pieza '#{spec[:prefijo]}'."] if contenedor.nil?

        copias = contenedor.definition.entities
                           .grep(Sketchup::ComponentInstance)
                           .sort_by { |e| e.transformation.origin.z }

        warnings = []
        if copias.size != nombres.size
          warnings << "Divisores: se esperaban #{nombres.size} piezas y se encontraron #{copias.size}."
        end

        copias.each_with_index do |copia, i|
          break if i >= nombres.size
          hoja_de(copia).name = nombres[i]
        end

        warnings
      end

      # Baja al último objeto real de la copia, que es donde debe verse el nombre
      # en el Outliner. Solo se desciende mientras haya exactamente una instancia
      # hija: así se ignoran los grupos auxiliares (la caja de escalado que el
      # componente cuelga de cada pieza) y se para en cuanto hay ambigüedad.
      def hoja_de(ent)
        actual = ent
        10.times do            # tope de seguridad: el árbol real tiene 1 nivel
          hijos = actual.definition.entities.grep(Sketchup::ComponentInstance)
          break unless hijos.size == 1
          actual = hijos.first
        end
        actual
      end

      # ---------------------------------------------------------------------
      # Une las dos medias piezas de cada entrepaño en una sola.
      #
      # El esquinero modela cada repisa en L como dos prismas independientes, así
      # que el .skp de salida entregaba dos tableros donde debe haber una pieza.
      #
      # Estructura confirmada por diagnóstico sobre ESQUINERO.skp (2026-07-30):
      #
      #   <unidad> > Estructura > DIVISORES > PanelXY#nn > "ENTREPAÑO #n"
      #            > P01-ESQ#n + P02-ESQ#n + 4 grupos auxiliares sin caras
      #
      #   - No hace falta localizar el contenedor de repisas: el nodo "ENTREPAÑO"
      #     de cada copia ya agrupa las dos mitades, y buscarlo por prefijo los
      #     devuelve todos.
      #   - Cada mitad es un prisma cerrado (6 caras, 12 aristas) pero NO es
      #     `manifold?`: trae colgando un grupo «SPanel» de una cara, y SketchUp
      #     solo considera sólido lo que contiene únicamente caras y aristas. Por
      #     eso no se unen las piezas originales sino copias limpias de ellas.
      #   - El diagnóstico mostró instances.size == 1 en todo el camino, pero eso
      #     no basta para tocar la geometría: ver buscar_para_modificar.
      #
      # Devuelve la lista de warnings (vacía si todo salió bien).
      # ---------------------------------------------------------------------
      def unir_piezas(inst, spec)
        piezas = Array(spec[:piezas]).map(&:to_s)
        return [] if piezas.size < 2

        # Las Solid Tools son exclusivas de Pro. No es un error de generación:
        # el mueble sale bien, solo con las mitades sin fusionar.
        unless Sketchup.is_pro?
          return ['Unión de entrepaños: requiere SketchUp Pro (Solid Tools). Las mitades quedaron separadas.']
        end

        grupos = buscar_para_modificar(inst, spec[:grupo].to_s).reject { |e| e == inst }
        return ["Unión de entrepaños: no se encontró la pieza '#{spec[:grupo]}'."] if grupos.empty?

        warnings = []
        grupos.each_with_index do |grupo, i|
          next if oculto?(grupo)
          begin
            aviso = unir_mitades(grupo, piezas, spec[:nombre].to_s)
            warnings << "Entrepaño #{i + 1}: #{aviso}" if aviso
          rescue => e
            warnings << "Entrepaño #{i + 1}: #{e.message}"
          end
        end
        warnings
      end

      # Igual que buscar_componentes_hijos, pero independiza cada contenedor por
      # el que pasa. Es obligatorio cuando lo hallado se va a MODIFICAR: que una
      # definición tenga una sola instancia no prueba que sea exclusiva de esta
      # unidad — si alguna definición del camino está compartida con el
      # componente base, esa única instancia se dibuja también dentro del base y
      # de las unidades ya insertadas, y borrar ahí las mutila (mismo cuidado que
      # documenta eliminar_ocultos).
      #
      # No desciende debajo de lo que ya matcheó: lo de adentro se busca aparte,
      # y para entonces el contenedor ya es exclusivo.
      def buscar_para_modificar(entidad, nombre_buscado, resultados = [])
        buscado = nombre_buscado.downcase.strip

        if entidad.name.to_s.downcase.include?(buscado) ||
           entidad.definition.name.to_s.downcase.include?(buscado)
          resultados << entidad
          return resultados
        end

        entidad.definition.entities.to_a.each do |hijo|
          next unless hijo.is_a?(Sketchup::ComponentInstance) || hijo.is_a?(Sketchup::Group)
          hijo.make_unique if hijo.definition.instances.size > 1
          buscar_para_modificar(hijo, buscado, resultados)
        end

        resultados
      end

      # Une las mitades dentro de UN contenedor, que buscar_para_modificar ya
      # dejó independizado. Devuelve un warning o nil.
      def unir_mitades(grupo, piezas, nombre)
        mitades = piezas.map do |pref|
          buscar_componentes_hijos(grupo, pref).reject { |e| e == grupo || oculto?(e) }.first
        end
        # Sin ninguna mitad no es una repisa, no hay nada que unir ni que avisar.
        return nil if mitades.all?(&:nil?)
        return "no se encontró alguna de las mitades (#{piezas.join(', ')})." if mitades.any?(&:nil?)

        destino = grupo.definition.entities
        copias  = mitades.map { |m| copia_solida(m, destino) }

        aviso = nil
        if copias.any? { |c| !c.manifold? }
          aviso = 'alguna mitad no quedó como sólido cerrado; se dejaron separadas.'
        else
          union = copias[0].union(copias[1])
          if union.nil?
            aviso = 'la unión de las dos mitades falló; se dejaron separadas.'
          elsif union.parent != grupo.definition
            # Si el resultado no cae dentro del contenedor quedaría geometría
            # suelta en la escena. Se descarta: la unión consumió las copias, no
            # los originales, así que la repisa sigue completa.
            union.erase! if union.valid?
            aviso = 'la unión salió fuera del contenedor; se descartó y las mitades siguen separadas.'
          else
            union.name = nombre
            # Refuerzo del material: además de las caras, el grupo resultante
            # lleva el material a nivel de instancia como lo tenían las mitades,
            # para que repintarlo después se comporte igual que antes de unir.
            union.material = mitades[0].material if mitades[0].material
            mitades.each { |m| m.erase! if m.valid? }
          end
        end

        # Las copias sobreviven solo si la unión no llegó a consumirlas.
        copias.each { |c| c.erase! if c.valid? } if aviso
        aviso
      end

      # Copia de una pieza con solo su geometría cruda, que es lo que las Solid
      # Tools aceptan como sólido. Se re-inserta la definición ya transformada y
      # se explota dentro de un grupo nuevo; los contenedores anidados que trae
      # el panel (el grupo «SPanel») se borran de la copia, no del original.
      def copia_solida(pieza, destino)
        g   = destino.add_group
        tmp = g.entities.add_instance(pieza.definition, pieza.transformation)

        # El material de estos paneles vive en la INSTANCIA, no en las caras: una
        # instancia nueva de la misma definición nace sin él y la pieza fusionada
        # saldría en blanco. Al explotar, SketchUp lo baja a las caras que usan el
        # material por defecto, y la unión conserva materiales por cara.
        tmp.material = pieza.material if pieza.material
        tmp.explode

        g.entities.to_a.each do |e|
          next unless e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
          e.erase! if e.valid?
        end
        g
      end

      # Oculto = la bandera de SketchUp o el atributo dinámico `hidden` en 1.
      # Se revisa el atributo porque el redibujado del DC no siempre alcanza a
      # propagar la bandera a las piezas más anidadas.
      def oculto?(ent)
        return true if ent.hidden?
        v = ent.get_attribute(DICT, 'hidden')
        return false if v.nil?
        v.to_s.strip.downcase =~ /\A(1|1\.0|true|yes)\z/ ? true : false
      end

      # ---------------------------------------------------------------------
      # Genera una unidad a partir de una fila plana { col => valor_raw }.
      #
      #   base_def       : Sketchup::ComponentDefinition ya cargada (definitions.load)
      #   nombre_salida  : nombre del archivo .skp / de la instancia
      #   fila_plana     : Hash de { "prefijo>attr" => "800mm", ... }
      #   opts:
      #     :output_dir          -> carpeta destino del .skp (obligatorio para guardar)
      #     :insertar_en_escena  -> true conserva la instancia en el modelo (SCOPE §3.1)
      #     :transformation      -> Geom::Transformation para colocarla (auto-tiling)
      #     :limpiar_ocultos     -> borra las variantes ocultas (default true)
      #     :divisores           -> { prefijo:, nombres: } para nombrar las divisiones
      #     :union               -> { grupo:, piezas:, nombre: } para fusionar mitades
      #
      # Devuelve { ok:, ruta:, instancia:, warnings: [] }.
      # ---------------------------------------------------------------------
      def generar_unidad(base_def, nombre_salida, fila_plana, opts = {})
        model    = Sketchup.active_model
        warnings = []
        nombre   = nombre_salida.to_s.strip
        nombre   = 'modulo' if nombre.empty?

        model.start_operation("catalog_creator_gen_#{nombre}", true)

        begin
          tr   = opts[:transformation] || Geom::Transformation.new
          inst = model.entities.add_instance(base_def, tr)
          inst.make_unique
          inst.name = nombre

          fila_plana.each do |col, valor_raw|
            w = inyectar_atributo(inst, col, valor_raw)
            warnings << w if w
          end

          # Fuerza el redibujado del componente dinámico.
          begin
            $dc_observers.get_latest_class.redraw_with_undo(inst)
          rescue => e
            warnings << "Renderizado: #{e.message}"
          end

          # Después del redibujado, porque antes las copias no existen, y antes
          # de la limpieza y el guardado para que los nombres lleguen al .skp.
          if opts[:divisores]
            begin
              warnings.concat(nombrar_divisores(inst, opts[:divisores]))
            rescue => e
              warnings << "Nombrado de divisores: #{e.message}"
            end
          end

          # Después del nombrado y antes de la limpieza: la unión destruye la
          # estructura dinámica del entrepaño, así que va al final de todo lo que
          # depende del componente dinámico, y antes del guardado para que las
          # piezas fusionadas lleguen al .skp.
          if opts[:union]
            begin
              warnings.concat(unir_piezas(inst, opts[:union]))
            rescue => e
              warnings << "Unión de entrepaños: #{e.message}"
            end
          end

          # Después del redibujado (ya se sabe qué quedó oculto) y antes de
          # guardar. Deja el .skp como pieza final: el DC ya no puede volver a
          # mostrar lo borrado, por eso la UI lo expone como interruptor.
          limpiar = opts.key?(:limpiar_ocultos) ? opts[:limpiar_ocultos] : true
          if limpiar
            begin
              borradas = eliminar_ocultos(inst)
              warnings << "Se eliminaron #{borradas} piezas ocultas." if borradas > 0
            rescue => e
              warnings << "Limpieza de ocultos: #{e.message}"
            end
          end

          ruta = nil
          if opts[:output_dir]
            FileUtils.mkdir_p(opts[:output_dir])
            ruta = File.join(opts[:output_dir], "#{nombre}.skp")
            inst.definition.save_as(ruta)
          end

          # Salida doble (SCOPE §3.1): si no se inserta en escena, se borra la instancia.
          inst.erase! unless opts[:insertar_en_escena]

          # Al final: recoge tanto las definiciones que quedaron huérfanas por la
          # limpieza como las del árbol independizado si la instancia se borró.
          model.definitions.purge_unused if limpiar

          model.commit_operation
          { ok: true, ruta: ruta, instancia: (opts[:insertar_en_escena] ? inst : nil), warnings: warnings }
        rescue => e
          model.abort_operation
          { ok: false, error: e.message, warnings: warnings }
        end
      end

    end
  end
end
