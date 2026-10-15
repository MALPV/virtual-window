# Window

Widget de escritorio flotante con forma de ventana arquitectónica: marco con profundidad (bisel interior, parteluces y reflejo en el cristal) y un paisaje detrás que responde con parallax a la posición del cursor. Hecho con Tauri v2, para macOS, Windows y Linux.

## Requisitos

- Node.js 20 o superior
- Rust estable
- Dependencias de sistema de Tauri: https://tauri.app/start/prerequisites/

## Desarrollo

```bash
npm install
npm run tauri dev
```

## Build de distribución

```bash
npm run tauri build
```

Los instaladores quedan en `src-tauri/target/release/bundle/`. Cada sistema operativo se compila en su propia plataforma (o en CI con una matriz de runners).

## Interacción

- Arrastrar con el botón izquierdo en cualquier punto: mueve la ventana.
- Clic derecho: menú nativo con "Siempre encima", la atribución de los datos del clima y "Cerrar". El menú sale en español si el sistema está en español y en inglés en cualquier otro caso.
- Los bordes permiten redimensionar (tamaño mínimo 180x220).

## Cómo funciona el parallax

El backend (`src-tauri/src/cursor.rs`) consulta la posición global del cursor a unos 30 Hz y emite el evento `cursor-offset`, con el desplazamiento respecto al centro de la ventana normalizado a [-1, 1]. Solo lo emite cuando el valor cambia. El frontend lo suaviza con `requestAnimationFrame` y escribe `--px` / `--py`, y el CSS desplaza cada plano según su profundidad:

| Plano              | Profundidad |
|--------------------|-------------|
| Cielo              | 1.0         |
| Montañas lejanas   | 0.8         |
| Colinas y lago     | 0.55        |
| Pinos cercanos     | 0.3         |
| Derrame y hoja     | 6px fijos   |
| Reflejo del cristal| -0.4        |

## Hora, ubicación y clima

La escena refleja el momento y el lugar reales, sin texto:

- **Ubicación:** se obtiene por IP al arrancar (ipapi.co, con ipwho.is como respaldo). Se guarda en caché 12 horas en el directorio de caché de la app, solo latitud y longitud redondeadas a unos 1 km.
- **Sol:** su altura y posición se calculan astronómicamente (`src-tauri/src/solar.rs`) cada minuto. La ventana se asume orientada hacia el ecuador: al sur en el hemisferio norte y al norte en el sur. El trópico y las regiones polares están contemplados.
- **Clima:** se consulta en Open-Meteo cada 15 minutos. Si falla, se reintenta con espera creciente y el último dato se mantiene hasta 3 horas.
- **Representación:** color del cielo según la altura del sol, estrellas de noche, nubes según la nubosidad, niebla, lluvia, nieve, relámpagos, gotas en el cristal y escarcha bajo 1 °C. La lluvia y la nieve se inclinan según el viento.
- **Sin red:** si no hay ubicación, el ciclo día/noche se aproxima con la zona horaria del sistema.

Toda la red pasa por el backend en Rust. El frontend no tiene acceso a internet y la CSP no lo permite.

## Distribución pública

- **Privacidad:** la IP del usuario se envía a ipapi.co o ipwho.is para geolocalizar, y las coordenadas aproximadas a Open-Meteo. Si se distribuye públicamente, hay que declararlo en una política de privacidad.
- **Licencias de datos:** Open-Meteo es gratuito para uso no comercial y sus datos son CC BY 4.0. La atribución está en el menú contextual. Para uso comercial hacen falta los planes de pago de Open-Meteo y del proveedor de geolocalización.
- **Firma de código:** para que los usuarios puedan instalarlo sin avisos de seguridad hace falta notarizar en macOS (Apple Developer ID) y firmar en Windows.

## Limitaciones conocidas

- Con VPN, la ubicación será la del servidor de la VPN.
- La luna no se representa todavía.
- Linux con Wayland no expone la posición global del cursor, así que el parallax solo reacciona con el cursor dentro de la ventana. Wayland tampoco garantiza "siempre encima". En X11 funciona completo.
- Si el sistema tiene activado "reducir movimiento", el parallax se desactiva y la lluvia y la nieve quedan estáticas.
