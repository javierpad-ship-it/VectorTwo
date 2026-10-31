import type { Catalogo } from "@/lib/proyeccion/persistencia";
import type { ProveedorIA } from "@/lib/ia/proveedor";
import { ProveedorDinamico, sembrarIa, type Fila } from "./ia.fake-db";
import { ANIO, CALCULADO_AT, CLAVE_GM } from "./ia.escenario";

/**
 * Lo que las pruebas de la propuesta con IA sustituyen: el entorno (`IA_PROVEEDOR`, `IA_MODELO`), el adaptador (un proveedor falso, nunca la red) y el
 * catálogo de nombres de M7. Cada archivo de pruebas lo conecta con `vi.mock` (las fábricas importan este módulo).
 */

export const ctxIa = {
  catalogo: null as Catalogo | null,
  proveedor: new ProveedorDinamico() as ProveedorIA,
  hayClave: true,
  desactivada: false,
  proveedorId: "openai" as string | null,
  modelos: ["modelo-a", "modelo-b"],
};

export function reiniciarCtxIa() {
  ctxIa.catalogo = null;
  ctxIa.proveedor = new ProveedorDinamico();
  ctxIa.hayClave = true;
  ctxIa.desactivada = false;
  ctxIa.proveedorId = "openai";
  ctxIa.modelos = ["modelo-a", "modelo-b"];
}

export const entornoFalso = () => ({ proveedor: ctxIa.proveedorId, modelos: [...ctxIa.modelos], desactivada: ctxIa.desactivada });

export const adaptadorFalso = (entorno: { proveedor: string | null }) =>
  entorno.proveedor === "openai" ? { id: "openai", adaptador: { crear: () => ctxIa.proveedor, hayClave: () => ctxIa.hayClave } } : null;

/** Corrida de propuesta `en_curso` con su GM en `pendiente` (lo que dejaría `POST …/ia/corridas`). */
export function sembrarCorrida(proyeccionId: string, extra: { corrida?: Fila; gms?: string[]; configuracionId?: string | null } = {}): { corridaId: string; gmIds: string[] } {
  const [c] = sembrarIa("ia_corridas", [
    {
      tipo: "propuesta",
      proyeccion_id: proyeccionId,
      configuracion_id: extra.configuracionId ?? null,
      proveedor: "openai",
      modelo: "modelo-a",
      version_prompt: "v1",
      anio_en_curso: ANIO,
      k: 9,
      calculado_at_proyeccion: CALCULADO_AT,
      alcance: { gms: "todos", regenerar: false, semilla: null },
      costo_estimado_usd: 5,
      perfil_id: null,
      usuario_nombre: "Javier",
      ...extra.corrida,
    },
  ]);
  const gms = sembrarIa(
    "ia_corrida_gms",
    (extra.gms ?? [CLAVE_GM]).map((gm_clave) => ({ corrida_id: c.id, gm_clave }))
  );
  return { corridaId: c.id as string, gmIds: gms.map((g) => g.id as string) };
}
