# encoding: UTF-8
# =============================================================================
#  Royal Catalog Creator — Modelo de columnas de la plantilla de importación
# -----------------------------------------------------------------------------
#  La plantilla se DERIVA de los manifiestos, nunca se escribe a mano: así encaja
#  por construcción y una variable nueva aparece sola en el Excel (SCOPE §4.4).
#
#  Regla de agrupación — la columna se identifica por el CAMPO, no por el `attr`:
#
#    Dos familias comparten columna solo si coinciden `attr`, `tipo`, `unidad`,
#    `label` y el juego completo de opciones. En cuanto algo difiere, la columna
#    se parte y cada familia recibe la suya con su prefijo.
#
#  Es la trampa principal del formato: `EstiloPuerta` existe en Gabinete y en
#  Esquinero, pero el primero llega a «4 cajones» y el segundo corta en «Puerta
#  uñero». Una columna común con la unión de ambas listas dejaría elegir «4
#  cajones» en un esquinero, que el componente no arma. Y `LenY` es
#  «Profundidad» en Gabinete/Alacena pero «Ancho derecho» en Esquinero: mismo
#  atributo, significado distinto, columna distinta.
#
#  El modelo que produce `modelo()` es JSON-serializable a propósito: la UI lo
#  usa al importar para mapear encabezado -> campo, de modo que la regla vive en
#  UN solo lugar y no en dos idiomas.
# =============================================================================

