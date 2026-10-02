# datos

Carpeta para los archivos fuente del negocio (Excel y CSV de árbol de producto,
marcas, tiendas, ventas históricas) que se usan para cargar el sistema.

**Nada de esta carpeta se sube a GitHub** salvo este archivo. Dos razones:

1. Son archivos pesados y Git guarda cada versión completa.
2. Llevan información comercial real de Lukers; el código puede ser público,
   la data no.

Lo que sí está versionado es todo lo necesario para volver a leerlos: las
migraciones, los importadores y la documentación de cada formato en
`docs/modulos/`.
