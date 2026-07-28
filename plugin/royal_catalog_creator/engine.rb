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
      #   nil   -> celda vacía (ignorar)
      #   :skip -> "no" (omitir explícitamente esta variable)
      # ---------------------------------------------------------------------
      def interpret(raw)
        s = raw.to_s.strip
        return nil   if s.empty?
        return :skip if s.downcase == 'no'

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
        return nil if valor_math.nil? || valor_math == :skip

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

        objetivos.each do |target_inst|
          [target_inst, target_inst.definition].each do |ent|
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
