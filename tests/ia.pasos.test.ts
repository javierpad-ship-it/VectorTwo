import { beforeEach, describe, expect, it, vi } from "vitest";
import { estado as base, estadoIa, reiniciar, sembrarIa, ProveedorDinamico, type Fila } from "./ia.fake-db";
import { ctxIa, reiniciarCtxIa, sembrarCorrida } from "./ia.contexto-falso";
import { AM, CLAVE_GM, FILAS_A, filasGrandes, sembrarConfig, sembrarGM, type EscenarioSembrado } from "./ia.escenario";
import { claveInvalida401, jsonInvalido, limite429, negativa, sobrecarga, tiempoAgotado, truncada, valida } from "./ia.proveedor-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteIaFalso } = await import("./ia.fake-db");
  return { supabaseAdmin: () => clienteIaFalso() };
});
vi.mock("@/lib/proyeccion/contexto", async (original) => {
  const real = await original<typeof import("@/lib/proyeccion/contexto")>();
  const c = await import("./ia.contexto-falso");
  return { ...real, cargarCatalogo: async () => ({ data: { catalogo: c.ctxIa.catalogo, equivalencias: [], nodosDb: [], generos: [] }, respuesta: null }) };
});
vi.mock("@/lib/ia/entorno", async () => ({ leerEntornoIa: (await import("./ia.contexto-falso")).entornoFalso }));
vi.mock("@/lib/ia/proveedores", async () => ({ adaptadorDelEntorno: (await import("./ia.contexto-falso")).adaptadorFalso, proveedoresRegistrados: () => ["openai"] }));

import { delLoteJerarquico, pasoGM } from "@/lib/ia/servicio-pasos";
import { terminarCorrida } from "@/lib/ia/servicio";
import { ErrorSolicitudInvalida } from "@/lib/ia/proveedor";
import { componerPropuesta, type EstadoPlanIa } from "@/lib/ia/propuesta";
import { crearSemaforo, diaLima, esperaTras429, esperaTrasFallo, mesLima, rangoDiaLima, rangoMesLima } from "@/lib/ia/limites";
import { sanearRegistro } from "@/lib/ia/registro";
import { describirErrorRegistro } from "@/lib/ia/consultas";
import type { PasoGMApi } from "@/lib/ia/tipos-api";

const ACTOR = { id: "99999999-9999-4999-8999-999999999999", nombre: "Javier" };
const filas = (t: string): Fila[] => base.tablas[t] ?? [];
let esc: EscenarioSembrado;
let prov: ProveedorDinamico;

async function paso(corridaId: string, clave = CLAVE_GM): Promise<{ status: number; cuerpo: PasoGMApi & { codigo?: string; error?: string; motivo?: string } }> {
  const r = await pasoGM(esc.proyeccionId, corridaId, clave, ACTOR);
  if (r.respuesta) return { status: r.respuesta.status, cuerpo: (await r.respuesta.json()) as never };
  return { status: 200, cuerpo: r.data as never };
}

/** Repite el paso hasta que el GM termine (o falle). */
async function correr(corridaId: string, max = 20) {
  let ultimo = await paso(corridaId);
  for (let i = 0; i < max && ultimo.status === 200 && ultimo.cuerpo.siguiente !== "hecho" && ultimo.cuerpo.siguiente !== "fallido"; i++) ultimo = await paso(corridaId);
  return ultimo;
}

function iniciar(semilla = FILAS_A, extraConfig: Fila = {}, extraCorrida: Fila = {}) {
  esc = sembrarGM(semilla);
  ctxIa.catalogo = esc.catalogo;
  const cfg = sembrarConfig(extraConfig);
  const c = sembrarCorrida(esc.proyeccionId, { configuracionId: cfg.id as string, corrida: { ultima_actividad_at: new Date().toISOString(), ...extraCorrida } });
  return { ...c, cfg };
}

beforeEach(() => {
  reiniciar();
  reiniciarCtxIa();
  prov = new ProveedorDinamico();
  ctxIa.proveedor = prov;
});

