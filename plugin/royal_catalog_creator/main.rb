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
    require File.join(__dir__, 'rk_mitered')

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
    # Descargar plantilla: escribe el .xlsx derivado de los manifiestos
    # directamente en la carpeta de descargas del usuario.
    #
    # Sin selector de ruta a propósito (DEV-28): el diálogo de guardado se
    # confundía con el de importar, y quien creía estar cargando un archivo
    # terminaba sobrescribiéndolo con la plantilla vacía. Un botón que descarga
    # y ya no tiene esa ambigüedad.
    # -----------------------------------------------------------------------
    PLANTILLA_BASE = 'plantilla_importacion_royal_catalog'.freeze

    def exportar_plantilla
      unless project_root_valido?
        return { 'ok' => false, 'error' => 'Configura primero la carpeta del proyecto (contiene «Main Components»).' }
      end

      ruta = ruta_libre(carpeta_descargas, PLANTILLA_BASE, '.xlsx')
      Plantilla.exportar(ruta, manifiestos_activos)
      { 'ok' => true, 'ruta' => ruta, 'carpeta' => File.dirname(ruta) }
    rescue => e
      { 'ok' => false, 'error' => e.message }
    end

    # Carpeta de descargas del usuario. En Windows la carpeta es «Downloads» en
    # disco aunque el Explorador la muestre como «Descargas»; se comprueban las
    # dos por si el perfil está en un idioma que sí renombra, y OneDrive porque
    # redirige la carpeta conocida cuando está activo el respaldo de escritorio.
    # Si no aparece ninguna, el home sirve: lo que no se puede es no escribir.
    def carpeta_descargas
      home = barras(Dir.home) rescue barras(ENV['USERPROFILE'] || ENV['HOME'] || '.')
      raices = [home]
      one = ENV['OneDrive'] || ENV['OneDriveConsumer']
      raices << barras(one) if one && !one.empty?

      candidatos = raices.product(%w[Downloads Descargas]).map { |r, n| File.join(r, n) }
      candidatos.find { |d| File.directory?(d) } || home
    end

    # Las variables de entorno de Windows traen «\» y `File.join` no las unifica:
    # la ruta acabaría mezclando separadores en el aviso que ve el usuario.
    def barras(ruta)
      ruta.to_s.tr('\\', '/')
    end

    # Nunca pisa un archivo existente: numera como lo haría el navegador, así
    # una descarga repetida no borra la plantilla que el usuario ya llenó.
    def ruta_libre(dir, base, ext)
      ruta = File.join(dir, base + ext)
      n    = 1
      while File.exist?(ruta)
        ruta = File.join(dir, "#{base} (#{n})#{ext}")
        n   += 1
      end
      ruta
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

    # Condición del manifiesto evaluada sobre la fila plana. Espejo de
    # condicionCumple en app.js: { attr, valor } / { attr, valores } /
    # { attr, excepto } / { todas: [...] } / { alguna: [...] }. Un attr que no
    # viene en la fila no se inyectó, así que no cumple ningún «igual a».
    def condicion_cumple?(valores, cond)
      return cond['todas'].all? { |c| condicion_cumple?(valores, c) } if cond['todas']
      return cond['alguna'].any? { |c| condicion_cumple?(valores, c) } if cond['alguna']
      actual = valores[cond['attr']].to_s
      return Array(cond['excepto']).none? { |v| v.to_s == actual } if cond['excepto']
      Array(cond['valores'] || [cond['valor']]).any? { |v| v.to_s == actual }
    end

    def todas?(valores, conds)
      Array(conds).all? { |c| condicion_cumple?(valores, c) }
    end

    # Primer attr de la lista cuyas condiciones `si` se cumplen, en pulgadas.
    def medida_segun(valores, lista)
      hit = Array(lista).find { |e| todas?(valores, e['si']) }
      (hit && medida_in(valores, hit['attr'])) || 0.0
    end

    # Alto de la zona 1 o 2: mismas fórmulas que el componente
    # (s01altofachada, zn11altozona1, zn21altozona2).
    def alto_zona(reglas, valores, zona)
      fach = reglas['fachada'] || {}
      alto = medida_in(valores, fach['attr_alto'])
      return nil if alto.nil?
      Array(fach['restar']).each { |a| v = medida_in(valores, a); alto -= v if v }
      alto -= medida_segun(valores, reglas['margen_superior'])

      z = reglas['zonas'] || {}
      return alto unless valores[z['attr_cantidad']].to_s == '2'
      sep = medida_segun(valores, reglas['separacion'])
      sup = medida_in(valores, z['attr_alto_superior'])
      z1  = [1.0 / 25.4, sup && sup > 0 ? sup : (alto - sep) / 2.0].max
      zona == 1 ? z1 : [1.0 / 25.4, alto - sep - z1].max
    end

    # Mensaje de error de una pila de cajones, o nil si cabe.
    def validar_pila(reglas, pila, valores)
      return nil unless todas?(valores, pila['si'])
      n = valores[pila['attr_cantidad']].to_i
      return nil if n < 1

      tope = Array(pila['max']).find { |e| todas?(valores, e['si']) }
      return tope['mensaje'] || "Máximo #{tope['n']} cajones en esta zona." if tope && n > tope['n'].to_i

      zona = alto_zona(reglas, valores, pila['zona'].to_i)
      return nil if zona.nil?
      sep      = medida_segun(valores, reglas['separacion'])
      minimo   = reglas['alto_min_mm']
      alto_min = minimo.to_f / 25.4
      disp     = zona - sep * (n - 1)
      return "La zona quedó en #{a_mm(zona)} mm. Revisa alto, zoclo, márgenes y alto de zonas." if disp <= 0

      igual    = disp / n
      personal = valores[pila['attr_modo']].to_s == pila['valor_personalizado'].to_s
      unless personal
        return nil if igual >= alto_min - TOL_IN
        return "#{n} cajones iguales = #{a_mm(igual)} mm cada uno, por debajo del mínimo de #{minimo} mm."
      end

      # «Personalizado»: cada cajón toma su alto (0 = igual) y el último el resto.
      altos = Array(pila['attrs_alto']).first(n - 1).map do |attr|
        v = medida_in(valores, attr)
        v && v > 0 ? v : igual
      end
      bajo = altos.find { |v| v < alto_min - TOL_IN }
      return "El alto de un cajón (#{a_mm(bajo)} mm) es menor al mínimo de #{minimo} mm." if bajo
      ultimo = disp - altos.inject(0.0) { |s, v| s + v }
      if ultimo < alto_min - TOL_IN
        return "Al último cajón (el que toma el resto) le quedan #{a_mm(ultimo)} mm, " \
               "por debajo del mínimo de #{minimo} mm."
      end
      nil
    end

    # -----------------------------------------------------------------------
    # Espejo de la validación de medidas del diálogo (DEV-21, R-08/R-09).
    #
    # Un atributo de tamaño con texto dentro no es una medida: el componente lo
    # escribiría tal cual y el mueble saldría con la medida del .skp base. El
    # formulario ya lo bloquea; esto atrapa lo que no pasó por él.
    # -----------------------------------------------------------------------
    # Attrs que el manifiesto declara como medida (campos `numero` y `preset`).
    # Un select puede llevar texto legítimo («S», «Gris mate»): no es medida.
    def attrs_medida(manifest)
      Array(manifest['grupos']).flat_map { |g| Array(g['campos']) }
                               .select { |c| %w[numero preset].include?(c['tipo'] || 'numero') }
                               .map { |c| c['attr'] }
    end

    def validar_medidas(manifest, valores)
      medidas = valores.select { |k, _v| attrs_medida(manifest).include?(k) }
      # Un valor "=formula" es la fórmula nativa del componente reinyectada a
      # propósito (p.ej. margen frontal en modo «Entrepaño»), no una medida.
      malos = medidas.select { |_k, v| (i = Engine.interpret(v)).is_a?(String) && !i.start_with?('=') }.keys
      return "No son medidas válidas: #{malos.join(', ')}." unless malos.empty?

      negativos = medidas.select { |_k, v| (n = Engine.interpret(v)).is_a?(Numeric) && n < 0 }.keys
      return "No pueden ser negativos: #{negativos.join(', ')}." unless negativos.empty?

      nil
    end

    # Una pila de cajones por zona (manifest.reglas_cajones.pilas). La fila
    # plana trae LenZ con el zoclo ya sumado (ajuste `suma`, resuelto en
    # app.js#effectiveValue), igual que lo lee presupuestoCajones: los dos
    # espejos parten del mismo número y restan el zoclo una sola vez.
    def validar_cajones(manifest, valores)
      reglas = manifest['reglas_cajones']
      return nil unless reglas

      Array(reglas['pilas']).each do |pila|
        err = validar_pila(reglas, pila, valores)
        return "#{pila['titulo'] || pila['id']}: #{err}" if err
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

      error_medidas = validar_medidas(manifest, valores)
      return { 'ok' => false, 'registro_id' => reg_id, 'error' => error_medidas } if error_medidas

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

      # El hook de Mitered se engancha al redraw de los Componentes Dinámicos.
      # Al cargar el plugin esa extensión puede no haber cargado todavía, así
      # que se reintenta aquí (es idempotente).
      RK::Mitered.instalar_hook if defined?(RK::Mitered)

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
