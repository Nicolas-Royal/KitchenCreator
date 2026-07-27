# encoding: UTF-8
# =============================================================================
#  Royal Catalog Creator — Diálogo principal (UI::HtmlDialog) y callbacks
# =============================================================================

require 'sketchup.rb'
require 'json'

module RoyalKitchen
  module CatalogCreator

    require File.join(__dir__, 'engine')

    # -- Configuración ------------------------------------------------------
    PREF_SECTION = 'RoyalCatalogCreator'.freeze
    HTML_DIR     = File.join(__dir__, 'html').freeze
    MANIFEST_DIR = File.join(__dir__, 'manifest').freeze

    # Familias declaradas. Las tres tienen manifiesto (manifest/<familia>.json)
    # y se muestran activas en el selector.
    FAMILIAS = [
      { 'id' => 'gabinete',  'titulo' => 'Gabinete',  'activo' => true },
      { 'id' => 'alacena',   'titulo' => 'Alacena',   'activo' => true },
      { 'id' => 'esquinero', 'titulo' => 'Esquinero', 'activo' => true }
    ].freeze

    @dialog    = nil
    @cursor_x  = 0.0 # cursor de auto-tiling (pulgadas) para "insertar en escena"

    module_function

    # -----------------------------------------------------------------------
    # Raíz del proyecto (donde viven Main Components/ y Output/).
    # Se guarda como preferencia; si no está o es inválida, se adivina desde
    # la ubicación del plugin y, si aún no aparece Main Components, se pregunta.
    # -----------------------------------------------------------------------
    def project_root
      guardada = Sketchup.read_default(PREF_SECTION, 'project_root', nil)
      return guardada if guardada && File.directory?(File.join(guardada, 'Main Components'))

      adivinada = File.expand_path('..', __dir__)             # .../Catalog Creator/plugin
      adivinada = File.expand_path('..', adivinada)           # .../Catalog Creator
      return adivinada if File.directory?(File.join(adivinada, 'Main Components'))

      guardada || adivinada
    end

    def project_root_valido?
      File.directory?(File.join(project_root, 'Main Components'))
    end

    def configurar_project_root
      dir = UI.select_directory(
        title: 'Selecciona la carpeta del proyecto (contiene "Main Components")',
        directory: project_root
      )
      return nil unless dir
      unless File.directory?(File.join(dir, 'Main Components'))
        UI.messagebox("La carpeta seleccionada no contiene «Main Components».\n#{dir}")
        return nil
      end
      Sketchup.write_default(PREF_SECTION, 'project_root', dir)
      dir
    end

    # -----------------------------------------------------------------------
    # Diálogo
    # -----------------------------------------------------------------------
    def mostrar_dialogo
      if @dialog && @dialog.visible?
        @dialog.bring_to_front
        return
      end

      @cursor_x = 0.0
      @dialog = UI::HtmlDialog.new(
        dialog_title:    'Royal Catalog Creator',
        preferences_key: 'com.royalkitchens.catalog_creator',
        scrollable:      true,
        resizable:       true,
        width:           1040,
        height:          760,
        min_width:       760,
        min_height:      520,
        style:           UI::HtmlDialog::STYLE_DIALOG
      )
      @dialog.set_file(File.join(HTML_DIR, 'dialog.html'))
      registrar_callbacks(@dialog)
      @dialog.show
    end

    def registrar_callbacks(dialog)
      dialog.add_action_callback('sync') do |_ctx|
        responder(dialog, 'onSync', {
          'familias'     => FAMILIAS,
          'project_root' => project_root,
          'root_valido'  => project_root_valido?
        })
      end

      dialog.add_action_callback('get_manifest') do |_ctx, familia|
        responder(dialog, 'onManifest', cargar_manifest(familia))
      end

      dialog.add_action_callback('elegir_carpeta') do |_ctx|
        configurar_project_root
        responder(dialog, 'onSync', {
          'familias'     => FAMILIAS,
          'project_root' => project_root,
          'root_valido'  => project_root_valido?
        })
      end

      dialog.add_action_callback('generar') do |_ctx, payload_json|
        responder(dialog, 'onGenerar', generar(payload_json))
      end
    end

    # Envía un objeto Ruby de vuelta a la UI como argumento de window.CC.<fn>.
    def responder(dialog, fn, obj)
      json = JSON.generate(obj)
      dialog.execute_script("window.CC && window.CC.#{fn}(#{json});")
    end

    # -----------------------------------------------------------------------
    # Manifiesto: lee manifest/<familia>.json y resuelve rutas a absolutas.
    # -----------------------------------------------------------------------
    def cargar_manifest(familia)
      fam  = familia.to_s.gsub(/[^a-z0-9_]/i, '')
      ruta = File.join(MANIFEST_DIR, "#{fam}.json")
      return { 'ok' => false, 'error' => "No hay manifiesto para «#{familia}»." } unless File.exist?(ruta)

      data = JSON.parse(File.read(ruta, encoding: 'bom|utf-8'))
      data['componente_base_abs'] = File.join(project_root, data['componente_base'].to_s)
      data['salida_dir_abs']      = File.join(project_root, data['salida_dir'].to_s)
      { 'ok' => true, 'manifest' => data }
    rescue => e
      { 'ok' => false, 'error' => e.message }
    end

    # -----------------------------------------------------------------------
    # Presupuesto de alto de cajones — espejo en Ruby del cálculo de app.js.
    #
    # La fórmula del componente reparte el alto en partes iguales pero no tiene
    # piso: si el reparto cae bajo el alto físico mínimo del cajón, recorta y la
    # pila traspasa el mueble (errores 1 y 2 de Issues/errors.md). La UI ya lo
    # bloquea; esto atrapa payloads que no pasaron por ella.
    #
    # Devuelve el mensaje de error, o nil si la configuración cabe.
    # -----------------------------------------------------------------------
    TOL_IN = 1.0 / 25.4   # 1 mm de tolerancia, en pulgadas

    # Medida de un attr de la fila plana, en pulgadas. nil si no viene o no es número.
    def medida_in(valores, attr)
      return nil unless valores.key?(attr)
      v = Engine.interpret(valores[attr])
      v.is_a?(Numeric) ? v.to_f : nil
    end

    def a_mm(pulgadas)
      (pulgadas * 25.4).round(1)
    end

    def cajones_efectivos(reglas, valores)
      mapa   = reglas['estilos_con_cajones'] || {}
      estilo = valores[reglas['attr_estilo_puerta']].to_s
      return 0 unless mapa.key?(estilo)
      mapa[estilo] == 'n' ? valores[reglas['attr_cantidad']].to_i : mapa[estilo].to_i
    end

    def validar_cajones(manifest, valores)
      reglas = manifest['reglas_cajones']
      return nil unless reglas

      n = cajones_efectivos(reglas, valores)
      return nil if n < 1

      util = medida_in(valores, reglas['attr_alto_util'])
      return nil if util.nil?
      Array(reglas['attr_restar']).each do |attr|
        v = medida_in(valores, attr)
        util -= v if v
      end

      sep      = medida_in(valores, reglas['attr_separacion']) || 0.0
      alto_min = reglas['alto_min_mm'].to_f / 25.4
      minimo   = reglas['alto_min_mm']
      disp     = util - sep * (n - 1)

      return "El alto útil del mueble quedó en #{a_mm(util)} mm. Revisa alto, zócalo y márgenes." if disp <= 0

      altos    = Array(reglas['attrs_alto']).first(n).map { |attr| medida_in(valores, attr) }
      fijos    = altos.compact
      libres   = n - fijos.size
      restante = disp - fijos.inject(0.0) { |s, v| s + v }

      bajo = fijos.find { |v| v < alto_min - TOL_IN }
      return "El alto de un cajón (#{a_mm(bajo)} mm) es menor al mínimo de #{minimo} mm." if bajo

      # Solo se bloquea lo que se PASA; que sobre alto deja un hueco, no un desborde.
      if restante < -TOL_IN
        return "Los altos fijados suman #{a_mm(disp - restante)} mm y solo caben #{a_mm(disp)} mm: " \
               "se pasan #{a_mm(-restante)} mm."
      elsif libres > 0 && (restante / libres) < alto_min - TOL_IN
        return "Quedan #{a_mm(restante)} mm para #{libres} cajón(es) = #{a_mm(restante / libres)} mm " \
               "cada uno, por debajo del mínimo de #{minimo} mm."
      end

      nil
    end

    # -----------------------------------------------------------------------
    # Generación: recibe { familia, nombre_salida, valores, insertar_en_escena }
    # donde `valores` ya es la fila plana { "prefijo>attr" => "800mm" }.
    # -----------------------------------------------------------------------
    def generar(payload_json)
      payload = JSON.parse(payload_json)
      familia = payload['familia'].to_s
      nombre  = payload['nombre_salida'].to_s
      valores = payload['valores'] || {}
      en_escena = payload['insertar_en_escena'] ? true : false

      unless project_root_valido?
        return { 'ok' => false, 'error' => 'Configura primero la carpeta del proyecto (contiene «Main Components»).' }
      end

      manifest_wrap = cargar_manifest(familia)
      return manifest_wrap unless manifest_wrap['ok']
      manifest = manifest_wrap['manifest']

      error_cajones = validar_cajones(manifest, valores)
      return { 'ok' => false, 'error' => "Los cajones no caben. #{error_cajones}" } if error_cajones

      base_path = manifest['componente_base_abs']
      unless File.exist?(base_path)
        return { 'ok' => false, 'error' => "No se encontró el componente base:\n#{base_path}" }
      end

      model    = Sketchup.active_model
      base_def = model.definitions.load(base_path)

      opts = { output_dir: manifest['salida_dir_abs'], insertar_en_escena: en_escena }
      if en_escena
        opts[:transformation] = Geom::Transformation.new(Geom::Point3d.new(@cursor_x, 0, 0))
      end

      res = Engine.generar_unidad(base_def, nombre, valores, opts)

      # Avanza el cursor de auto-tiling por el ancho (LenX) de esta unidad.
      if en_escena && res[:ok]
        lenx = Engine.interpret(valores['LenX'])
        @cursor_x += lenx.to_f if lenx.is_a?(Numeric)
      end

      {
        'ok'       => res[:ok],
        'ruta'     => res[:ruta],
        'error'    => res[:error],
        'warnings' => res[:warnings] || []
      }
    rescue => e
      { 'ok' => false, 'error' => e.message }
    end

    # -----------------------------------------------------------------------
    # Menú / Toolbar
    # -----------------------------------------------------------------------
    unless defined?(@ui_installed) && @ui_installed
      menu = UI.menu('Extensions')
      menu.add_item('Royal Catalog Creator') { mostrar_dialogo }

      toolbar = UI::Toolbar.new('Royal Catalog Creator')
      cmd = UI::Command.new('Catalog Creator') { mostrar_dialogo }
      cmd.tooltip         = 'Royal Catalog Creator'
      cmd.status_bar_text = 'Genera variaciones de muebles de catálogo.'
      icono = File.join(HTML_DIR, 'img', 'icon.png')
      if File.exist?(icono)
        cmd.small_icon = icono
        cmd.large_icon = icono
      end
      toolbar.add_item(cmd)
      toolbar.restore

      @ui_installed = true
    end

  end
end
