// Se ejecuta antes de cada archivo de pruebas (ver vitest.config.ts): bloquea cualquier `fetch` a `openai.com` o `anthropic.com` (ficha 07e, §5.7 y §11.3).
// Las pruebas de la IA usan `tests/ia.proveedor-falso.ts`; si algo intenta llamar al proveedor real, la prueba falla en vez de gastar.

const DOMINIOS_BLOQUEADOS = /(^|\.)(openai|anthropic)\.com$/i;
const DOMINIOS_EN_TEXTO = /(openai|anthropic)\.com/i;

export function urlBloqueada(entrada: unknown): boolean {
  let texto: string;
  if (typeof entrada === "string") texto = entrada;
  else if (entrada instanceof URL) texto = entrada.href;
  else if (entrada !== null && typeof entrada === "object" && "url" in entrada && typeof (entrada as { url: unknown }).url === "string") texto = (entrada as { url: string }).url;
  else return false;
  try {
    return DOMINIOS_BLOQUEADOS.test(new URL(texto).hostname);
  } catch {
    return DOMINIOS_EN_TEXTO.test(texto);
  }
}

const original = globalThis.fetch;

globalThis.fetch = ((entrada: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  if (urlBloqueada(entrada)) throw new Error("Las pruebas no pueden llamar a openai.com ni a anthropic.com: usa tests/ia.proveedor-falso.ts.");
  return original(entrada, init);
}) as typeof fetch;
