# encoding: UTF-8
# =============================================================================
#  Royal Catalog Creator — Escritor mínimo de .xlsx, sin gems
# -----------------------------------------------------------------------------
#  SketchUp no trae rubyzip ni ninguna librería de Office y no se pueden
#  instalar gems, así que el archivo se arma a mano. Tres decisiones lo hacen
#  viable:
#
#  - Las entradas del zip se guardan SIN comprimir (método 0, «stored»). Un zip
#    stored es válido para Excel y evita depender de Zlib::Deflate; lo único que
#    hace falta de zlib es el CRC32, y hay una implementación propia de respaldo.
#  - Las cadenas van «inline» (t="inlineStr") en vez de en sharedStrings.xml:
#    una parte menos que generar y mantener sincronizada.
#  - Solo se emiten las partes mínimas que Excel exige. Cualquier parte de más
#    es una oportunidad de que el archivo salga «reparable».
#
#  Uso:
#    Xlsx.escribir(ruta, [
#      { 'nombre' => 'Modulos', 'filas' => [[...], [...]], 'anchos' => [...],
#        'congelar' => true,
#        'validaciones' => [ { 'col' => 0, 'hasta' => 500,
#                              'rango' => "Listas!$A$2:$A$4", 'estricta' => true } ] }
#    ])
# =============================================================================

