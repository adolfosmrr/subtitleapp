# Subtitulador — instalación en macOS

## 1. Elegí el archivo correcto
- **Mac con Apple Silicon (M1, M2, M3, M4…)**: `Subtitulador-1.3.1-mac-arm64.zip`
- **Mac con Intel**: `Subtitulador-1.3.1-mac-x64.zip`

¿No sabés cuál tenés?  → Menú  > *Acerca de esta Mac*: si dice "Chip Apple M…", es Apple Silicon.

## 2. Instalá
1. Hacé doble clic en el `.zip`: se descomprime `Subtitulador.app`.
2. Arrastrá **Subtitulador.app** a la carpeta **Aplicaciones**.

## 3. Primera apertura (la app no está firmada por Apple)
Como la app no tiene firma de desarrollador de Apple, macOS la bloquea la primera vez. Tenés dos opciones:

**Opción A: con el mouse**
1. En Aplicaciones, hacé **clic derecho (o Control + clic) sobre Subtitulador > Abrir**.
2. En el aviso, tocá **Abrir** de nuevo. Solo hace falta la primera vez.
3. En macOS 15 (Sequoia) o posterior, si no aparece el botón "Abrir": andá a
   **Ajustes del Sistema > Privacidad y seguridad**, bajá hasta el aviso de "Subtitulador" y tocá **Abrir igualmente**.

**Opción B: con la Terminal** (sirve también si dice que la app "está dañada")
```bash
xattr -dr com.apple.quarantine /Applications/Subtitulador.app
```
Después la abrís normalmente.

## 4. Primer uso
1. **Abrir video o audio…** (o arrastrá el archivo sobre el reproductor).
2. **🎙 Transcribir**: la primera vez descarga el modelo de Whisper (Ajustes > Modelo; "Small" ≈ 250–500 MB).
   Vas a ver el progreso abajo. Después queda guardado y **funciona sin internet**.
   El idioma se detecta solo (inglés/español); si se equivoca, elegilo a mano en el selector "Idioma".
3. **🌐 Traducir**: inglés ↔ español, mantiene los tiempos. La primera vez descarga el traductor (~75 MB por dirección). ⌘Z vuelve atrás.
4. Editá texto y tiempos en la pestaña **Subtítulos** (⇤ / ⇥ ponen el inicio/fin en la posición actual del video).
5. Pestaña **Estilo**: fuente, tamaño, colores, borde, sombra, caja, posición (o arrastrá el subtítulo sobre el video). Guardá tus presets.
6. Pestaña **Exportar**: video con subtítulos quemados (misma resolución y fps; H.264, HEVC o ProRes 422 HQ), o solo `.srt` / `.ass`.

## Verificá que el archivo es el original
En la Terminal: `shasum -a 256 ~/Downloads/Subtitulador-1.3.1-mac-*.zip` y compará el resultado con `SHA256SUMS.txt` de la página de Releases. Tienen que ser iguales.

## Desinstalar
Borrá `Subtitulador.app` de Aplicaciones. Los modelos y presets quedan en
`~/Library/Application Support/Subtitulador` (podés borrar esa carpeta para liberar espacio).

## Novedades 1.3.1
- Revisión de seguridad completa: ventana en sandbox, política de contenido estricta, validación de proyectos y archivos, ffmpeg limitado a archivos de medios locales, modelos de IA fijados a versiones exactas y "fuses" de Electron endurecidos.
- Corregido: "Agregar en el cursor" fallaba desde la versión 1.3.
- La lista de proyectos recientes ya no se borra al cambiar el estilo.
- Los modelos se descargan una vez más (ahora están fijados a una revisión exacta).

## Novedades 1.2
- **Interlineado** y **sombra Sólida / Difuminada** en la pestaña Estilo (la vista previa coincide con el video exportado).
- **Proyectos (.subtitulador)**: Archivo › Nuevo (⌘N), Abrir (⌘O), Guardar (⌘S), Guardar como (⇧⌘S) y Abrir recientes. Guarda video, subtítulos, estilo, ajustes y opciones de exportación. Si moviste el video, lo busca al lado del proyecto o te ofrece ubicarlo. Doble clic en un `.subtitulador` lo abre en la app.
- **Exportar solo subtítulos**: MOV ProRes 4444 con transparencia (para Final Cut, Premiere, DaVinci), o MP4 sobre fondo verde/negro.
