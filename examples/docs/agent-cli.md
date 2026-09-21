# agent-cli

Agente de línea de comandos con uso de herramientas (tool use) sobre un LLM autoalojado con [Ollama](https://ollama.com), sin depender de ningún servicio de pago.

```
$ agent-cli "¿Qué tiempo hace en Madrid y cuánto es 15 * 23?" --verbose
→ clima({"ciudad":"Madrid"})
  "Madrid: ☁️  +28°C"
El tiempo en Madrid es nublado con una temperatura de 28°C. El resultado de 15 * 23 es 345.
```

## Por qué existe

Iba a usar el parámetro `tools` nativo de la API de Ollama (`/api/chat`), pero al probarlo contra `qwen2.5:3b` se quedaba colgado sin responder nunca, mientras que el mismo modelo sin `tools` respondía con normalidad. En vez de forzar el soporte nativo, este CLI usa el patrón **ReAct** implementado a mano — vía [`react-agent-loop`](https://www.npmjs.com/package/react-agent-loop), un paquete propio publicado por separado tras extraer el bucle del agente de este mismo proyecto, porque no tenía sentido dejarlo atado a un solo CLI cuando es igual de útil para cualquier cliente de chat. Aquí solo vive la parte específica de este proyecto: las herramientas y la interfaz de línea de comandos.

## Herramientas incluidas

| Herramienta | Qué hace |
|---|---|
| `clima` | Tiempo actual de una ciudad ([wttr.in](https://wttr.in), sin clave) |
| `repoGitHub` | Estrellas, descripción, lenguaje y licencia de un repo público de GitHub |
| `calcular` | Evalúa una expresión aritmética |
| `leerArchivo` | Lee un fichero de texto, restringido al directorio de trabajo |
| `listarDirectorio` | Lista el contenido de un directorio, restringido al directorio de trabajo |

`leerArchivo` y `listarDirectorio` están sandboxed: cualquier intento de salir del directorio de trabajo (`../../etc/passwd`, rutas absolutas fuera de él) se rechaza antes de tocar el sistema de ficheros.

## Uso

Requiere [Ollama](https://ollama.com) instalado y un modelo descargado (por defecto usa `qwen2.5:3b`):

```bash
ollama pull qwen2.5:3b
npm install
npm run build
node dist/cli.js "tu pregunta" [--verbose] [--workdir <ruta>] [--modelo <nombre>] [--host <url>]
```

Por defecto se conecta a `http://localhost:11434`. Variables de entorno equivalentes a los flags: `AGENT_MODEL`, `AGENT_OLLAMA_HOST`.

## Arquitectura

```
src/
├─ tools/          # cada herramienta implementa la interfaz Tool de react-agent-loop
└─ cli.ts          # parseo de argumentos, punto de entrada, llama a runReActAgent()
```

El bucle del agente y el cliente de Ollama viven en [`react-agent-loop`](https://github.com/JuanMiguelAbellan/react-agent-loop), no aquí. Añadir una herramienta nueva es implementar la interfaz `Tool` (de `react-agent-loop`) en `src/tools/` y añadirla al array de `crearHerramientas` — no hay que tocar nada del bucle del agente.

## Tests

```bash
npm test
```

Cubren el bucle del agente (encadenar herramientas, manejar errores de una herramienta sin romper la ejecución, cortar tras un máximo de iteraciones) con un cliente de Ollama simulado, y el sandboxing real de `leerArchivo`/`listarDirectorio` contra un directorio temporal.

## Stack

TypeScript, Node.js, [`react-agent-loop`](https://www.npmjs.com/package/react-agent-loop) (propio).
