# Plantilla "Blog publicador" en Elementor (la arma Facundo en wp-admin)

**Para qué sirve.** Los blogs que crea el publicador llegan como texto simple (título, imagen destacada y contenido). Esta plantilla les pone el diseño de la web (banner BLOG, compartir, notas recientes) **solo a las entradas que tengan la etiqueta `publicador`**. Los blogs viejos, que traen todo el diseño adentro de la propia entrada, no se tocan.

> Los nombres de los menús son los de Elementor Pro y pueden variar un poco según la versión. Esta guía no se probó en el sitio real: si algo no coincide con lo que ves, frená y avisame.

## 1. Crear la etiqueta
1. wp-admin → **Entradas → Etiquetas**.
2. Nombre: `publicador`. Identificador (slug): `publicador`. **Añadir**.

(El publicador intenta crearla solo, pero el rol Autor probablemente no pueda; por eso se hace a mano una vez.)

## 2. Duplicar la plantilla de entrada
1. **Plantillas → Theme Builder → Entrada individual** (Single Post).
2. Buscar **Interna-notas** (hoy inactiva). Menú de la fila → **Duplicar**.
3. Renombrar la copia a **Blog publicador**. Dejar la original como está.

## 3. Editar la copia
Abrirla con **Editar con Elementor**.
- Poner un widget **Título de la entrada** (Post Title) donde va el título.
- Poner un widget **Imagen destacada** (Featured Image) debajo del título.
- Poner un widget **Contenido de la entrada** (Post Content) donde va el texto.
- **Conservar** el banner BLOG, el bloque de compartir y las notas recientes.
- **No** agregar caja de autor ni carrusel arriba: el nombre del autor ya viene escrito como "Por ..." al principio del texto.

## 4. Condiciones de visualización
1. **Publicar** → flecha al lado → **Condiciones de visualización**.
2. **Incluir → Entradas → Con etiqueta → `publicador`**.
3. Guardar y publicar la plantilla.
4. Revisar que no haya otra plantilla de Entrada individual activa que compita para todas las entradas; si la hay, la de la etiqueta es más específica y debería ganar, pero conviene confirmarlo en el paso 5.

## 5. Probarla
1. Crear un borrador con el publicador (algo de prueba, con una imagen).
2. En WordPress abrir el borrador → **Vista previa**. Tiene que verse con el banner BLOG, el título, la imagen destacada, el texto y el resto del diseño.
3. Abrir un blog **viejo** (sin la etiqueta) y comprobar que se ve igual que antes.
4. Borrar el borrador de prueba.

## Si algo sale mal
- **El borrador se ve "pelado" (sin banner):** la entrada no tiene la etiqueta `publicador` o la condición del paso 4 no quedó guardada.
- **Un blog viejo cambió de aspecto:** la condición está tomando más entradas de las debidas. Volver a Condiciones y dejar solo "Con etiqueta → publicador", o desactivar la plantilla (los blogs viejos vuelven a como estaban).
- La plantilla se puede apagar en cualquier momento sin borrar nada: las entradas conservan su texto.