module RoyalKitchen
  module CatalogCreator
    module Plantilla

      require File.join(__dir__, 'xlsx')

      SIGLAS  = { 'gabinete' => 'GAB', 'alacena' => 'ALA', 'esquinero' => 'ESQ' }.freeze
      HOJA    = 'Modulos'.freeze
      HOJA_L  = 'Listas'.freeze

      module_function

      # -----------------------------------------------------------------------
      # Modelo de columnas
      # manifiestos = [['gabinete', hash], ['alacena', hash], ...] en orden
      # -----------------------------------------------------------------------
      def modelo(manifiestos)
        orden = []
        mapa  = {}

        manifiestos.each do |fam, man|
          (man['grupos'] || []).each do |g|
            (g['campos'] || []).each do |c|
              f = firma(c)
              unless mapa.key?(f)
                mapa[f] = { 'campo' => c, 'familias' => [], 'ids' => {}, 'defaults' => {} }
                orden << f
              end
              mapa[f]['familias'] << fam unless mapa[f]['familias'].include?(fam)
              mapa[f]['ids'][fam]      = c['id'].to_s
              mapa[f]['defaults'][fam] = c['default'].to_s
            end
          end
        end

        total  = manifiestos.size
        campos = orden.map { |f| columna_campo(mapa[f], total) }

        # Comunes primero (lo que se llena en casi toda fila), luego el bloque
        # exclusivo de cada familia en el orden en que se declaran.
        comunes = campos.select { |c| c['familias'].size >= 2 }
        propias = manifiestos.map { |fam, _| campos.select { |c| c['familias'] == [fam] } }.flatten(1)

        cols = []
        cols << columna_fija('familia', 'familia',
                             manifiestos.map { |fam, man| man['titulo'].to_s }, true)
        cols << columna_fija('nombre_salida', 'nombre', [], false)
        cols.concat(comunes)
        cols.concat(propias)
        # «Insertar en escena» y «Limpiar piezas ocultas» NO son columnas: son
        # estado de sesión (viven en los toggles del editor y aplican a todo lo
        # que se genere). Exportarlas prometería un control por fila que el
        # importador no puede honrar.

        unificar_headers(cols)
        { 'familias' => manifiestos.map { |fam, man| { 'id' => fam, 'titulo' => man['titulo'].to_s } },
          'columnas' => cols }
      end

      # Identidad del campo a efectos de compartir columna. Ver el encabezado.
      # Separador de control: así ninguna etiqueta puede producir por accidente
      # la misma firma que otra combinación de campos.
      SEP = "\u0001".freeze

      def firma(campo)
        [campo['attr'], campo['tipo'] || 'numero', campo['unidad'], campo['label'],
         opciones_de(campo).map { |o| "#{o['label']}=#{o['valor']}" }.join('|'),
         campo['permite_personalizado'] ? 'custom' : ''].join(SEP)
      end

      def opciones_de(campo)
        case campo['tipo']
        when 'select' then campo['opciones'] || []
        when 'preset' then campo['presets']  || []
        else []
        end
      end

      def columna_campo(info, total)
        c    = info['campo']
        fams = info['familias']
        u    = c['unidad'].to_s

        etiqueta  = c['label'].to_s
        etiqueta += " (#{u})" unless u.empty?
        # Sin prefijo solo cuando la columna vale para TODAS las familias; en
        # cualquier otro caso el encabezado dice a cuáles aplica.
        prefijo = fams.size == total ? '' : '[' + fams.map { |x| SIGLAS[x] || x.upcase }.join('·') + '] '

        {
          'header'   => prefijo + etiqueta,
          'clase'    => 'campo',
          'attr'     => c['attr'].to_s,
          'tipo'     => c['tipo'] || 'numero',
          'unidad'   => u,
          'familias' => fams,
          'ids'      => info['ids'],
          'defaults' => info['defaults'],
          'min'      => c['min'],
          'max'      => c['max'],
          'opciones' => opciones_de(c).map { |o| { 'label' => o['label'].to_s, 'valor' => o['valor'].to_s } },
          # Los `preset` con medida libre no pueden llevar validación bloqueante:
          # «300» es un valor legítimo que no está en la lista.
          'estricta' => c['tipo'] == 'select'
        }
      end

      def columna_fija(header, clase, valores, estricta)
        {
          'header'   => header,
          'clase'    => clase,
          'attr'     => nil,
          'tipo'     => valores.empty? ? 'texto' : 'select',
          'unidad'   => '',
          'familias' => [],
          'ids'      => {},
          'defaults' => {},
          'opciones' => valores.map { |v| { 'label' => v, 'valor' => v } },
          'estricta' => estricta
        }
      end

      # El encabezado es la llave con la que el importador reconoce la columna:
      # si dos coincidieran, una de las dos se perdería en silencio.
      def unificar_headers(cols)
        vistos = {}
        cols.each do |c|
          h = c['header']
          if vistos.key?(h)
            h = "#{c['header']} [#{c['attr']}]"
            n = 2
            while vistos.key?(h)
              h = "#{c['header']} [#{c['attr']} #{n}]"
              n += 1
            end
            c['header'] = h
          end
          vistos[h] = true
        end
        cols
      end

      # -----------------------------------------------------------------------
      # Hojas
      # -----------------------------------------------------------------------
      # Deduplica juegos de opciones: media plantilla comparte las mismas listas
      # (Sí/No, tiradores, posiciones) y repetirlas ensancharía la hoja sin razón.
      def listas(cols)
        lst    = []
        indice = {}
        cols.each do |c|
          ops = c['opciones']
          next if ops.nil? || ops.empty?
          clave = ops.map { |o| o['label'] }.join(SEP)
          unless indice.key?(clave)
            indice[clave] = lst.size
            lst << { 'titulo' => c['header'], 'valores' => ops.map { |o| o['label'] } }
          end
          c['lista'] = indice[clave]
        end
        lst
      end

      # Valor de ejemplo de una columna para una familia: el `default` del
      # manifiesto traducido a su etiqueta legible.
      def ejemplo(col, fam, titulo)
        case col['clase']
        when 'familia' then titulo
        when 'nombre'  then "#{SIGLAS[fam] || fam.upcase}-EJEMPLO"
        else
          return '' unless col['familias'].include?(fam)
          val = col['defaults'][fam].to_s
          ops = col['opciones']
          return val if ops.nil? || ops.empty?
          hit = ops.find { |o| o['valor'] == val }
          hit ? hit['label'] : val
        end
      end

      def ancho(header)
        [[header.to_s.length + 3, 12].max, 38].min
      end

      def instrucciones
        [
          ['Plantilla de importación — Royal Catalog Creator'],
          [''],
          ['Cada fila de la hoja «Modulos» es un módulo. Llena «familia» y «nombre_salida»,'],
          ['y luego solo las columnas que aplican a esa familia.'],
          [''],
          ['· Las columnas sin prefijo valen para las tres familias.'],
          ['· Las que empiezan con [GAB], [ALA] o [ESQ] solo aplican a esas familias;'],
          ['  si las llenas en una fila de otra familia, se ignoran (se avisa al importar).'],
          ['· Celda vacía = se usa el valor por omisión del plugin. No hace falta llenarlo todo.'],
          ['· Las medidas van en números, sin unidad: la unidad está en el encabezado, ej. «Ancho (mm)».'],
          ['· Los desplegables traen las opciones válidas. Escribe la etiqueta tal cual aparece.'],
          ['· En los márgenes y los altos de cajón puedes escribir además una medida libre'],
          ['  (por ejemplo 250) aunque no esté en la lista: eso equivale a «Personalizado».'],
          [''],
          ['Las tres primeras filas son EJEMPLOS, una por familia. Bórralas o sobrescríbelas.'],
          [''],
          ['La hoja «Listas» alimenta los desplegables. No la edites ni la reordenes.'],
          [''],
          ['Para importar: en el plugin, botón «Importar…» de la barra izquierda. Los registros'],
          ['se revisan en una tabla antes de crearse; ahí puedes corregir lo que haga falta.']
        ]
      end

      # -----------------------------------------------------------------------
      # Exportación
      # -----------------------------------------------------------------------
      def exportar(ruta, manifiestos)
        m    = modelo(manifiestos)
        cols = m['columnas']
        lst  = listas(cols)

        filas = [cols.map { |c| c['header'] }]
        manifiestos.each do |fam, man|
          filas << cols.map { |c| ejemplo(c, fam, man['titulo'].to_s) }
        end

        validaciones = []
        cols.each_with_index do |c, i|
          next unless c['lista']
          letra = Xlsx.col_letra(c['lista'])
          n     = lst[c['lista']]['valores'].size
          validaciones << { 'col' => i, 'estricta' => c['estricta'],
                            'rango' => "#{HOJA_L}!$#{letra}$2:$#{letra}$#{n + 1}" }
        end

        alto      = lst.map { |l| l['valores'].size }.max || 0
        filas_lst = [lst.map { |l| l['titulo'] }]
        (0...alto).each { |r| filas_lst << lst.map { |l| l['valores'][r] || '' } }

        Xlsx.escribir(ruta, [
          { 'nombre' => HOJA,   'filas' => filas, 'congelar' => true,
            'anchos' => cols.map { |c| ancho(c['header']) }, 'validaciones' => validaciones },
          { 'nombre' => HOJA_L, 'filas' => filas_lst,
            'anchos' => lst.map { |l| ancho(l['titulo']) } },
          { 'nombre' => 'Instrucciones', 'filas' => instrucciones, 'anchos' => [90] }
        ])
        ruta
      end

    end
  end
end
