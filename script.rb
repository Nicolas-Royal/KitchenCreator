# =============================================================================
#  generar_modulos_final.rb (Un solo archivo base + Múltiples Hijos + Regla "NO")
# =============================================================================

require 'sketchup.rb'
require 'csv'
require 'fileutils'

# ----------------------------- CONFIG ---------------------------------------
CSV_PATH            = "C:/Users/usuario/Documents/Royal-Kitchen-Tools/Catalog Creator/Gabinetes.csv"
OUTPUT_DIR          = "C:/Users/usuario/Documents/Royal-Kitchen-Tools/Catalog Creator/Output/Gabinetes"
BASE_COMPONENT_PATH = "C:/Users/usuario/Documents/Royal-Kitchen-Tools/Catalog Creator/Main Components/GabineteBase.skp"
NAME_COLUMN         = "nombre_salida"
DICT                = "dynamic_attributes"
# ----------------------------- CONFIG ---------------------------------------

def gm_detect_sep(path)
  line = File.foreach(path).first.to_s
  return "\t" if line.count("\t") > line.count(",")
  return ";"  if line.count(";")  > line.count(",")
  ","
end

def gm_interpret(raw)
  s = raw.to_s.strip
  return nil if s.empty?
  return :skip if s.downcase == "no"

  m = s.match(/\A(-?[\d.,]+)\s*(mm|cm|cms|m|in|"|pulg)?\z/i)
  if m
    num_str = m[1].tr(',', '.')
    num     = num_str.to_f
    unit    = (m[2] || "").downcase

    if unit.empty?
      return (num_str =~ /\A-?\d+\z/) ? num.to_i : num
    end

    inches = case unit
             when "mm"               then num / 25.4
             when "cm", "cms"        then num / 2.54
             when "m"                then num * 39.3700787
             when "in", "\"", "pulg" then num
             end

    return inches.to_f
  end

  s
end

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

def gm_generar
  model = Sketchup.active_model
  FileUtils.mkdir_p(OUTPUT_DIR)
  
  unless File.exist?(BASE_COMPONENT_PATH)
    UI.messagebox("No se encontró el componente base:\n#{BASE_COMPONENT_PATH}")
    return
  end

  begin
    base_def = model.definitions.load(BASE_COMPONENT_PATH)
  rescue => e
    UI.messagebox("Error al cargar el archivo base:\n#{e.message}")
    return
  end

  sep  = gm_detect_sep(CSV_PATH)
  rows = CSV.read(CSV_PATH, headers: true, col_sep: sep, encoding: "bom|utf-8")
  cols = rows.headers.compact.map(&:strip).reject { |c| c.empty? || c == NAME_COLUMN }

  puts "Variables a procesar: #{cols.join(', ')}"
  puts "Iniciando despliegue de #{rows.length} módulos...\n\n"

  rows.each_with_index do |row, i|
    nombre = (row[NAME_COLUMN] || "modulo_#{i + 1}").to_s.strip
    model.start_operation("gen_#{nombre}", true)

    inst = model.entities.add_instance(base_def, Geom::Transformation.new)
    inst.make_unique

    cols.each do |col|
      valor_raw = row[col].to_s.strip
      valor_math = gm_interpret(valor_raw)
      
      next if valor_math.nil? || valor_math == :skip

      objetivos = []

      if col.include?('>')
        partes = col.split('>')
        nombre_objetivo = partes[0]
        key = partes[1].strip.downcase
        
        objetivos = buscar_componentes_hijos(inst, nombre_objetivo)
        if objetivos.empty?
          puts "  [!] Pieza no encontrada: '#{nombre_objetivo}' para #{key}."
          next
        end
      else
        key = col.strip.downcase
        objetivos = [inst]
      end

      # INYECCIÓN ESTRUCTURAL SEPARADA
      is_standard = ["lenx", "leny", "lenz", "x", "y", "z"].include?(key)

      objetivos.each do |target_inst|
        target_defn = target_inst.definition
        [target_inst, target_defn].each do |ent|
          ent.delete_attribute(DICT, "_#{key}_formula") rescue nil
          ent.set_attribute(DICT, key, valor_math)
          
          if is_standard
            # Bloqueo estructural: se inyecta la pulgada matemática como cadena nominal
            ent.set_attribute(DICT, "_#{key}_nominal", valor_math.to_s)
          else
            # Variables secundarias: conservan el texto para la interfaz
            ent.set_attribute(DICT, "_#{key}_nominal", valor_raw)
          end
        end
      end
    end

    begin
      $dc_observers.get_latest_class.redraw_with_undo(inst)
    rescue => e
      puts "  [!] Error de renderizado: #{e.message}"
    end

    model.commit_operation

    inst.definition.save_as(File.join(OUTPUT_DIR, "#{nombre}.skp"))
    puts "[#{i + 1}/#{rows.length}] #{nombre}.skp -> Generado y escalado."

    inst.erase!
  end

  UI.messagebox("Procesamiento completado.")
end

gm_generar

=IF(parent!b03tipocajon=1,IF(n22altolatfront=0, ROUND((u01altocajon * 0.8808) - 5.735, 1), n22altolatfront),IF(n22altolatfront=0, ROUND((u01altocajon * 0.4301) + 0.2290, 1), n22altolatfront))
  