// Se ejecuta antes de cada archivo de pruebas (ver vitest.config.ts): bloquea cualquier `fetch` a `anthropic.com` (ficha 07e, §5.7).
// Las pruebas de la IA usan `tests/ia.proveedor-falso.ts`; si algo intenta llamar al proveedor real, la prueba falla en vez de gastar.

const DOMINIO_BLOQUEADO = /(^|\.)anthropic\.com$/i;

export function urlBloqueada(entrada: unknown): boolean {
  let texto: string;
  if (typeof entrada === "string") texto = entrada;
  else if (entrada instanceof URL) texto = entrada.href;
  else if (entrada !== null && typeof entrada === "object" && "url" in entrada && typeof (entrada as { url: unknown }).url === "string") texto = (entrada as { url: string }).url;
  else return false;
  try {
    return DOMINIO_BLOQUEADO.test(new URL(texto).hostname);
  } catch {
    return /anthropic\.com/i.test(texto);
  }
}

const original = globalThis.fetch;

globalThis.fetch = ((entrada: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  if (urlBloqueada(entrada)) throw new Error("Las pruebas no pueden llamar a anthropic.com: usa tests/ia.proveedor-falso.ts.");
  return original(entrada, init);
}) as typeof fetch;
