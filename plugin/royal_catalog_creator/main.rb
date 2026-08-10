# encoding: UTF-8
# =============================================================================
#  Royal Catalog Creator — Diálogo principal (UI::HtmlDialog) y callbacks
# =============================================================================

require 'sketchup.rb'
require 'json'

module RoyalKitchen
  module CatalogCreator

    require File.join(__dir__, 'engine')
    require File.join(__dir__, 'plantilla')
    require File.join(__dir__, 'importer')

    # -- Configuración ------------------------------------------------------
    PREF_SECTION = 'RoyalCatalogCreator'.freeze
    HTML_DIR     = File.join(__dir__, 'html').freeze
    MANIFEST_DIR = File.join(__dir__, 'manifest').freeze
    IMAGES_DIR   = File.join(__dir__, 'images').freeze

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

      dialog.add_action_callback('exportar_plantilla') do |_ctx|
        responder(dialog, 'onPlantilla', exportar_plantilla)
      end

      dialog.add_action_callback('importar_archivo') do |_ctx|
        responder(dialog, 'onImportar', importar_archivo)
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

    # Manifiestos de las familias activas, en el orden de FAMILIAS. Es la fuente
    # de la plantilla: agregar una familia la agrega al Excel sin tocar código.
    def manifiestos_activos
      FAMILIAS.select { |f| f['activo'] }.map do |f|
        wrap = cargar_manifest(f['id'])
        raise "No se pudo leer el manifiesto de #{f['titulo']}: #{wrap['error']}" unless wrap['ok']
        [f['id'], wrap['manifest']]
      end
    end

    # -----------------------------------------------------------------------
    # Exportar plantilla: escribe el .xlsx derivado de los manifiestos.
    # -----------------------------------------------------------------------
    def exportar_plantilla
      unless project_root_valido?
        return { 'ok' => false, 'error' => 'Configura primero la carpeta del proyecto (contiene «Main Components»).' }
      end

      dir = File.join(project_root, 'Input')
      dir = project_root unless File.directory?(dir)
      ruta = UI.savepanel('Guardar plantilla de importación', dir, 'plantilla_catalogo.xlsx')
      return { 'ok' => false, 'cancelado' => true } unless ruta

      # Algunos diálogos de Windows devuelven la ruta sin extensión si el usuario
      # borró la sugerida; sin .xlsx, Excel no la reconoce.
      ruta += '.xlsx' unless ruta.downcase.end_with?('.xlsx')

      Plantilla.exportar(ruta, manifiestos_activos)
      { 'ok' => true, 'ruta' => ruta }
    rescue => e
      { 'ok' => false, 'error' => e.message }
    end

    # -----------------------------------------------------------------------
    # Importar: lee el archivo y devuelve la tabla en crudo junto con el modelo
    # de columnas y los manifiestos.
    #
    # Los manifiestos viajan enteros a propósito: la UI necesita los tres para
    # validar filas de cualquier familia, y mandarlos aquí evita una danza de
    # peticiones asíncronas antes de poder dibujar la tabla.
    # -----------------------------------------------------------------------
    def importar_archivo
      unless project_root_valido?
        return { 'ok' => false, 'error' => 'Configura primero la carpeta del proyecto (contiene «Main Components»).' }
      end

      dir  = File.join(project_root, 'Input')
      dir  = project_root unless File.directory?(dir)
      ruta = UI.openpanel('Elegir archivo a importar', dir, 'Plantilla|*.xlsx;*.csv;*.txt||')
      return { 'ok' => false, 'cancelado' => true } unless ruta

      res = Importer.leer(ruta)
      return res unless res['ok']

      mans = manifiestos_activos
      res['ruta']        = ruta
      res['modelo']      = Plantilla.modelo(mans)
      res['manifiestos'] = mans.each_with_object({}) { |(fam, man), h| h[fam] = man }
      res
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

    # Con «N cajones» el componente hace los cajones copia del primero: un solo
    # alto manda sobre todos.
    def cajones_uniformes?(reglas, valores)
      return false unless reglas['uniforme_si_n']
      estilo = valores[reglas['attr_estilo_puerta']].to_s
      (reglas['estilos_con_cajones'] || {})[estilo] == 'n'
    end

    def validar_cajones(manifest, valores)
      reglas = manifest['reglas_cajones']
      return nil unless reglas

      n = cajones_efectivos(reglas, valores)
      return nil if n < 1

      # La fila plana trae LenZ con el zócalo ya sumado (ajuste `suma` del
      # manifiesto, resuelto en app.js#effectiveValue), así que restarlo aquí es
      # correcto y no duplica el descuento: app.js hace la misma resta sobre el
      # mismo número compensado. Los dos espejos leen el alto FINAL, no el
      # capturado. Ver el comentario de presupuestoCajones en app.js.
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

      uniforme = cajones_uniformes?(reglas, valores)
      altos    = Array(reglas['attrs_alto']).first(uniforme ? 1 : n).map { |attr| medida_in(valores, attr) }
      fijos    = altos.compact

      if uniforme
        # El único alto capturado se multiplica por los n cajones.
        libres   = fijos.empty? ? n : 0
        restante = disp - (fijos.empty? ? 0.0 : fijos[0] * n)
      else
        libres   = n - fijos.size
        restante = disp - fijos.inject(0.0) { |s, v| s + v }
      end

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
    # Generación: recibe { registro_id, familia, nombre_salida, valores,
    # insertar_en_escena } donde `valores` ya es la fila plana
    # { "prefijo>attr" => "800mm" }.
    #
    # `registro_id` se devuelve intacto en TODAS las respuestas: la UI lo usa
    # para saber a qué tarjeta pertenece el resultado, porque en «Generar todos»
    # el módulo activo no es el que se acaba de generar.
    # -----------------------------------------------------------------------
    def generar(payload_json)
      reg_id  = nil
      payload = JSON.parse(payload_json)
      reg_id  = payload['registro_id']
      familia = payload['familia'].to_s
      nombre  = payload['nombre_salida'].to_s
      valores = payload['valores'] || {}
      en_escena = payload['insertar_en_escena'] ? true : false
      # Ausente = payload viejo: se limpia, que es el comportamiento pedido.
      limpiar = payload.key?('limpiar_ocultos') ? !!payload['limpiar_ocultos'] : true

      unless project_root_valido?
        return { 'ok' => false, 'registro_id' => reg_id,
                 'error' => 'Configura primero la carpeta del proyecto (contiene «Main Components»).' }
      end

      manifest_wrap = cargar_manifest(familia)
      return manifest_wrap.merge('registro_id' => reg_id) unless manifest_wrap['ok']
      manifest = manifest_wrap['manifest']

      error_cajones = validar_cajones(manifest, valores)
      if error_cajones
        return { 'ok' => false, 'registro_id' => reg_id, 'error' => "Los cajones no caben. #{error_cajones}" }
      end

      base_path = manifest['componente_base_abs']
      unless File.exist?(base_path)
        return { 'ok' => false, 'registro_id' => reg_id,
                 'error' => "No se encontró el componente base:\n#{base_path}" }
      end

      model    = Sketchup.active_model
      base_def = model.definitions.load(base_path)

      opts = {
        output_dir:         manifest['salida_dir_abs'],
        insertar_en_escena: en_escena,
        limpiar_ocultos:    limpiar
      }
      if en_escena
        opts[:transformation] = Geom::Transformation.new(Geom::Point3d.new(@cursor_x, 0, 0))
      end

      # Nombres de las piezas de cada división, ya resueltos por la UI a partir
      # del modo elegido en el margen frontal. Viajan aparte de la fila plana
      # porque no son atributos del componente, y el motor solo los aplica.
      div = payload['divisores']
      if div.is_a?(Hash) && div['nombres'].is_a?(Array) && !div['nombres'].empty?
        opts[:divisores] = { prefijo: div['prefijo'].to_s, nombres: div['nombres'].map(&:to_s) }
      end

      # La unión de mitades no depende de nada que decida la diseñadora: es un
      # post-proceso geométrico de la familia. Por eso se lee del manifiesto aquí
      # y no viaja en el payload, a diferencia de los nombres de divisor. Una
      # familia sin `reglas_union` (Gabinete, Alacena) simplemente no lo ejecuta.
      uni = manifest['reglas_union']
      if uni.is_a?(Hash) && uni['grupo'] && uni['nombre'] && uni['piezas'].is_a?(Array)
        opts[:union] = {
          grupo:  uni['grupo'].to_s,
          piezas: uni['piezas'].map(&:to_s),
          nombre: uni['nombre'].to_s
        }
      end

      res = Engine.generar_unidad(base_def, nombre, valores, opts)

      # Avanza el cursor de auto-tiling por el ancho (LenX) de esta unidad.
      if en_escena && res[:ok]
        lenx = Engine.interpret(valores['LenX'])
        @cursor_x += lenx.to_f if lenx.is_a?(Numeric)
      end

      {
        'ok'          => res[:ok],
        'registro_id' => reg_id,
        'ruta'        => res[:ruta],
        'error'       => res[:error],
        'warnings'    => res[:warnings] || []
      }
    rescue => e
      { 'ok' => false, 'registro_id' => reg_id, 'error' => e.message }
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
      # icon.png es un PNG de 128 px con transparencia: SketchUp lo reduce al
      # tamaño que pida la barra (24/32 px, más en pantallas HiDPI).
      icono = File.join(IMAGES_DIR, 'icon.png')
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
