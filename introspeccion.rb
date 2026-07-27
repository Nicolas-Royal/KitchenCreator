# =============================================================================
#  introspeccion.rb  —  Volcado de metadatos de un componente dinámico
# -----------------------------------------------------------------------------
#  Objetivo: ver, por cada variable en cada nivel (raíz / hijo / nieto...),
#  su valor, etiquetas (_label / _formlabel), unidades (_units), visibilidad
#  (_access), opciones de lista (_options) y si tiene fórmula.
#
#  Uso:
#    1. Abre SketchUp (cualquier modelo).
#    2. Ventana > Consola Ruby.
#    3. Pega y ejecuta este archivo (o load 'ruta/introspeccion.rb').
#    4. Revisa la salida en consola Y en el archivo OUTPUT_TXT.
# =============================================================================

require 'sketchup.rb'
require 'fileutils'

# ----------------------------- CONFIG ---------------------------------------
# Cambia esta ruta para inspeccionar otro componente (ALACENA.skp, ESQUINERO.skp...)
BASE_COMPONENT_PATH = "C:/Users/usuario/Documents/Royal-Kitchen-Tools/Catalog Creator/Main Components/GABINETE.skp"
OUTPUT_TXT          = "C:/Users/usuario/Documents/Royal-Kitchen-Tools/Catalog Creator/introspeccion_dump.txt"
DICT                = "dynamic_attributes"
# ----------------------------------------------------------------------------

# Claves de metadato que acompañan a cada variable "foo": _foo_<sufijo>
META_SUFFIXES = %w[label formlabel units access options formula nominal formulaunits]

def in_meta_key?(key)
  key.to_s.start_with?("_")
end

# Devuelve los nombres de variable "reales" (los que NO empiezan con "_")
def variables_reales(dict)
  return [] if dict.nil?
  dict.keys.reject { |k| in_meta_key?(k) }
end

def leer_meta(dict, var)
  META_SUFFIXES.each_with_object({}) do |suf, h|
    v = dict["_#{var}_#{suf}"]
    h[suf] = v unless v.nil? || v.to_s.strip.empty?
  end
end

# Etiqueta legible de la entidad (instancia > definición)
def etiqueta_entidad(ent)
  nom_inst = ent.respond_to?(:name) ? ent.name.to_s : ""
  nom_def  = (ent.respond_to?(:definition) && ent.definition) ? ent.definition.name.to_s : ""
  return "#{nom_inst}  (def: #{nom_def})" unless nom_inst.empty?
  nom_def.empty? ? "(sin nombre)" : "(def: #{nom_def})"
end

def volcar_entidad(ent, ruta, prof, out)
  sangria = "  " * prof
  dict = ent.attribute_dictionary(DICT, false)
  vars = variables_reales(dict)

  encabezado = "#{sangria}[#{ruta}]  #{etiqueta_entidad(ent)}"
  out << encabezado
  puts encabezado

  if dict.nil?
    linea = "#{sangria}  (sin diccionario '#{DICT}')"
    out << linea; puts linea
  elsif vars.empty?
    linea = "#{sangria}  (diccionario presente pero sin variables de usuario)"
    out << linea; puts linea
  else
    vars.sort.each do |var|
      valor = dict[var]
      meta  = leer_meta(dict, var)

      access    = meta["access"]    || "(NONE/no def)"
      formlabel = meta["formlabel"] || "-"
      label     = meta["label"]     || "-"
      units     = meta["units"]     || "-"
      options   = meta["options"]   ? " | options: #{meta['options']}" : ""
      formula   = meta["formula"]   ? "  <FÓRMULA>" : ""

      linea = "#{sangria}  - #{var} = #{valor.inspect}#{formula}\n" \
              "#{sangria}      access=#{access}  units=#{units}\n" \
              "#{sangria}      label=#{label.inspect}  formlabel=#{formlabel.inspect}#{options}"
      out << linea
      puts linea
    end
  end

  # Recurse en hijos (componentes / grupos)
  hijos_def = ent.respond_to?(:definition) && ent.definition ? ent.definition.entities : nil
  return unless hijos_def

  idx = 0
  hijos_def.each do |hijo|
    if hijo.is_a?(Sketchup::ComponentInstance) || hijo.is_a?(Sketchup::Group)
      idx += 1
      volcar_entidad(hijo, "#{ruta} > #{idx}", prof + 1, out)
    end
  end
end

def introspeccionar
  unless File.exist?(BASE_COMPONENT_PATH)
    UI.messagebox("No se encontró el componente base:\n#{BASE_COMPONENT_PATH}")
    return
  end

  model = Sketchup.active_model
  begin
    base_def = model.definitions.load(BASE_COMPONENT_PATH)
  rescue => e
    UI.messagebox("Error al cargar el archivo base:\n#{e.message}")
    return
  end

  out = []
  out << "=" * 78
  out << "INTROSPECCIÓN DE COMPONENTE DINÁMICO"
  out << "Archivo: #{BASE_COMPONENT_PATH}"
  out << "Fecha:   #{Time.now}"
  out << "Leyenda: access = visibilidad en Component Options"
  out << "         (TEXTBOX=editable, LIST=desplegable, VIEW=solo lectura, NONE=oculta)"
  out << "=" * 78
  out << ""

  # Insertamos una instancia temporal para recorrer la jerarquía real
  model.start_operation("introspeccion", true)
  inst = model.entities.add_instance(base_def, Geom::Transformation.new)

  volcar_entidad(inst, "RAIZ", 0, out)

  inst.erase!
  model.commit_operation

  # --- Resumen ---
  out << ""
  out << "-" * 78
  out << "FIN. Revisa access=NONE (ocultas) vs TEXTBOX/LIST (candidatas a la UI)."
  out << "-" * 78

  texto = out.join("\n")
  File.write(OUTPUT_TXT, texto)
  puts "\n\n>>> Volcado guardado en:\n#{OUTPUT_TXT}"
  UI.messagebox("Introspección completada.\nGuardado en:\n#{OUTPUT_TXT}")
end

introspeccionar
