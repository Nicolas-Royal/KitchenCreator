# encoding: UTF-8
# =============================================================================
#  Royal Catalog Creator — Registrar de la extensión
# =============================================================================
#  Punto de entrada que SketchUp descubre en su carpeta Plugins. Registra la
#  extensión y delega la carga real a royal_catalog_creator/main.rb.
# =============================================================================

require 'sketchup.rb'
require 'extensions.rb'

module RoyalKitchen
  module CatalogCreator

    unless defined?(@loaded) && @loaded
      PLUGIN_ID   = 'royal_catalog_creator'.freeze
      PLUGIN_NAME = 'Royal Catalog Creator'.freeze
      VERSION     = '1.0.0'.freeze

      ext = SketchupExtension.new(PLUGIN_NAME, File.join(PLUGIN_ID, 'main'))
      ext.version     = VERSION
      ext.creator     = 'Royal Kitchens'
      ext.copyright   = "© #{Time.now.year} Royal Kitchens"
      ext.description = 'Genera variaciones de muebles de catálogo ' \
                        '(Gabinete, Alacena, Esquinero) desde una interfaz visual, ' \
                        'sin editar CSV ni usar la consola Ruby.'

      Sketchup.register_extension(ext, true)
      @loaded = true
    end

  end
end