describe("pasos de un GM, modo directo (ejemplo A)", () => {
  it("el primer paso no llama; después una llamada por petición (natural y reparto) y la propuesta suma exactamente la meta", async () => {
    const { corridaId } = iniciar();
    const p1 = await paso(corridaId);
    expect(p1.status).toBe(200);
    expect(p1.cuerpo).toMatchObject({ estado: "en_proceso", pasos_hechos: 0, pasos_total: 2, siguiente: "continuar" });
    expect(prov.llamadas).toBe(0);
    const p2 = await paso(corridaId);
    expect(prov.llamadas).toBe(1);
    expect(p2.cuerpo).toMatchObject({ pasos_hechos: 1, siguiente: "continuar" });
    const p3 = await paso(corridaId);
    expect(prov.llamadas).toBe(2);
    expect(p3.cuerpo).toMatchObject({ estado: "hecho", siguiente: "hecho" });

    const [prop] = filas("ia_propuestas_gm");
    expect(prop).toMatchObject({ gm_clave: CLAVE_GM, modo: "directo", proveedor: "openai", modelo: "modelo-a", version_prompt: "v1", filas_pedidas: 3, filas_validas: 3 });
    expect(prop.meta).toMatchObject({ meta_gm: 26006, fijas: 3386, meta_libre: 22620, filas_libres: 3, filas_fijas: 2 });
    const hijas = filas("ia_propuestas_filas").filter((f) => f.propuesta_gm_id === prop.id);
    const libres = hijas.filter((f) => f.estado_meta === "libre");
    expect(libres).toHaveLength(3);
    expect(libres.reduce((s, f) => s + (f.meta_y1_al_generar as number), 0)).toBe(22620);
    expect(hijas.filter((f) => f.estado_meta === "fija_decidida")).toHaveLength(1);
    // La cola larga no se guarda por fila.
    expect(hijas).toHaveLength(4);
    expect(filas("ia_corrida_gms")[0]).toMatchObject({ estado: "hecho", propuesta_gm_id: prop.id, candado_token: null });
    expect(filas("ia_corridas")[0].estado).toBe("completa");
  });

  it("la llamada natural no lleva la meta ni nada derivado de ella (R10) y el reparto sí", async () => {
    const { corridaId } = iniciar();
    await correr(corridaId);
    const [nat, rep] = prov.peticiones;
    expect(nat.sufijo).toBe('{"tarea":"natural"}');
    expect(nat.bloque).not.toMatch(/"(meta|pct|propuesta|g)"/);
    expect(JSON.parse(rep.sufijo)).toMatchObject({ tarea: "reparto", meta: { total: 26006, fijas: 3386, libre: 22620, del_lote: 22620, sobre: "corregida", pct: 8 } });
    expect(rep.bloque).toBe(nat.bloque);
    expect(nat.nombre_esquema).toBe("salida_natural");
    expect(nat.max_tokens).toBe(16000);
  });

  it("registra cada llamada con tokens disjuntos y el costo del ejemplo G (R14); la corrida suma lo gastado (R33)", async () => {
    const { corridaId } = iniciar();
    await correr(corridaId);
    const ll = filas("ia_llamadas");
    expect(ll).toHaveLength(2);
    expect(ll[0]).toMatchObject({ estado: "ok", intento: 1, tokens_entrada: 4200, tokens_entrada_cache: 5400, tokens_salida: 1900, costo_usd: 0.0263, perfil_id: ACTOR.id, tipo_llamada: "natural", paso: "n1" });
    expect(ll[0].huella_llamada).toMatch(/^[0-9a-f]{64}$/);
    expect(ll[1].tipo_llamada).toBe("reparto");
    expect(ll[1].entrada_sufijo_id).not.toBeNull();
    const r = await terminarCorrida(esc.proyeccionId, corridaId, { cancelar: false });
    expect(r.data).toMatchObject({ estado: "completa", gm_total: 1, gm_hechos: 1, gm_reusados: 0, gm_fallidos: 0, costo_usd: 0.0526 });
    expect((await paso(corridaId)).cuerpo.codigo).toBe("corrida_terminada");
    // Lo enviado queda guardado, canónico y comprimido (D13).
    expect(filas("ia_entradas").map((e) => e.tipo).sort()).toEqual(["bloque", "sufijo_reparto"]);
  });

  it("nada de lo enviado ni lo recibido llega a los logs (R26)", async () => {
    const { corridaId } = iniciar();
    const espia = vi.spyOn(console, "info").mockImplementation(() => {});
    const espiaErr = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await correr(corridaId);
      const texto = JSON.stringify([...espia.mock.calls, ...espiaErr.mock.calls]);
      expect(espia).toHaveBeenCalled();
      expect(texto).not.toContain("DENIM");
      expect(texto).not.toContain("Crece 2 %");
      expect(texto).not.toContain("razon");
    } finally {
      espia.mockRestore();
      espiaErr.mockRestore();
    }
  });

  it("sin filas libres no llama a nadie (`sin_filas_libres`)", async () => {
    const { corridaId } = iniciar(FILAS_A.map((f) => ({ ...f, decidido: f.P })));
    const p = await paso(corridaId);
    expect(p.cuerpo).toMatchObject({ estado: "sin_filas_libres", siguiente: "hecho" });
    expect(prov.llamadas).toBe(0);
    expect(filas("ia_propuestas_gm")).toHaveLength(0);
  });

  it("un término prohibido que sobrevive al alias bloquea el GM: 0 llamadas (R11)", async () => {
    const { corridaId } = iniciar(FILAS_A.map((f, i) => (i === 0 ? { ...f, linea: "DENIM 2025" } : f)));
    const p = await paso(corridaId);
    expect(p.cuerpo).toMatchObject({ estado: "bloqueado_privacidad", siguiente: "hecho" });
    expect(prov.llamadas).toBe(0);
    expect(filas("ia_corrida_gms")[0].error_codigo).toBe("privacidad");
  });

  it("los nombres de marca se envían con alias y se restituyen en las razones guardadas (R11)", async () => {
    const { corridaId } = iniciar(FILAS_A);
    sembrarIa("marcas", [{ id: AM.rec, nombre: "RECONOCIDO" }]);
    prov.encolar();
    await paso(corridaId);
    await paso(corridaId); // natural
    const enviado = prov.peticiones[0].bloque;
    expect(enviado).not.toContain("RECONOCIDO");
    expect(enviado).toContain("MARCA_A");
  });
});