module RoyalKitchen
  module CatalogCreator
    module Xlsx

      FILAS_VALIDACION = 500        # hasta dónde se extienden los desplegables
      HOJA_DATOS       = 'Modulos'  # hoja que se lee al importar

      module_function

      # -----------------------------------------------------------------------
      # API
      # -----------------------------------------------------------------------
      def escribir(ruta, hojas)
        partes = []
        partes << ['[Content_Types].xml', content_types(hojas.size)]
        partes << ['_rels/.rels',         rels_raiz]
        partes << ['xl/workbook.xml',     workbook(hojas)]
        partes << ['xl/_rels/workbook.xml.rels', rels_workbook(hojas.size)]
        partes << ['xl/styles.xml',       styles]
        hojas.each_with_index do |hoja, i|
          partes << ["xl/worksheets/sheet#{i + 1}.xml", worksheet(hoja)]
        end
        zip(ruta, partes)
        ruta
      end

      # Índice 0 -> "A", 25 -> "Z", 26 -> "AA". Con ~80 columnas se pasa de la Z,
      # así que esto no es un lujo.
      def col_letra(i)
        letra = ''
        n = i
        loop do
          letra = ((n % 26) + 65).chr + letra
          n = n / 26 - 1
          break if n < 0
        end
        letra
      end

      # -----------------------------------------------------------------------
      # XML
      # -----------------------------------------------------------------------
      # Se escapan también los caracteres de control: un XML con un \x01 dentro
      # no es «casi válido», es inválido, y Excel lo reporta como archivo dañado.
      def esc(txt)
        s = txt.to_s.dup
        s = s.gsub('&', '&amp;').gsub('<', '&lt;').gsub('>', '&gt;').gsub('"', '&quot;')
        s.gsub(/[\x00-\x08\x0B\x0C\x0E-\x1F]/, '')
      end

      def cabecera_xml
        %(<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n)
      end

      def content_types(n_hojas)
        overrides = (1..n_hojas).map do |i|
          %(<Override PartName="/xl/worksheets/sheet#{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>)
        end.join
        cabecera_xml +
          %(<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">) +
          %(<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>) +
          %(<Default Extension="xml" ContentType="application/xml"/>) +
          %(<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>) +
          overrides +
          %(<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>) +
          %(</Types>)
      end

      def rels_raiz
        cabecera_xml +
          %(<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">) +
          %(<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>) +
          %(</Relationships>)
      end

      def workbook(hojas)
        sheets = hojas.each_with_index.map do |hoja, i|
          %(<sheet name="#{esc(hoja['nombre'])}" sheetId="#{i + 1}" r:id="rId#{i + 1}"/>)
        end.join
        cabecera_xml +
          %(<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ) +
          %(xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">) +
          %(<sheets>#{sheets}</sheets></workbook>)
      end

      def rels_workbook(n_hojas)
        rels = (1..n_hojas).map do |i|
          %(<Relationship Id="rId#{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet#{i}.xml"/>)
        end.join
        rels += %(<Relationship Id="rId#{n_hojas + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>)
        cabecera_xml +
          %(<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">#{rels}</Relationships>)
      end

      # Dos estilos: 0 = normal, 1 = negritas (fila de encabezados).
      def styles
        cabecera_xml +
          %(<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">) +
          %(<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>) +
          %(<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>) +
          %(<fills count="2"><fill><patternFill patternType="none"/></fill>) +
          %(<fill><patternFill patternType="gray125"/></fill></fills>) +
          %(<borders count="1"><border/></borders>) +
          %(<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>) +
          %(<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>) +
          %(<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>) +
          %(</styleSheet>)
      end

      # Un valor puramente numérico se escribe como número: si no, Excel marca
      # cada medida con el triángulo verde de «número guardado como texto».
      NUMERO = /\A-?\d+(?:\.\d+)?\z/.freeze

      def celda(ref, valor, negritas)
        estilo = negritas ? ' s="1"' : ''
        txt = valor.to_s
        return %(<c r="#{ref}"#{estilo}/>) if txt.empty?
        if txt =~ NUMERO
          %(<c r="#{ref}"#{estilo}><v>#{txt}</v></c>)
        else
          %(<c r="#{ref}"#{estilo} t="inlineStr"><is><t xml:space="preserve">#{esc(txt)}</t></is></c>)
        end
      end

      def worksheet(hoja)
        filas = hoja['filas'] || []
        xml = cabecera_xml.dup
        xml << %(<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">)

        if hoja['congelar']
          xml << %(<sheetViews><sheetView workbookViewId="0">) +
                 %(<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>) +
                 %(</sheetView></sheetViews>)
        end
        xml << %(<sheetFormatPr defaultRowHeight="15"/>)

        anchos = hoja['anchos']
        if anchos && !anchos.empty?
          cols = anchos.each_with_index.map do |w, i|
            %(<col min="#{i + 1}" max="#{i + 1}" width="#{w}" customWidth="1"/>)
          end.join
          xml << %(<cols>#{cols}</cols>)
        end

        xml << '<sheetData>'
        filas.each_with_index do |fila, r|
          celdas = fila.each_with_index.map do |v, c|
            celda("#{col_letra(c)}#{r + 1}", v, r == 0)
          end.join
          xml << %(<row r="#{r + 1}">#{celdas}</row>)
        end
        xml << '</sheetData>'

        # dataValidations va DESPUÉS de sheetData: el esquema de SpreadsheetML
        # fija el orden de los elementos y Excel rechaza el archivo si se invierte.
        vals = hoja['validaciones'] || []
        unless vals.empty?
          cuerpo = vals.map do |v|
            letra = col_letra(v['col'])
            hasta = v['hasta'] || FILAS_VALIDACION
            # estricta=false deja escribir fuera de la lista sin bloquear: los
            # campos «preset» aceptan además una medida libre.
            error = v['estricta'] ? '1' : '0'
            %(<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="#{error}" ) +
              %(sqref="#{letra}2:#{letra}#{hasta}"><formula1>#{esc(v['rango'])}</formula1></dataValidation>)
          end.join
          xml << %(<dataValidations count="#{vals.size}">#{cuerpo}</dataValidations>)
        end

        xml << '</worksheet>'
        xml
      end

      # =======================================================================
      #  LECTURA
      # -----------------------------------------------------------------------
      #  Escribir no necesita comprimir, pero LEER sí: Excel guarda sus partes
      #  con deflate, así que aquí zlib no es opcional. Si faltara, el importador
      #  se queda solo con CSV y lo dice; por eso `disponible?` existe.
      # =======================================================================
      def disponible?
        return @zlib_ok unless @zlib_ok.nil?
        @zlib_ok = begin
          require 'zlib'
          true
        rescue LoadError
          false
        end
      end

      # Devuelve la hoja «Modulos» (o la primera) como matriz de textos.
      def leer(ruta)
        datos    = File.open(ruta, 'rb') { |f| f.read }
        datos.force_encoding('BINARY')
        entradas = zip_entradas(datos)

        wb   = parte(datos, entradas, 'xl/workbook.xml')
        rels = parte(datos, entradas, 'xl/_rels/workbook.xml.rels')
        hoja = parte(datos, entradas, ruta_hoja(wb, rels))

        compartidas = entradas.key?('xl/sharedStrings.xml') ?
          shared_strings(parte(datos, entradas, 'xl/sharedStrings.xml')) : []

        matriz(hoja, compartidas)
      end

      # -- ZIP: directorio central --------------------------------------------
      def zip_entradas(datos)
        fin = eocd(datos)
        raise 'El archivo no parece un .xlsx (no se encontró el índice del zip).' unless fin

        total  = datos[fin + 10, 2].unpack1('v')
        offset = datos[fin + 16, 4].unpack1('V')

        entradas = {}
        pos = offset
        total.times do
          break unless datos[pos, 4] == "PK\x01\x02".b
          metodo   = datos[pos + 10, 2].unpack1('v')
          nombre_n = datos[pos + 28, 2].unpack1('v')
          extra_n  = datos[pos + 30, 2].unpack1('v')
          coment_n = datos[pos + 32, 2].unpack1('v')
          local    = datos[pos + 42, 4].unpack1('V')
          csize    = datos[pos + 20, 4].unpack1('V')
          # El zip especifica '/' como separador, pero hay herramientas que
          # escriben '\'. Normalizarlo cuesta nada y evita un «no contiene» absurdo.
          nombre   = datos[pos + 46, nombre_n].force_encoding('UTF-8').tr('\\', '/')
          entradas[nombre] = { metodo: metodo, csize: csize, local: local }
          pos += 46 + nombre_n + extra_n + coment_n
        end
        entradas
      end

      # El EOCD está al final, pero puede llevar comentario detrás: se busca
      # hacia atrás dentro de los 64 KB que permite el formato.
      def eocd(datos)
        i = datos.bytesize - 22
        limite = [datos.bytesize - 22 - 65_557, 0].max
        while i >= limite
          return i if datos[i, 4] == "PK\x05\x06".b
          i -= 1
        end
        nil
      end

      def parte(datos, entradas, nombre)
        e = entradas[nombre]
        raise "El .xlsx no contiene «#{nombre}»." unless e

        # Los tamaños de nombre/extra del encabezado LOCAL pueden diferir de los
        # del directorio central: hay que leerlos de ahí, no reusar los otros.
        nombre_n = datos[e[:local] + 26, 2].unpack1('v')
        extra_n  = datos[e[:local] + 28, 2].unpack1('v')
        inicio   = e[:local] + 30 + nombre_n + extra_n
        bruto    = datos[inicio, e[:csize]]

        crudo = case e[:metodo]
                when 0 then bruto
                when 8
                  unless disponible?
                    raise 'Este SketchUp no trae zlib, así que no puede abrir .xlsx. ' \
                          'Guarda el archivo como CSV desde Excel e impórtalo así.'
                  end
                  Zlib::Inflate.new(-Zlib::MAX_WBITS).inflate(bruto)
                else
                  raise "Compresión no soportada en «#{nombre}» (método #{e[:metodo]})."
                end
        crudo.force_encoding('UTF-8')
      end

      # -- XML ----------------------------------------------------------------
      # La hoja de datos se localiza por NOMBRE, no por número de archivo: el
      # orden de sheetN.xml no tiene por qué coincidir con el de las pestañas.
      def ruta_hoja(workbook, rels)
        m  = workbook[/<sheet[^>]*name="#{Regexp.escape(HOJA_DATOS)}"[^>]*>/i]
        m ||= workbook[/<sheet[^>]*>/i]
        raise 'El .xlsx no tiene hojas.' unless m

        rid = m[/r:id="([^"]+)"/, 1]
        destino = rid ? rels[/Id="#{Regexp.escape(rid)}"[^>]*Target="([^"]+)"/, 1] : nil
        destino ||= 'worksheets/sheet1.xml'
        destino = destino.sub(%r{\A/?xl/}, '').sub(%r{\A\.\./}, '')
        "xl/#{destino}"
      end

      def shared_strings(xml)
        xml.scan(%r{<si\b[^>]*>(.*?)</si>}m).map do |(cuerpo)|
          desesc(cuerpo.scan(%r{<t\b[^>]*>(.*?)</t>}m).map { |(t)| t }.join)
        end
      end

      def matriz(xml, compartidas)
        xml.scan(%r{<row\b[^>]*>(.*?)</row>}m).map do |(cuerpo)|
          fila = []
          cuerpo.scan(%r{<c\b([^>]*?)(?:/>|>(.*?)</c>)}m) do |attrs, contenido|
            ref = attrs[/r="([A-Z]+)\d+"/, 1]
            idx = ref ? indice_col(ref) : fila.size
            fila[idx] = celda_valor(attrs, contenido, compartidas)
          end
          fila.map { |v| v.nil? ? '' : v }
        end
      end

      def indice_col(letras)
        letras.each_char.inject(0) { |n, ch| n * 26 + (ch.ord - 64) } - 1
      end

      def celda_valor(attrs, contenido, compartidas)
        return '' if contenido.nil? || contenido.empty?
        case attrs[/t="([^"]+)"/, 1]
        when 's'
          i = contenido[%r{<v>(\d+)</v>}, 1]
          i ? compartidas[i.to_i].to_s : ''
        when 'inlineStr'
          desesc(contenido.scan(%r{<t\b[^>]*>(.*?)</t>}m).map { |(t)| t }.join)
        when 'b'
          contenido[%r{<v>(.*?)</v>}m, 1].to_s == '1' ? 'Sí' : 'No'
        else
          # numérico, 'str' (resultado de fórmula) o 'e' (error de celda)
          desesc(contenido[%r{<v>(.*?)</v>}m, 1].to_s)
        end
      end

      # &amp; se resuelve al final: si no, un «&amp;lt;» del original se
      # convertiría en «<» y cambiaría el texto.
      def desesc(txt)
        s = txt.to_s
        s = s.gsub(/&#x([0-9A-Fa-f]+);/) { [Regexp.last_match(1).to_i(16)].pack('U') }
        s = s.gsub(/&#(\d+);/)           { [Regexp.last_match(1).to_i].pack('U') }
        s.gsub('&lt;', '<').gsub('&gt;', '>').gsub('&quot;', '"')
         .gsub('&apos;', "'").gsub('&amp;', '&')
      end

      # -----------------------------------------------------------------------
      # ZIP (escritura: solo entradas «stored»)
      # -----------------------------------------------------------------------
      def crc32(datos)
        if defined?(Zlib) && Zlib.respond_to?(:crc32)
          Zlib.crc32(datos)
        else
          crc32_propio(datos)
        end
      end

      # Respaldo por si zlib no estuviera en el Ruby de SketchUp: sin CRC no hay
      # zip válido, y perder la exportación entera por eso sería absurdo.
      def crc32_propio(datos)
        @tabla ||= (0..255).map do |n|
          c = n
          8.times { c = (c & 1 == 1) ? (0xEDB88320 ^ (c >> 1)) : (c >> 1) }
          c
        end
        crc = 0xFFFFFFFF
        datos.each_byte { |b| crc = @tabla[(crc ^ b) & 0xFF] ^ (crc >> 8) }
        crc ^ 0xFFFFFFFF
      end

      def dos_fecha_hora(t = Time.now)
        hora = (t.hour << 11) | (t.min << 5) | (t.sec / 2)
        fecha = ((t.year - 1980) << 9) | (t.month << 5) | t.day
        [hora, fecha]
      end

      def zip(ruta, partes)
        hora, fecha = dos_fecha_hora
        # 0x0800 = los nombres de entrada van en UTF-8. Todas nuestras rutas son
        # ASCII, pero declararlo es gratis y evita sorpresas si alguna cambia.
        flags = 0x0800

        entradas = partes.map do |nombre, contenido|
          datos = contenido.to_s.dup.force_encoding('BINARY')
          { nombre: nombre.dup.force_encoding('BINARY'), datos: datos,
            crc: crc32(datos), tam: datos.bytesize }
        end

        File.open(ruta, 'wb') do |f|
          entradas.each do |e|
            e[:offset] = f.pos
            f.write([0x04034b50, 20, flags, 0, hora, fecha,
                     e[:crc], e[:tam], e[:tam], e[:nombre].bytesize, 0].pack('VvvvvvVVVvv'))
            f.write(e[:nombre])
            f.write(e[:datos])
          end

          inicio_cd = f.pos
          entradas.each do |e|
            f.write([0x02014b50, 20, 20, flags, 0, hora, fecha,
                     e[:crc], e[:tam], e[:tam], e[:nombre].bytesize,
                     0, 0, 0, 0, 0, e[:offset]].pack('VvvvvvvVVVvvvvvVV'))
            f.write(e[:nombre])
          end
          fin_cd = f.pos

          f.write([0x06054b50, 0, 0, entradas.size, entradas.size,
                   fin_cd - inicio_cd, inicio_cd, 0].pack('VvvvvVVv'))
        end
      end

    end
  end
end
