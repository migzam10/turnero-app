# Vía .crx autohospedada — RETIRADA

Esta carpeta es la forma vieja de distribuir las extensiones: un `.crx`
firmado con `.pem` propio, servido desde el `public/` del servidor turnero
y anunciado por `updates.xml`.

**No la uses.** El despliegue vivo es por Chrome Web Store: `../LEEME_EXTENSION.txt`.

## Por qué se retiró

Chrome solo respeta `ExtensionInstallForcelist` apuntando a un `updates.xml`
propio en **equipos administrados** (dominio o gestión en la nube). En los PCs
sueltos de una clínica esa política se ignora en silencio: la extensión nunca
aparece y no da error claro. La Web Store cubre los dos casos.

Además obligaba a regenerar el `.crx` en Windows y a editar `updates.xml`
reemplazando `__SERVIDOR__` **por cada clínica**, porque la URL de
actualización lleva la IP. El `.bat` de tienda es idéntico para todas.

## Cuándo tendría sentido volver

Solo si algún cliente tiene los terminales **sin salida a internet**. Hoy no
aplica: navegan a `sso.biofile.com.co`, así que llegan a la tienda.

Para un arreglo urgente sin esperar la revisión de Google, la salida NO es
esta carpeta — es cargar `../build/<Nombre>/` descomprimida en modo
desarrollador. No necesita firma, `.crx` ni tocar el registro.

## Qué hay acá

| Archivo | Qué hacía |
|---|---|
| `empaquetar_crx.bat` | Genera los `.crx` firmados (solo Windows, necesita Chrome/Edge). |
| `instalar_extension.bat` | Política de registro apuntando al `updates.xml` del servidor. |
| `desinstalar_extension.bat` | Quita esas políticas. Escrito para los IDs viejos. |
| `updates.xml` | Manifiesto de actualización. Quedó anunciando la 1.1. |
| `biofile-*.crx` | Últimos paquetes generados (2026-07-18). Desactualizados. |
| `Biofile-*.pem` | **Llaves privadas de firma. No borrar, no subir a git.** |

Los IDs de esta vía (distintos a los de la tienda) son
`ecgjdgihieabgheihfahojkoapopjkjj` (Sync) y
`bjogofdcbpmglacnhnbkbphkbomhnkdl` (Injector), y dependen de los `.pem`:
si se pierden, el ID cambia y habría que reinstalar en todos los terminales.
Por eso se conservan aunque la vía esté retirada.