describe("reuso por huella (R29)", () => {
  it("la misma huella se reusa sin llamar; «regenerar» llama y la nueva es la vigente", async () => {
    const { corridaId, cfg } = iniciar();
    await correr(corridaId);
    const llamadas = prov.llamadas;
    const c2 = sembrarCorrida(esc.proyeccionId, { configuracionId: cfg.id as string, corrida: { ultima_actividad_at: new Date().toISOString() } });
    const r = await correr(c2.corridaId);
    expect(r.cuerpo).toMatchObject({ estado: "reusado", siguiente: "hecho" });
    expect(prov.llamadas).toBe(llamadas);
    expect(filas("ia_propuestas_gm")).toHaveLength(1);
    const reusado = filas("ia_corrida_gms").find((g) => g.corrida_id === c2.corridaId);
    expect(reusado?.propuesta_gm_id).toBe(filas("ia_propuestas_gm")[0].id);

    const c3 = sembrarCorrida(esc.proyeccionId, { configuracionId: cfg.id as string, corrida: { ultima_actividad_at: new Date().toISOString(), alcance: { gms: "todos", regenerar: true, semilla: null } } });
    const r3 = await correr(c3.corridaId);
    expect(r3.cuerpo.estado).toBe("hecho");
    expect(prov.llamadas).toBe(llamadas + 2);
    expect(filas("ia_propuestas_gm")).toHaveLength(2);
  });

  it("cambiar el modelo de la corrida cambia la huella: no reusa", async () => {
    const { corridaId, cfg } = iniciar();
    await correr(corridaId);
    const llamadas = prov.llamadas;
    base.tablas.ia_configuraciones[0].modelo = "modelo-b";
    const c2 = sembrarCorrida(esc.proyeccionId, { configuracionId: cfg.id as string, corrida: { modelo: "modelo-b", ultima_actividad_at: new Date().toISOString() } });
    await correr(c2.corridaId);
    expect(prov.llamadas).toBe(llamadas + 2);
  });
});

