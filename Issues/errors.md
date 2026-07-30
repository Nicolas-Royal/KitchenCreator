## Entrepaño y Divisores

1. ✅ **Resuelto.** cuando el margen frontal del divisor sea 0 asignar nombre divisor, si es mayor a 0 sera entrepaño. El nombre a modificar se debe de aplicar en el ultimo objeto de la jerarquia, en el hijo de la copia. como se muestra en la imagen, el objeto esta dentro del divisor/entrepaño donde se realiza la copia.
![alt text](image-3.png)

   > Ajuste acordado: el nombre lo decide el **modo elegido** en el desplegable del punto 3, no una comparación numérica — un margen personalizado de 0 mm sigue siendo `Entrepaño`.
   > La UI resuelve la lista (`reglas_divisores` del manifiesto) y el motor solo la aplica sobre la instancia hoja, ordenando las copias por `z` (división 1 = la de abajo). Estructura y orden confirmados con `Issues/diag_divisores.rb`.

2. ✅ **Resuelto.** cuando el tipo de medida de entrepaños sea "separaciones iguales" que se oscurescan (desactiven) para no meter informacion en todas los campos de espacio 1,2,3,etc.

   > `habilitado_si` sobre `divisor>f02tipomedida = 2` en los 21 campos `f03espacioN` de las tres familias. Quedan oscurecidos y fuera de la fila plana.

3. ✅ **Resuelto.** En cada campo de margen de los entrepaños que despliegue las opciones Divisor/Entrepaño/Personalizado donde divisor inyecta el valor 0, entrepaño no inyecta nada debido a que ya tiene una formula por defecto y personalizado que active el campo para meter una cantidad en mm y se inyecte.

   > `g01margenf1..6` pasan a `tipo: "preset"` en Gabinete y Alacena. Default «Entrepaño». Esquinero no tiene estos campos (usa márgenes de planta) y se dejó igual.

## Gabinete General
4. ✅ **Resuelto.** Agregar un campo con las opciones "con ceja" o "sin ceja", la cual se inyectara en la variable cejaselect donde inyecta 1 cuando es ceja, o 2 cuando no.

   > Campo «Ceja» en el grupo «Frente y puertas» de Gabinete, atributo de raíz `cejaselect`, default «Con ceja».

5. ✅ **Resuelto.** El campo de Profundidad y altura incluye automaticamente medidas como la puerta o zoclo dentro de las medidas, me gustaria hacerlas individual internamente y que se inyecten los valores adecuados. Por ejemplo si en el plugin en campo altura le pongo 600mm que la altura final en sketchup sume los 600mm mas la altura de zoclo. o la profundidad que si pongo 500mm me sume el grosor de la puerta.

   > Ajuste declarativo `suma` en el manifiesto. El espesor de puerta se suma solo con puerta exterior. La UI muestra «Total en SketchUp: N mm».

## Esquinero (prompt-30)

6. ✅ **Resuelto.** En esquinero agregar los campos LenX (ancho izquierdo), LenY (ancho derecho), LenZ (alto), a0101profizq (prof. izquierda) y a0102profder (prof. derecha).

   > Solo datos, en el grupo Dimensiones de `esquinero.json`. Las dos profundidades son atributos de
   > raíz y se llevan el ajuste `suma` del espesor de puerta que antes tenía `LenY`; `LenZ` conserva
   > el zócalo. Alcance acordado: no se portan `cejaselect`, cantidad de puertas ni cajones.

7. ✅ **Resuelto.** Unir las dos piezas de cada entrepaño en una sola y nombrarla «Entrepaño».

   > `reglas_union` en el manifiesto → `Engine.unir_piezas`, después del redibujado y antes de la
   > limpieza. Se unen **copias limpias** de cada mitad: el prisma original no es `manifold?` porque
   > trae colgando un grupo `SPanel`. Requiere SketchUp Pro; sin Pro sale un aviso y las mitades
   > quedan separadas. Estructura confirmada con `Issues/diag_entrepanos.rb`.





