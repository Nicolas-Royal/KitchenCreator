# encoding: UTF-8
# -----------------------------------------------------------------------------
#  Copia de ModuleUnifier/src/frente_mitered.rb (fuente de verdad: ModuleUnifier).
#  Se incluye en el plugin porque la línea de frente Mitered (l01_linea_frente=3)
#  necesita hornear la escala y la textura después de cada redraw del DC.
#  Si cambia allá, copiar de nuevo aquí.
# -----------------------------------------------------------------------------
# Frente MITERED (Royal Kitchen) — generador del componente dinámico TAP.Mitered
# ------------------------------------------------------------------------------
# Marco con chaflanes a inglete (45°) + panel levantado con bisel.
# Diseño (mm, desde el canto exterior):
#   chaflán exterior 12 · cara del marco 48 (marco = 60) · chaflán interior 10
#   · bisel del panel 50 · campo plano.   Esquina fija C = 120.
#
# Medidas variables sin deformar el diseño:
#   ANCHO / ALTO  -> 4 esquinas C×C fijas; solo se estiran largueros, travesaños
#                    y campo (el perfil nunca se escala a lo ancho).
#   GROSOR        -> el perfil tiene profundidades fijas (capa frontal de PROF mm);
#                    una placa trasera (MIT.Fondo) absorbe el resto del grosor.
#   TEXTURA       -> hornear() pasa la escala del DC a la geometría (escala 1) y
#                    reposiciona la textura a tamaño real con veta por pieza:
#                    largueros verticales, travesaños horizontales, esquinas
#                    partidas en el inglete, panel según u13veta.
#   Mínimos       -> ninguna medida calculada baja de u12minimo (1 mm): un sub-DC
#                    en 0 queda dañado de forma permanente.
# ------------------------------------------------------------------------------
module RK
  module Mitered
    %i[PERFIL C Y_CAMPO PROF VERSION D_MARCO].each { |k| remove_const(k) if const_defined?(k, false) }
    DA = "dynamic_attributes".freeze
    PERFIL = [
      [0, 5], [12, 0],     # chaflán exterior a inglete
      [60, 0],             # cara plana del marco: 60 mm desde el canto
      [70, 5],             # chaflán interior (inicio de la parte interna)
      [70, 9],             # escalón al panel
      [120, 3]             # bisel del panel levantado -> campo
    ].freeze
    C = PERFIL.last[0].to_f
    Y_CAMPO = PERFIL.last[1].to_f
    PROF = PERFIL.map(&:last).max.to_f # 9 mm: capa frontal con el perfil
    L0 = 100.0
    VETA = "rk_veta".freeze # atributo de cara: "h", "v" o "p" (panel)

    def self.pt(x, y, z) Geom::Point3d.new(x.to_f.mm, y.to_f.mm, z.to_f.mm) end

    def self.face(ents, pts, veta)
      u = pts.uniq { |p| p.to_a.map { |c| c.round(6) } }
      return if u.size < 3
      f = (ents.add_face(u) rescue nil)
      f.set_attribute(VETA, "d", veta) if f
      f
    end

    # Esquina inferior-izquierda (x, y, z); map la lleva a las otras 3 posiciones.
    # Mitad z<x = travesaño (veta h), mitad x<z = larguero (veta v).
    def self.esquina(ents, map)
      m = ->(a) { a.map { |p| map.call(*p) } }
      PERFIL.each_cons(2) do |(d1, y1), (d2, y2)|
        face(ents, m.([[d1, y1, d1], [C, y1, d1], [C, y2, d2], [d2, y2, d2]]), "h")
        face(ents, m.([[d1, y1, d1], [d1, y1, C], [d2, y2, C], [d2, y2, d2]]), "v")
      end
      y0 = PERFIL.first[1]
      face(ents, m.([[0, y0, 0], [C, y0, 0], [C, PROF, 0], [0, PROF, 0]]), "h")
      face(ents, m.([[0, y0, 0], [0, y0, C], [0, PROF, C], [0, PROF, 0]]), "v")
    end

    # Tramo recto: largo en x (0..L0), perfil en z. map lo gira a su posición.
    def self.larguero(ents, map, veta)
      m = ->(a) { a.map { |p| map.call(*p) } }
      PERFIL.each_cons(2) do |(d1, y1), (d2, y2)|
        face(ents, m.([[0, y1, d1], [L0, y1, d1], [L0, y2, d2], [0, y2, d2]]), veta)
      end
      y0 = PERFIL.first[1]
      face(ents, m.([[0, y0, 0], [L0, y0, 0], [L0, PROF, 0], [0, PROF, 0]]), veta)
    end

    def self.caja(ents, dx, dy, dz, veta, frente: true)
      p = ->(x, y, z) { pt(x, y, z) }
      q = [[0, 0, 0], [dx, 0, 0], [dx, 0, dz], [0, 0, dz]]
      face(ents, q.map { |a, _, c| p.(a, 0, c) }, veta) if frente
      face(ents, q.map { |a, _, c| p.(a, dy, c) }, veta)
      face(ents, [p.(0, 0, 0), p.(dx, 0, 0), p.(dx, dy, 0), p.(0, dy, 0)], veta)
      face(ents, [p.(0, 0, dz), p.(dx, 0, dz), p.(dx, dy, dz), p.(0, dy, dz)], veta)
      face(ents, [p.(0, 0, 0), p.(0, dy, 0), p.(0, dy, dz), p.(0, 0, dz)], veta)
      face(ents, [p.(dx, 0, 0), p.(dx, dy, 0), p.(dx, dy, dz), p.(dx, 0, dz)], veta)
    end

    # Oculta las aristas de unión entre piezas para que se lea como una pieza.
    def self.ocultar_uniones(ents, planos)
      return ents.grep(Sketchup::Edge).each { |e| e.hidden = true } if planos == :todas
      ents.grep(Sketchup::Edge).each do |e|
        a = e.start.position; b = e.end.position
        planos.each do |ax, v|
          i = { x: 0, y: 1, z: 2 }[ax]
          e.hidden = true if (a[i].to_mm - v).abs < 0.01 && (b[i].to_mm - v).abs < 0.01
        end
      end
    end

    def self.set(d, k, v, f = nil, len: false)
      d.set_attribute(DA, k, v)
      d.set_attribute(DA, "_#{k}_label", k)
      d.set_attribute(DA, "_#{k}_formula", f) if f
      d.set_attribute(DA, "_#{k}_formulaunits", "CENTIMETERS") if len
    end

    def self.pieza(model, nombre, &blk)
      d = model.definitions.add(nombre)
      blk.call(d.entities)
      d.set_attribute(DA, "_lengthunits", "CENTIMETERS")
      d.set_attribute(DA, "name", nombre)
      d
    end

    VERSION = 2 # v2: anillos (marco + interior) para frentes chicos
    D_MARCO = 60.0 # el marco termina donde empieza la parte interna

    # Perfil del anillo 1 (marco, 0..60) y anillo 2 (interior, 60..C, re-basado a 0)
    def self.perfil_anillo(n)
      if n == 1
        PERFIL.select { |d, _| d <= D_MARCO }
      else
        PERFIL.select { |d, _| d >= D_MARCO }.map { |d, y| [d - D_MARCO, y] }
      end
    end

    def self.esquina_anillo(ents, map, perfil, ancho, lados)
      m = ->(a) { a.map { |p| map.call(*p) } }
      perfil.each_cons(2) do |(d1, y1), (d2, y2)|
        face(ents, m.([[d1, y1, d1], [ancho, y1, d1], [ancho, y2, d2], [d2, y2, d2]]), "h")
        face(ents, m.([[d1, y1, d1], [d1, y1, ancho], [d2, y2, ancho], [d2, y2, d2]]), "v")
      end
      return unless lados
      y0 = perfil.first[1]
      face(ents, m.([[0, y0, 0], [ancho, y0, 0], [ancho, PROF, 0], [0, PROF, 0]]), "h")
      face(ents, m.([[0, y0, 0], [0, y0, ancho], [0, PROF, ancho], [0, PROF, 0]]), "v")
    end

    def self.tramo_anillo(ents, map, perfil, veta, lados)
      m = ->(a) { a.map { |p| map.call(*p) } }
      perfil.each_cons(2) do |(d1, y1), (d2, y2)|
        face(ents, m.([[0, y1, d1], [L0, y1, d1], [L0, y2, d2], [0, y2, d2]]), veta)
      end
      return unless lados
      y0 = perfil.first[1]
      face(ents, m.([[0, y0, 0], [L0, y0, 0], [L0, PROF, 0], [0, PROF, 0]]), veta)
    end

    # Crea TAP.Mitered (v2). Medidas por u01ancho/u02alto/u03espesor; dentro de un
    # PanelZX se cambian lenx/leny/lenz a parent!LenX/LenY/LenZ.
    # Adaptación a frentes chicos (sin deformar ingletes ni profundidades):
    #   disponible por lado A = (lado menor - campo mínimo)/2
    #   marco F = min(60, A)        -> el marco de 60 se respeta mientras quepa
    #   interior I = min(60, A - F) -> el bisel se reduce primero
    def self.crear(model, ancho = 450, alto = 720, espesor = 22)
      d = {}
      [[1, D_MARCO], [2, C - D_MARCO]].each do |n, w|
        pf = perfil_anillo(n)
        lados = n == 1
        k = "MIT#{n}."
        d[:"bl#{n}"] = pieza(model, "#{k}EsqInfIzq") { |e| esquina_anillo(e, ->(x, y, z) { pt(x, y, z) }, pf, w, lados); ocultar_uniones(e, [[:x, w], [:z, w]]) }
        d[:"br#{n}"] = pieza(model, "#{k}EsqInfDer") { |e| esquina_anillo(e, ->(x, y, z) { pt(w - x, y, z) }, pf, w, lados); ocultar_uniones(e, [[:x, 0], [:z, w]]) }
        d[:"tl#{n}"] = pieza(model, "#{k}EsqSupIzq") { |e| esquina_anillo(e, ->(x, y, z) { pt(x, y, w - z) }, pf, w, lados); ocultar_uniones(e, [[:x, w], [:z, 0]]) }
        d[:"tr#{n}"] = pieza(model, "#{k}EsqSupDer") { |e| esquina_anillo(e, ->(x, y, z) { pt(w - x, y, w - z) }, pf, w, lados); ocultar_uniones(e, [[:x, 0], [:z, 0]]) }
        d[:"b#{n}"] = pieza(model, "#{k}TravInf") { |e| tramo_anillo(e, ->(x, y, z) { pt(x, y, z) }, pf, "h", lados); ocultar_uniones(e, [[:x, 0], [:x, L0]]) }
        d[:"t#{n}"] = pieza(model, "#{k}TravSup") { |e| tramo_anillo(e, ->(x, y, z) { pt(x, y, w - z) }, pf, "h", lados); ocultar_uniones(e, [[:x, 0], [:x, L0]]) }
        d[:"l#{n}"] = pieza(model, "#{k}LargIzq") { |e| tramo_anillo(e, ->(x, y, z) { pt(z, y, x) }, pf, "v", lados); ocultar_uniones(e, [[:z, 0], [:z, L0]]) }
        d[:"r#{n}"] = pieza(model, "#{k}LargDer") { |e| tramo_anillo(e, ->(x, y, z) { pt(w - z, y, x) }, pf, "v", lados); ocultar_uniones(e, [[:z, 0], [:z, L0]]) }
      end
      d[:f] = pieza(model, "MIT.Campo") { |e| caja(e, L0, PROF - Y_CAMPO, L0, "p"); ocultar_uniones(e, :todas) }
      d[:k] = pieza(model, "MIT.Fondo") { |e| caja(e, L0, L0, L0, "p", frente: false) }

      top = model.definitions.add("TAP.Mitered")
      top.set_attribute(DA, "_lengthunits", "CENTIMETERS")
      top.set_attribute(DA, "name", "TAP.Mitered")
      set(top, "u00version", VERSION.to_s)
      set(top, "u01ancho", ancho.mm.to_f, len: true)
      set(top, "u02alto", alto.mm.to_f, len: true)
      set(top, "u03espesor", espesor.mm.to_f, len: true)
      set(top, "u11perfil", PROF.mm.to_f, len: true)
      set(top, "u12minimo", 1.mm.to_f, len: true)
      set(top, "u13veta", "1") # campo: 1 vertical, 2 horizontal
      set(top, "u14campomin", 20.mm.to_f, len: true)
      set(top, "u15marco", D_MARCO.mm.to_f, len: true)
      set(top, "u16interior", (C - D_MARCO).mm.to_f, len: true)
      set(top, "u17frentemin", 30.mm.to_f, len: true)
      set(top, "a20_material", "")
      set(top, "lenx", ancho.mm.to_f, "LARGEST(u01ancho,u17frentemin)")
      set(top, "leny", espesor.mm.to_f, "LARGEST(u03espesor,u11perfil+u12minimo)")
      set(top, "lenz", alto.mm.to_f, "LARGEST(u02alto,u17frentemin)")
      set(top, "u21disp", 0.0, "LARGEST((SMALLEST(LenX,LenZ)-u14campomin)/2,3*u12minimo)", len: true)
      set(top, "u22marco", 0.0, "SMALLEST(u15marco,u21disp-u12minimo)", len: true)
      set(top, "u23interior", 0.0, "LARGEST(SMALLEST(u16interior,u21disp-u22marco),u12minimo)", len: true)
      set(top, "u24esquina", 0.0, "u22marco+u23interior", len: true)

      f = "parent!u22marco"; i = "parent!u23interior"; c = "parent!u24esquina"; mn = "parent!u12minimo"
      py = "parent!u11perfil"
      l1x = "LARGEST(parent!LenX-2*#{f},#{mn})"; l1z = "LARGEST(parent!LenZ-2*#{f},#{mn})"
      l2x = "LARGEST(parent!LenX-2*#{c},#{mn})"; l2z = "LARGEST(parent!LenZ-2*#{c},#{mn})"
      pos = { # x, y, z, lenx, leny, lenz
        bl1: ["0", "0", "0", f, py, f],
        br1: ["parent!LenX-#{f}", "0", "0", f, py, f],
        tl1: ["0", "0", "parent!LenZ-#{f}", f, py, f],
        tr1: ["parent!LenX-#{f}", "0", "parent!LenZ-#{f}", f, py, f],
        b1: [f, "0", "0", l1x, py, f],
        t1: [f, "0", "parent!LenZ-#{f}", l1x, py, f],
        l1: ["0", "0", f, f, py, l1z],
        r1: ["parent!LenX-#{f}", "0", f, f, py, l1z],
        bl2: [f, "0", f, i, py, i],
        br2: ["parent!LenX-#{c}", "0", f, i, py, i],
        tl2: [f, "0", "parent!LenZ-#{c}", i, py, i],
        tr2: ["parent!LenX-#{c}", "0", "parent!LenZ-#{c}", i, py, i],
        b2: [c, "0", f, l2x, py, i],
        t2: [c, "0", "parent!LenZ-#{c}", l2x, py, i],
        l2: [f, "0", c, i, py, l2z],
        r2: ["parent!LenX-#{c}", "0", c, i, py, l2z],
        f: [c, "#{py}*#{(Y_CAMPO / PROF).round(6)}", c, l2x, "#{py}*#{((PROF - Y_CAMPO) / PROF).round(6)}", l2z],
        k: ["0", py, "0", "parent!LenX", "LARGEST(parent!LenY-#{py},#{mn})", "parent!LenZ"]
      }
      pos.each do |k, (fx, fy, fz, flx, fly, flz)|
        inst = top.entities.add_instance(d[k], Geom::Transformation.new)
        { "x" => fx, "y" => fy, "z" => fz, "lenx" => flx, "leny" => fly, "lenz" => flz }.each do |a, fm|
          set(d[k], a, 0.0, fm)
          inst.set_attribute(DA, "_inst__#{a}_formula", fm) if %w[x y z].include?(a)
        end
        set(d[k], "material", "", "parent!a20_material")
      end
      top
    end

    # --- Textura a escala real y veta por pieza ---------------------------------
    def self.mitereds(raiz)
      tops = []
      buscar = lambda do |ents|
        ents.grep(Sketchup::ComponentInstance).each do |c|
          next if c.hidden? # rama oculta (cajón/zona sin usar, otra línea): no se procesa
          next if c.definition.name =~ /Tirador|Tir\.|TBot|M\.N4|Bis|Simb|Corr|Acc\.|^MIT/
          if c.definition.name =~ /^TAP\.Mitered/ then tops << c
          else buscar.call(c.definition.entities) end
        end
      end
      if raiz.is_a?(Sketchup::ComponentInstance) && raiz.definition.name =~ /^TAP\.Mitered/
        tops << raiz
      else
        buscar.call(raiz.is_a?(Sketchup::ComponentInstance) ? raiz.definition.entities : raiz)
      end
      tops
    end

    def self.pintar(pieza, mat, veta_panel)
      # firma: si material, veta y medida no cambiaron, no se repinta (ahorra tiempo)
      bb = pieza.definition.bounds
      firma = [mat&.name, veta_panel, bb.width.to_mm.round(2), bb.height.to_mm.round(2), bb.depth.to_mm.round(2)].join("|")
      return if pieza.definition.get_attribute(VETA, "firma") == firma
      pieza.definition.set_attribute(VETA, "firma", firma)
      # origen común del frente (en coords de la pieza) para que la veta no salte entre piezas
      org = pieza.transformation.inverse * Geom::Point3d.new(0, 0, 0)
      pieza.definition.entities.grep(Sketchup::Face).each do |f|
        v = f.get_attribute(VETA, "d")
        next unless v
        if mat.nil? || mat.texture.nil?
          f.material = mat
          f.back_material = mat
          next
        end
        v = (veta_panel.to_s == "2" ? "h" : "v") if v == "p"
        eje = v == "v" ? Z_AXIS : X_AXIS
        n = f.normal
        a = eje - Geom::Vector3d.new(n.x * eje.dot(n), n.y * eje.dot(n), n.z * eje.dot(n))
        if a.length.to_f < 1e-6 # cara perpendicular al eje de la veta: usar el otro eje
          alt = v == "v" ? X_AXIS : Z_AXIS
          a = alt - Geom::Vector3d.new(n.x * alt.dot(n), n.y * alt.dot(n), n.z * alt.dot(n))
        end
        a.normalize!
        o = org.project_to_plane(f.plane)
        pts = [o, [0, 0], o.offset(a, mat.texture.width), [1, 0]]
        # ambos lados: las piezas en espejo tienen caras invertidas
        f.material = mat
        f.back_material = mat
        f.position_material(mat, pts, true)
        f.position_material(mat, pts, false)
      end
    end

    # Pasa la escala del DC a la geometría (instancias a escala 1) y re-mapea la
    # textura. Idempotente; se llama tras cada redibujado (ver HookRedraw).
    def self.hornear(raiz)
      n = 0
      mitereds(raiz).each do |top|
        next if top.hidden? # oculto (otra línea activa): se hornea cuando se vuelva visible
        mat = top.definition.get_attribute(DA, "a20_material").to_s
        mat = top.get_attribute(DA, "a20_material").to_s if top.get_attribute(DA, "a20_material")
        m = mat.empty? ? nil : top.model.materials[mat]
        vp = top.get_attribute(DA, "u13veta") || top.definition.get_attribute(DA, "u13veta")
        top.definition.entities.grep(Sketchup::ComponentInstance).each do |c|
          t = c.transformation
          sx, sy, sz = t.xscale, t.yscale, t.zscale
          # protección: una escala degenerada (pieza en ~0 por un error de fórmula) destruiría
          # la geometría al hornearla; se deja sin hornear y se avisa en consola.
          if [sx, sy, sz].any? { |v| v < 0.001 || v > 1000 }
            puts "RK::Mitered.hornear: escala inválida en #{c.definition.name} (#{[sx, sy, sz].map { |v| v.round(4) }}), no se hornea"
            next
          end
          unless [sx, sy, sz].all? { |v| (v - 1).abs < 1e-6 }
            c.make_unique if c.definition.instances.size > 1
            c.definition.entities.transform_entities(Geom::Transformation.scaling(sx, sy, sz),
                                                     c.definition.entities.to_a)
            c.transformation = Geom::Transformation.axes(t.origin, t.xaxis.normalize,
                                                         t.yaxis.normalize, t.zaxis.normalize)
            n += 1
          end
          pintar(c, m || c.material, vp)
        end
      end
      n
    end

    module HookRedraw
      def redraw_with_undo(entity, *args)
        r = super
        begin
          RK::Mitered.hornear(entity) if entity.is_a?(Sketchup::ComponentInstance) && entity.valid?
        rescue StandardError => e
          puts "RK::Mitered.hornear: #{e.message}"
        end
        r
      end
    end

    def self.instalar_hook
      return false unless defined?($dc_observers) && $dc_observers
      k = $dc_observers.get_latest_class.class
      k.prepend(HookRedraw) unless k.ancestors.include?(HookRedraw)
      true
    end
  end
end

RK::Mitered.instalar_hook