describe("errores y reintentos (R15)", () => {
  it("un 429 no es un error HTTP: responde `esperar` con lo que pidió el proveedor y no gasta el intento", async () => {
    const { corridaId } = iniciar();
    await paso(corridaId);
    prov.encolar(limite429(1500));
    const p = await paso(corridaId);
    expect(p).toMatchObject({ status: 200, cuerpo: { siguiente: "esperar", esperar_ms: 1500, estado: "en_proceso" } });
    expect(filas("ia_llamadas")[0]).toMatchObject({ estado: "limite_proveedor", error_codigo: "429", esperar_ms: 1500, intento: 1 });
    const q = await paso(corridaId);
    expect(q.cuerpo.siguiente).toBe("continuar");
    expect(filas("ia_llamadas")[1]).toMatchObject({ estado: "ok", intento: 1 });
  });

  it("10 esperas seguidas por 429 detienen la corrida (`limite_proveedor`); el GM sigue pendiente", async () => {
    const { corridaId } = iniciar();
    await paso(corridaId);
    for (let i = 0; i < 9; i++) {
      prov.encolar(limite429(10));
      expect((await paso(corridaId)).cuerpo.siguiente).toBe("esperar");
    }
    prov.encolar(limite429(10));
    const ultimo = await paso(corridaId);
    expect(ultimo.status).toBe(409);
    expect(ultimo.cuerpo.codigo).toBe("limite_proveedor");
    expect(filas("ia_corridas")[0]).toMatchObject({ estado: "detenida", motivo_fin: "limite_proveedor" });
    expect(filas("ia_corrida_gms")[0].estado).toBe("en_proceso");
    expect((await paso(corridaId)).cuerpo.codigo).toBe("corrida_terminada");
  });

  it("una sobrecarga tres veces deja el GM fallido, esperando 2 s y 8 s entre intentos", async () => {
    const { corridaId } = iniciar();
    await paso(corridaId);
    prov.encolar(sobrecarga(), sobrecarga(), sobrecarga());
    const a = await paso(corridaId);
    const b = await paso(corridaId);
    const c = await paso(corridaId);
    expect([a.cuerpo.siguiente, a.cuerpo.esperar_ms]).toEqual(["esperar", 2000]);
    expect([b.cuerpo.siguiente, b.cuerpo.esperar_ms]).toEqual(["esperar", 8000]);
    expect([c.cuerpo.estado, c.cuerpo.siguiente]).toEqual(["fallido", "fallido"]);
    expect(filas("ia_llamadas").map((l) => [l.estado, l.intento])).toEqual([["error_proveedor", 1], ["error_proveedor", 2], ["error_proveedor", 3]]);
    expect(filas("ia_corrida_gms")[0]).toMatchObject({ estado: "fallido", error_codigo: "proveedor" });
    expect(filas("ia_corridas")[0].estado).toBe("parcial");
  });

  it("un tiempo agotado cuenta como fallo del servicio", async () => {
    const { corridaId } = iniciar();
    await paso(corridaId);
    prov.encolar(tiempoAgotado());
    const p = await paso(corridaId);
    expect(p.cuerpo.siguiente).toBe("esperar");
    expect(filas("ia_llamadas")[0].estado).toBe("tiempo_agotado");
  });

  it("3 GM seguidos fallidos por el proveedor detienen la corrida (`proveedor_inestable`); los 429 no cuentan", async () => {
    const { corridaId, gmIds } = iniciar();
    sembrarIa("ia_corrida_gms", [
      { corrida_id: base.tablas.ia_corridas[0].id, gm_clave: "otro-1", estado: "fallido", error_codigo: "proveedor" },
      { corrida_id: base.tablas.ia_corridas[0].id, gm_clave: "otro-2", estado: "fallido", error_codigo: "proveedor" },
    ]);
    expect(gmIds).toHaveLength(1);
    await paso(corridaId);
    prov.encolar(sobrecarga(), sobrecarga(), sobrecarga());
    await correr(corridaId, 4);
    expect(filas("ia_corridas")[0]).toMatchObject({ estado: "detenida", motivo_fin: "proveedor_inestable" });
  });

  it("un 400 no se reintenta: GM fallido por la solicitud, sin cortar el circuito", async () => {
    const { corridaId } = iniciar();
    await paso(corridaId);
    prov.encolar(new ErrorSolicitudInvalida());
    const p = await paso(corridaId);
    expect(p.cuerpo).toMatchObject({ estado: "fallido", siguiente: "fallido" });
    expect(filas("ia_llamadas")).toHaveLength(1);
    expect(filas("ia_llamadas")[0]).toMatchObject({ estado: "error_proveedor", error_codigo: "400" });
    expect(filas("ia_corrida_gms")[0].error_codigo).toBe("solicitud_invalida");
    expect(filas("ia_corridas")[0].estado).toBe("parcial");
  });

  it("un 401 detiene la corrida y deja el servicio en `clave_invalida`", async () => {
    const { corridaId } = iniciar();
    await paso(corridaId);
    prov.encolar(claveInvalida401());
    const p = await paso(corridaId);
    expect(p.status).toBe(409);
    expect(p.cuerpo).toMatchObject({ codigo: "ia_no_disponible", motivo: "clave_invalida" });
    expect(filas("ia_corridas")[0]).toMatchObject({ estado: "detenida", motivo_fin: "clave_invalida" });
    expect(filas("ia_llamadas")[0].estado).toBe("clave_invalida");
  });

  it("una negativa del modelo no se reintenta", async () => {
    const { corridaId } = iniciar();
    await paso(corridaId);
    prov.encolar(negativa());
    const p = await paso(corridaId);
    expect(p.cuerpo).toMatchObject({ estado: "fallido", siguiente: "fallido" });
    expect(filas("ia_llamadas")[0].estado).toBe("rechazada");
  });

  it("salida inválida: un solo reintento con los errores resumidos SIN datos; la segunda falla deja el GM fallido", async () => {
    const { corridaId } = iniciar();
    await paso(corridaId);
    prov.encolar(jsonInvalido());
    const a = await paso(corridaId);
    expect(a.cuerpo.siguiente).toBe("continuar");
    expect(filas("ia_llamadas")[0]).toMatchObject({ estado: "invalida", error_codigo: "zod" });
    const b = await paso(corridaId);
    expect(b.cuerpo.siguiente).toBe("continuar");
    expect(prov.peticiones[1].correccion).toMatch(/^la respuesta no es JSON válido/);
    expect(prov.peticiones[0].correccion).toBeNull();

    // Una segunda invalidez en el mismo paso: fallido.
    const otra = iniciarOtra();
    await paso(otra.corridaId);
    prov.encolar(jsonInvalido(), jsonInvalido());
    await paso(otra.corridaId);
    const f = await paso(otra.corridaId);
    expect(f.cuerpo).toMatchObject({ estado: "fallido" });
  });

  it("un reparto que no suma la meta (+20 %) es inválido; con +5 % pasa con aviso `ia_no_cuadro`", async () => {
    const { corridaId } = iniciar();
    prov.factorSuma = 1.2;
    const r = await correr(corridaId);
    expect(r.cuerpo.estado).toBe("fallido");
    expect(filas("ia_llamadas").some((l) => l.error_codigo === "no_cuadra")).toBe(true);

    const otra = iniciarOtra();
    prov.factorSuma = 1.05;
    const ok = await correr(otra.corridaId);
    expect(ok.cuerpo.estado).toBe("hecho");
    const prop = filas("ia_propuestas_gm").at(-1) as Fila;
    expect(prop.avisos).toContain("ia_no_cuadro");
    const libres = filas("ia_propuestas_filas").filter((f) => f.propuesta_gm_id === prop.id && f.estado_meta === "libre");
    expect(libres.reduce((s, f) => s + (f.meta_y1_al_generar as number), 0)).toBe(22620);
  });

  it("un corte por límite de salida parte el lote en dos una sola vez", async () => {
    const { corridaId } = iniciar(filasGrandes(30, 1));
    await paso(corridaId);
    expect(filas("ia_corrida_gms")[0]).toMatchObject({ modo: "directo" });
    prov.encolar(truncada());
    const p = await paso(corridaId);
    expect(p.cuerpo.siguiente).toBe("continuar");
    expect(filas("ia_llamadas")[0].estado).toBe("truncada");
    const gm = filas("ia_corrida_gms")[0];
    expect(gm.modo).toBe("jerarquico");
    expect((gm.plan as { id: string }[]).map((x) => x.id)).toEqual(["n1", "n2", "l", "r1", "r2"]);
    prov.encolar(truncada());
    const q = await paso(corridaId);
    expect(q.cuerpo.estado).toBe("fallido");
  });
});

