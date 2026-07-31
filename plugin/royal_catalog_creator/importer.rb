# encoding: UTF-8
# =============================================================================
#  Royal Catalog Creator — Lectura del archivo a importar
# -----------------------------------------------------------------------------
#  Este módulo hace SOLO el parseo estructural: archivo -> encabezados + filas de
#  texto. Nada de manifiestos, opciones ni unidades.
#
#  La semántica (traducir etiquetas a valores, aplicar visible_si/habilitado_si,
#  el presupuesto de cajones) vive en app.js, que ya la implementa para el
#  formulario. Duplicarla aquí crearía un tercer espejo de las mismas reglas —
#  ya hay dos, app.js y main.rb, y mantenerlos sincronizados cuesta.
# =============================================================================

require 'csv'

module RoyalKitchen
  module CatalogCreator
    module Importer

      require File.join(__dir__, 'xlsx')

      MAX_FILAS = 500   # tope de seguridad: nadie captura un catálogo más largo de un jalón

      module_function

      def leer(ruta)
        ext = File.extname(ruta.to_s).downcase
        tabla = case ext
                when '.xlsx'        then Xlsx.leer(ruta)
                when '.csv', '.txt' then leer_csv(ruta)
                when '.xls'
                  return { 'ok' => false, 'error' =>
                    'El formato .xls (Excel 97-2003) no se puede leer. Guárdalo como .xlsx o .csv.' }
                else
                  return { 'ok' => false, 'error' => "Formato no soportado: «#{ext}». Usa .xlsx o .csv." }
                end

        return { 'ok' => false, 'error' => 'El archivo está vacío.' } if tabla.nil? || tabla.empty?

        headers = tabla.shift.map { |h| h.to_s.strip }
        filas   = tabla.reject { |f| f.all? { |c| c.to_s.strip.empty? } }
                       .map { |f| f.map { |c| c.to_s } }

        return { 'ok' => false, 'error' => 'El archivo no tiene filas de datos.' } if filas.empty?

        truncado = filas.size > MAX_FILAS
        filas    = filas.first(MAX_FILAS)

        { 'ok' => true, 'headers' => headers, 'filas' => filas,
          'truncado' => truncado, 'max_filas' => MAX_FILAS,
          'formato' => ext.delete('.') }
      rescue => e
        { 'ok' => false, 'error' => e.message }
      end

      # ---------------------------------------------------------------------
      # CSV
      # ---------------------------------------------------------------------
      # «Guardar como CSV» de Excel en Windows escribe ANSI (Windows-1252), no
      # UTF-8: sin este respaldo, «Puerta uñero» y «Entrepaño» llegarían rotos y
      # no matchearían ninguna opción del manifiesto.
      def leer_csv(ruta)
        texto = File.binread(ruta).force_encoding('UTF-8')
        unless texto.valid_encoding?
          texto = texto.force_encoding('Windows-1252')
                       .encode('UTF-8', invalid: :replace, undef: :replace)
        end
        texto = texto.sub(/\A﻿/, '')   # BOM
        CSV.parse(texto, col_sep: separador(texto)).map { |f| f.map { |c| c.to_s } }
      end

      # El separador se deduce de la primera línea: el CSV viejo del proyecto usa
      # coma, pero Excel en configuración regional española exporta con «;».
      def separador(texto)
        linea = texto.to_s.lines.first.to_s
        [',', ';', "\t"].max_by { |s| linea.count(s) }
      end

    end
  end
end
