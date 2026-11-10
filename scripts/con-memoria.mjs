// Lanza un comando con más memoria para Node (`--max-old-space-size=4096`) en cualquier sistema, también en Windows, donde
// `VARIABLE=valor comando` no funciona en los scripts de npm. Lo usan `npm run build` y `npm run typecheck`: el chequeo completo de
// tipos del proyecto necesita unos 2,5 GB y el límite por defecto de Node ronda los 2,2 GB.
// Uso: node scripts/con-memoria.mjs <comando> [argumentos…]. Si NODE_OPTIONS ya fija ese límite, se respeta.
import { spawnSync } from "node:child_process";

const [comando, ...argumentos] = process.argv.slice(2);
if (!comando) {
  console.error("Uso: node scripts/con-memoria.mjs <comando> [argumentos…]");
  process.exit(2);
}

const previo = process.env.NODE_OPTIONS ?? "";
const NODE_OPTIONS = /--max-old-space-size/.test(previo) ? previo : `${previo} --max-old-space-size=4096`.trim();
const resultado = spawnSync(comando, argumentos, { stdio: "inherit", shell: true, env: { ...process.env, NODE_OPTIONS } });
if (resultado.error) {
  console.error(resultado.error.message);
  process.exit(1);
}
process.exit(resultado.status ?? 1);