describe("candado por GM (I6)", () => {
  it("dos pasos simultáneos: uno recibe 409 `gm_en_proceso` y hay una sola llamada", async () => {
    const { corridaId } = iniciar();
    await paso(corridaId);
    const [a, b] = await Promise.all([paso(corridaId), paso(corridaId)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((x) => x.status === 409)?.cuerpo.codigo).toBe("gm_en_proceso");
    expect(prov.llamadas).toBe(1);
    expect(filas("ia_llamadas")).toHaveLength(1);
  });

  it("un candado vencido se puede retomar; uno vigente no", async () => {
    const { corridaId } = iniciar();
    await paso(corridaId);
    const gm = filas("ia_corrida_gms")[0];
    gm.candado_token = "11111111-1111-4111-8111-111111111111";
    gm.candado_desde = new Date().toISOString();
    expect((await paso(corridaId)).cuerpo.codigo).toBe("gm_en_proceso");
    gm.candado_desde = "2020-01-01T00:00:00.000Z";
    expect((await paso(corridaId)).status).toBe(200);
    expect(prov.llamadas).toBe(1);
  });
});

describe("topes (R14) y datos que cambian (R30)", () => {
  it("antes de la llamada que pasaría el tope de la corrida, la corrida se detiene (`tope_corrida`)", async () => {
    const { corridaId } = iniciar(FILAS_A, { tope_usd_corrida: 0.001 });
    await paso(corridaId);
    const p = await paso(corridaId);
    expect(p.status).toBe(409);
    expect(p.cuerpo.codigo).toBe("tope_corrida");
    expect(prov.llamadas).toBe(0);
    expect(filas("ia_corridas")[0]).toMatchObject({ estado: "detenida", motivo_fin: "tope_corrida" });
  });

  it("el tope diario del usuario también corta (`tope_dia`)", async () => {
    const { corridaId } = iniciar(FILAS_A, { tope_usd_dia_usuario: 0.001 });
    await paso(corridaId);
    const p = await paso(corridaId);
    expect(p.cuerpo.codigo).toBe("tope_dia");
  });

  it("si la proyección se recalcula a mitad, el paso responde 409 `datos_cambiaron` y la corrida queda `parcial`", async () => {
    const { corridaId } = iniciar();
    await paso(corridaId);
    base.tablas.proyecciones[0].calculado_at = "2026-10-16T10:00:00.000Z";
    const p = await paso(corridaId);
    expect(p.status).toBe(409);
    expect(p.cuerpo.codigo).toBe("datos_cambiaron");
    expect(filas("ia_corridas")[0]).toMatchObject({ estado: "parcial", motivo_fin: "datos_cambiaron" });
  });

  it("una corrida de 30 minutos sin actividad pasa a `abandonada` (R20)", async () => {
    const { corridaId } = iniciar(FILAS_A, {}, { ultima_actividad_at: new Date(Date.now() - 31 * 60_000).toISOString() });
    const p = await paso(corridaId);
    expect(p.cuerpo.codigo).toBe("corrida_terminada");
    expect(filas("ia_corridas")[0].estado).toBe("abandonada");
  });

  it("proyección cerrada: 409 `cerrada`; GM fuera de la corrida: 409; clave mal formada: 404", async () => {
    const { corridaId } = iniciar();
    expect((await paso(corridaId, "no-es-una-clave")).status).toBe(404);
    expect((await paso(corridaId, `${esc.gmlIds[0]}.${esc.gmlIds[0]}`)).cuerpo.codigo).toBe("gm_fuera_de_corrida");
    base.tablas.proyecciones[0].estado = "cerrada";
    expect((await paso(corridaId)).cuerpo.codigo).toBe("cerrada");
  });

  it("sin clave en el servidor el paso responde `ia_no_disponible` con su motivo y no llama", async () => {
    const { corridaId } = iniciar();
    ctxIa.hayClave = false;
    const p = await paso(corridaId);
    expect(p).toMatchObject({ status: 409, cuerpo: { codigo: "ia_no_disponible", motivo: "sin_clave" } });
    expect(prov.llamadas).toBe(0);
  });

  it("si la configuración cambió de modelo durante la corrida, el paso no sigue", async () => {
    const { corridaId } = iniciar();
    base.tablas.ia_configuraciones[0].modelo = "modelo-b";
    const p = await paso(corridaId);
    expect(p.cuerpo).toMatchObject({ codigo: "ia_no_disponible", motivo: "config_cambiada" });
  });
});

function iniciarOtra() {
  // Una segunda corrida sobre la misma proyección (la anterior ya terminó o se detuvo): se cierra la vigente para que no estorbe.
  for (const c of filas("ia_corridas")) if (c.estado === "en_curso") c.estado = "cancelada";
  return sembrarCorrida(esc.proyeccionId, { configuracionId: filas("ia_configuraciones")[0].id as string, corrida: { ultima_actividad_at: new Date().toISOString(), alcance: { gms: "todos", regenerar: true, semilla: null } } });
}

describe("modo jerárquico (R28)", () => {
  it("con 61 filas el plan es n1, n2, l, r1, r2 y la meta cuadra: Σ sub-metas = Meta_libre y Σ A = Meta_libre", async () => {
    const semilla = filasGrandes(61, 3);
    const { corridaId } = iniciar(semilla);
    const p = await correr(corridaId, 40);
    expect(p.cuerpo.estado).toBe("hecho");
    expect(prov.llamadas).toBe(5);
    const gm = filas("ia_corrida_gms")[0];
    expect(gm.modo).toBe("jerarquico");
    expect((gm.plan as { id: string }[]).map((x) => x.id)).toEqual(["n1", "n2", "l", "r1", "r2"]);
    const parcial = gm.parcial as { l: { sub_metas: Record<string, number> }; _: EstadoPlanIa };
    const metaLibre = parcial._.meta?.meta_libre as number;
    expect(Object.values(parcial.l.sub_metas).reduce((s, x) => s + x, 0)).toBe(metaLibre);
    const prop = filas("ia_propuestas_gm")[0];
    const libres = filas("ia_propuestas_filas").filter((f) => f.propuesta_gm_id === prop.id);
    expect(libres).toHaveLength(61);
    expect(libres.reduce((s, f) => s + (f.meta_y1_al_generar as number), 0)).toBe(metaLibre);
    // Cada lote de reparto recibió la suma de las sub-metas de sus líneas.
    const sufijos = prov.peticiones.filter((x) => JSON.parse(x.sufijo).tarea === "reparto").map((x) => JSON.parse(x.sufijo).meta.del_lote as number);
    expect(sufijos).toHaveLength(2);
    expect(sufijos.reduce((s, x) => s + x, 0)).toBe(metaLibre);
    expect(JSON.parse(prov.peticiones[2].sufijo)).toEqual({ tarea: "lineas" });
    expect(filas("ia_entradas").map((e) => e.tipo).sort()).toEqual(["bloque", "bloque", "lineas", "sufijo_reparto", "sufijo_reparto"]);
  });
});

describe("funciones puras del motor", () => {
  it("delLoteJerarquico reparte la sub-meta de una línea partida entre sus lotes", () => {
    const fila = (f: string, l: string) => ({ f, l, y1: { pedir: true } });
    const bloques = [{ filas: [fila("f1", "l01"), fila("f2", "l01")] }, { filas: [fila("f3", "l01"), fila("f4", "l02")] }] as never;
    const subs = { l01: 30, l02: 10 };
    expect(delLoteJerarquico(bloques, subs, 1) + delLoteJerarquico(bloques, subs, 2)).toBe(40);
    expect(delLoteJerarquico(bloques, subs, 2)).toBe(10 + 10);
  });

  it("componerPropuesta: sin reparto (fijadas por encima de la meta) solo guarda el natural y avisa", () => {
    const plan: EstadoPlanIa = {
      v: 1, genero_id: "g", mundo_id: "m", es_resto: false, version_metodo: 5, huella_historia: "h".repeat(64), lineas_base: [], avisos_plan: ["fijadas_exceden_meta"], partido: false, correccion: null,
      meta: { pct: 8, sobre_base: "corregida", fuente: "gm", crecimiento_id: null, version: null, meta_gm: 100, fijas: 150, fijas_detalle: { decididas: 150, pct_propio: 0, cola_larga: 0 }, meta_libre: -50, filas_libres: 1, filas_fijas: 1, fuera_base: { filas: 0, unidades: 0 } },
      meta_entrada: null,
      filas: [{ f: "f001", fila_id: "a", fila_clave: "k1", estado_meta: "libre", base: 10, base_corregida: 10, p_gm: 10, aporte_fijo: null, base_s: 10 }],
    };
    const bloque = { filas: [{ f: "f001", l: "l01", senales: { lista: [] }, y1: { pedir: true } }] } as never;
    const nat = { invalida: null, filas: [{ f: "f001", natural_y1: 12, razon_natural: "x", banderas: [], confianza: "alta", avisos: [] }], faltantes: [], avisos_gm: [] };
    const c = componerPropuesta({ plan, bloques: [bloque], modo: "directo", salidas: { naturales: [nat as never], repartos: [], lineas: null } });
    expect(c.filas[0]).toMatchObject({ natural_y1: 12, fila_clave: "k1" });
    expect(c.filas[0]).not.toHaveProperty("meta_y1_al_generar");
    expect(c.payload.avisos).toContain("fijadas_exceden_meta");
    expect(c.payload.filas_validas).toBe(1);
  });

  it("el registro de logs solo deja pasar los campos permitidos", () => {
    const r = sanearRegistro({ corrida_id: "c", llamada_id: null, gm_clave: "g", paso: "n1", estado: "ok", tokens: { entrada: 1, entrada_cache: 2, salida: 3 }, costo: 0.1, duracion_ms: 5, error_codigo: null, entrada: "SECRETO", clave: "sk" } as never);
    expect(Object.keys(r).sort()).toEqual(["corrida_id", "costo", "duracion_ms", "error_codigo", "estado", "gm_clave", "llamada_id", "paso", "tokens"]);
    expect(JSON.stringify(r)).not.toContain("SECRETO");
  });

  it("esperas, semáforo y tiempo de Lima", async () => {
    expect([esperaTrasFallo(1, null), esperaTrasFallo(2, null), esperaTrasFallo(3, null), esperaTrasFallo(1, 500), esperaTrasFallo(1, 999_999)]).toEqual([2000, 8000, 30000, 500, 60000]);
    expect([esperaTras429(null), esperaTras429(1500)]).toEqual([5000, 1500]);
    const s = crearSemaforo(2);
    let max = 0;
    await Promise.all(Array.from({ length: 6 }, () => s.ejecutar(async () => { max = Math.max(max, s.activas); await new Promise((r) => setTimeout(r, 5)); })));
    expect(max).toBe(2);
    // 2026-11-01 02:00 UTC = 2026-10-31 21:00 en Lima.
    const t = new Date("2026-11-01T02:00:00Z");
    expect([mesLima(t), diaLima(t)]).toEqual(["2026-10", "2026-10-31"]);
    expect(rangoMesLima("2026-10")).toEqual({ desde: "2026-10-01T05:00:00.000Z", hasta: "2026-11-01T05:00:00.000Z" });
    expect(rangoDiaLima("2026-10-31").hasta).toBe("2026-11-01T05:00:00.000Z");
  });

  it("los errores propios de la función de registro se traducen", () => {
    expect(describirErrorRegistro("IA001")).toMatchObject({ status: 409, codigo: "gm_en_proceso" });
    expect(describirErrorRegistro("IA002")?.codigo).toBe("corrida_terminada");
    expect(describirErrorRegistro("IA003")?.codigo).toBe("propuesta_no_reusable");
    expect(describirErrorRegistro("23505")).toBeNull();
  });
});

describe("registrar_propuesta_ia_gm (R16, con la base falsa)", () => {
  it("un error del registro (candado perdido) responde 409 y no deja propuesta", async () => {
    const { corridaId } = iniciar();
    await paso(corridaId);
    await paso(corridaId);
    estadoIa.fallaRegistro = "IA001";
    const p = await paso(corridaId);
    expect(p.status).toBe(409);
    expect(p.cuerpo.codigo).toBe("gm_en_proceso");
    expect(filas("ia_propuestas_gm")).toHaveLength(0);
    void valida;
  });
});
