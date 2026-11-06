import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, esActivo, hrefDe, puedeVerRuta, seccionesVisibles } from "../src/lib/nav";

/**
 * Estructura de las pantallas de agrupadores de compras (08b-1, T3a): patrones obligatorios del frontend (página mínima de servidor con el
 * panel de cliente al lado, datos solo por /api, kit de UI, confirm en lo destructivo, errores con Alert, el botón de escritura oculto por
 * rol solo donde corresponde), los hooks hablando con las rutas de la ficha §3.3 y el menú. Los permisos de pantalla solo ocultan botones:
 * la API decide (decisión 92).
 */

const RAIZ = path.resolve(__dirname, "..");
const DIR_PANEL = "src/app/(app)/compras/agrupadores";
const DIR_COMPONENTES = "src/components/compras/agrupadores";
const HOOK = "src/lib/compras/agrupadores/use-agrupadores.ts";
const fuente = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function archivosDe(dir: string): string[] {
  return readdirSync(path.join(RAIZ, dir)).flatMap((f) => {
    const ruta = `${dir}/${f}`;
    if (statSync(path.join(RAIZ, ruta)).isDirectory()) return archivosDe(ruta);
    return /\.(ts|tsx)$/.test(f) ? [ruta] : [];
  });
}
const ARCHIVOS = [...archivosDe(DIR_PANEL), ...archivosDe(DIR_COMPONENTES), HOOK];
const TSX = ARCHIVOS.filter((f) => f.endsWith(".tsx"));
const COMPONENTES_TSX = archivosDe(DIR_COMPONENTES).filter((f) => f.endsWith(".tsx"));

describe("estructura de la página", () => {
  const pagina = fuente(`${DIR_PANEL}/page.tsx`);
  const panel = fuente(`${DIR_PANEL}/agrupadores-panel.tsx`);

  it("la página es un server component mínimo: obtiene el perfil, redirige si no hay, lee la cookie y envuelve el panel en Suspense", () => {
    expect(pagina).not.toContain('"use client"');
    expect(pagina).toContain("perfilActual()");
    expect(pagina).toContain('redirect("/")');
    expect(pagina).toMatch(/<Suspense[\s\S]*<AgrupadoresPanel rol=\{r\.rol\} perfilId=\{r\.perfil\.id\} viajeActivoInicial=\{guardado\}/);
    expect(pagina).toContain("export const metadata");
    expect(pagina).toContain("(await cookies()).get(COOKIE_VIAJE_ACTIVO)");
    // No decide permisos por rol: los tres roles entran (la API manda).
    expect(pagina).not.toMatch(/r\.rol\s*[!=]==/);
  });

  it("el panel es de cliente, recibe el rol y guarda pestaña, filtros y lo abierto en la URL con la API de historial", () => {
    expect(panel.startsWith('"use client"')).toBe(true);
    expect(panel).toContain("useSearchParams");
    expect(panel).toMatch(/history\.(replaceState|pushState)/);
    expect(panel).toMatch(/\{ rol, perfilId, viajeActivoInicial \}: \{ rol: Rol; perfilId: string; viajeActivoInicial: string \| null \}/);
  });

  it("tiene las cuatro pestañas de la ficha, con Embarques por defecto, y la barra del viaje activo fuera de Importar", () => {
    const vista = fuente(`${DIR_COMPONENTES}/vista-agrupadores.ts`);
    expect(vista).toContain('export const PESTANAS = ["embarques", "viajes", "sin-agrupador", "importar"]');
    expect(vista).toContain('?? "embarques"');
    expect(panel).toContain('parametros.pestana !== "importar" && (');
    expect(panel).toContain("<BarraViajeActiva");
    for (const p of ["<PanelEmbarques", "<PanelViajes", "<PestanaSinAgrupador", "<PestanaImportar"]) expect(panel, p).toContain(p);
  });

  it("la cookie del viaje activo la lee solo el server component (y la escribe la API); ningún cliente toca document.cookie", () => {
    for (const f of ARCHIVOS) expect(fuente(f), f).not.toMatch(/document\.cookie/);
    const lectores = ARCHIVOS.filter((f) => sinComentarios(fuente(f)).includes("cookies()"));
    expect(lectores).toEqual([`${DIR_PANEL}/page.tsx`]);
  });
});

describe("permisos por rol: los tres escriben, solo admin y planner cierran y cancelan", () => {
  it("ningún panel de agrupadores usa la regla de solo planner para ocultar la escritura diaria", () => {
    for (const f of ARCHIVOS) {
      const c = sinComentarios(fuente(f));
      expect(c, f).not.toMatch(/puedeEscribir/);
      // `puedeCerrarOCancelar` (en vista-agrupadores.ts) es la única que compara el rol con admin y planner.
      if (!f.endsWith("vista-agrupadores.ts")) expect(c, f).not.toMatch(/rol === "admin" \|\| rol === "planner"/);
    }
  });

  it("el único gate de rol es `puedeCerrarOCancelar`: cerrar, reabrir y cancelar un viaje; cancelar un embarque o un paquete", () => {
    expect(fuente(`${DIR_COMPONENTES}/vista-agrupadores.ts`)).toMatch(/export const puedeCerrarOCancelar = \(rol: Rol\): boolean => rol === "admin" \|\| rol === "planner"/);
    const detalleEmbarque = fuente(`${DIR_COMPONENTES}/detalle-embarque.tsx`);
    expect(detalleEmbarque).toContain("const puedeCancelar = puedeCerrarOCancelar(rol)");
    expect(detalleEmbarque).toMatch(/puedeCancelar && embarque\.estado !== "cancelado" && embarque\.estado !== "recibido" && \(\s*<Button variante="peligro"/);
    expect(detalleEmbarque).toMatch(/\{puedeCancelar && \(\s*<Button tamano="sm" variante="peligro"/);
    const detalleViaje = fuente(`${DIR_COMPONENTES}/detalle-viaje.tsx`);
    expect(detalleViaje).toContain("const puedeCancelar = puedeCerrarOCancelar(rol)");
    expect(detalleViaje).toMatch(/puedeCancelar && viaje\.estado === "abierto"/);
    expect(detalleViaje).toMatch(/puedeCancelar && viaje\.estado === "cerrado"/);
    expect(detalleViaje).toMatch(/puedeCancelar && !cancelado/);
    const lista = fuente(`${DIR_COMPONENTES}/lista-viajes.tsx`);
    expect(lista).toMatch(/puedeCerrarOCancelar && v\.estado === "abierto"/);
    expect(lista).toMatch(/puedeCerrarOCancelar && v\.estado === "cerrado"/);
    expect(lista).toMatch(/puedeCerrarOCancelar && v\.estado !== "cancelado"/);
    expect(fuente(`${DIR_COMPONENTES}/panel-viajes.tsx`)).toContain("const puedeCerrar = puedeCerrarOCancelar(rol)");
  });

  it("el importador se ofrece a los tres roles y un viaje cerrado no bloquea (el aviso lo dice, la acción sigue)", () => {
    const panel = fuente(`${DIR_PANEL}/agrupadores-panel.tsx`);
    expect(panel).toMatch(/parametros\.pestana === "importar" && \(\s*<PestanaImportar/);
    const detalleViaje = fuente(`${DIR_COMPONENTES}/detalle-viaje.tsx`);
    expect(detalleViaje).toContain("igual se le pueden añadir y quitar compras y embarques");
    // Agregar compras y nuevo embarque solo dependen de que no esté cancelado, no de que esté abierto.
    expect(detalleViaje).toMatch(/!cancelado && \(\s*<Button variante="secundario" onClick=\{\(\) => setDialogo\(\{ tipo: "embarque" \}\)\}/);
  });
});

describe("datos, kit de UI y errores", () => {
  it("ningún archivo habla con Supabase ni usa fetch directo: todo va por /api con `api` o los hooks", () => {
    for (const f of ARCHIVOS) {
      const c = fuente(f);
      expect(c, f).not.toMatch(/@supabase|supabase\/(browser|admin|server)/);
      expect(c, f).not.toMatch(/\bfetch\(/);
    }
  });

  it("el hook habla con las rutas de la ficha §3.3 y con los verbos correctos, sin inventar otras", () => {
    const h = sinComentarios(fuente(HOOK));
    for (const r of [
      "/api/compras/viajes",
      "/api/compras/embarques",
      "/api/compras/agrupadores/opciones",
      "/api/compras/agrupadores/sin-asignar",
      "/api/compras/agrupadores/historial",
      "/api/compras/agrupadores/importar",
      "/api/compras/viaje-activo",
      "/api/compras/paquetes/${id}",
      "/estado",
      "/compras`",
      "/paquetes`",
      "/asignar",
      "/quitar",
      "/paquete`",
      "/fecha",
      "/pasar-pendientes",
      "/mover`",
      "?previsualizar=1",
    ]) expect(h, r).toContain(r);
    expect(h).toContain("api.put<{ viaje_activo: string }>(URL_VIAJE_ACTIVO, { viaje_id })");
    expect(h).toContain("api.patch<{ viaje: ViajeApi }>(urlViaje(id), cuerpo)");
    expect(h).toContain("api.patch<{ embarque: EmbarqueDetalleApi }>(urlEmbarque(id), cuerpo)");
    expect(h).toContain("api.patch<{ embarque: EmbarqueDetalleApi }>(urlPaquete(paqueteId), cuerpo)");
    expect(h).toContain("api.post<ReporteImportacionAgrupadoresApi>(URL_IMPORTAR_AGRUPADORES, cuerpo)");
    expect(h).toContain("useLectura<{ embarques: EmbarqueApi[] }>(");
    // Nada de rutas de la 08b-2 en esta entrega.
    expect(h).not.toMatch(/recibir|revertir-recepcion/);
  });

  it("el hook no manda `viaje_id` de la cookie: el viaje activo llega explícito como filtro (R22)", () => {
    expect(sinComentarios(fuente(HOOK))).not.toContain("cookie");
  });

  it("los tipos de la API se importan de los contratos del módulo y no se duplican", () => {
    const todo = ARCHIVOS.map((f) => sinComentarios(fuente(f))).join("\n");
    expect(todo).toContain('from "@/lib/compras/agrupadores/tipos-api"');
    expect(todo).toContain('from "@/lib/compras/agrupadores/esquemas"');
    for (const tipo of ["ViajeApi", "EmbarqueApi", "EmbarqueDetalleApi", "PaqueteApi", "AsignacionApi", "PlanMovimientoApi", "RespuestaMovimientoApi", "SinAgrupadorApi", "ReporteImportacionAgrupadoresApi", "OpcionesAgrupadoresApi"]) {
      expect(todo, tipo).not.toMatch(new RegExp(`(?:type|interface) ${tipo}\\s*[=<{]`));
    }
  });

  it("los formularios validan con los esquemas del contrato antes de enviar", () => {
    expect(fuente(`${DIR_COMPONENTES}/modal-embarque.tsx`)).toMatch(/editarEmbarqueSchema : guardarEmbarqueSchema/);
    expect(fuente(`${DIR_COMPONENTES}/modal-viaje.tsx`)).toMatch(/editarViajeSchema : guardarViajeSchema/);
    expect(fuente(`${DIR_COMPONENTES}/modal-paquete.tsx`)).toContain("guardarPaqueteSchema.safeParse");
  });

  it("lo destructivo o irreversible pide confirm: cancelar, quitar del embarque, quitar compras del viaje, cerrar y reabrir un viaje, pasar pendientes y aplicar la importación", () => {
    expect(fuente(`${DIR_COMPONENTES}/dialogo-cancelar.tsx`)).toMatch(/confirm\(`¿Cancelar el \$\{tipo\.toLowerCase\(\)\}/);
    expect(fuente(`${DIR_COMPONENTES}/dialogo-quitar.tsx`)).toContain("confirmar={(plan)");
    expect(fuente(`${DIR_COMPONENTES}/dialogo-pasar-pendientes.tsx`)).toContain("confirmar={(plan)");
    expect(fuente(`${DIR_COMPONENTES}/dialogo-movimiento.tsx`)).toMatch(/confirm\(confirmar\(planVigente\)\)/);
    expect(fuente(`${DIR_COMPONENTES}/dialogo-compras-viaje.tsx`)).toMatch(/quita && !confirm\(/);
    expect(fuente(`${DIR_COMPONENTES}/detalle-viaje.tsx`)).toMatch(/if \(!confirm\(texto\)\) return/);
    expect(fuente(`${DIR_COMPONENTES}/panel-viajes.tsx`)).toMatch(/if \(!confirm\(texto\)\) return/);
    expect(fuente(`${DIR_COMPONENTES}/use-importar-agrupadores.ts`)).toMatch(/confirm\(confirmarAplicarAgrupadores\(/);
  });

  it("aplicar un movimiento exige una vista previa vigente y manda la huella del plan (R19)", () => {
    const c = fuente(`${DIR_COMPONENTES}/dialogo-movimiento.tsx`);
    expect(c).toContain("llamar(cuerpo, true)");
    expect(c).toMatch(/llamar\(\{ \.\.\.cuerpo, huella_plan: planVigente\.huella_plan \}, false\)/);
    expect(c).toContain("disabled={accion.ocupado || planVigente === null}");
    expect(c).toMatch(/pideRelectura\(r\.error\.codigo\)/);
    // Los cuatro movimientos con vista previa pasan por el cascarón.
    for (const f of ["dialogo-fechas", "dialogo-ingreso-paquete", "dialogo-asignar", "dialogo-quitar", "dialogo-pasar-pendientes", "dialogo-mover-paquete"]) expect(fuente(`${DIR_COMPONENTES}/${f}.tsx`), f).toContain("<DialogoMovimiento");
  });

  it("los formularios se deshabilitan mientras envían, no se cierran enviando y los errores de la API se muestran con Alert", () => {
    const formulario = fuente(`${DIR_COMPONENTES}/modal-formulario.tsx`);
    expect(formulario).toContain("disabled={ocupado || deshabilitarGuardar}");
    expect(formulario).toContain("cerrable={!ocupado}");
    expect(formulario).toContain("<Alert");
    const mov = fuente(`${DIR_COMPONENTES}/dialogo-movimiento.tsx`);
    expect(mov).toContain("cerrable={!accion.ocupado}");
    expect(mov).toContain("<Alert");
    for (const f of ["modal-embarque", "modal-viaje", "modal-paquete", "dialogo-cancelar", "dialogo-compras-viaje", "dialogo-a-paquete"]) {
      const c = fuente(`${DIR_COMPONENTES}/${f}.tsx`);
      expect(c, f).toContain("textoErrorAccion(accion.error)");
      expect(c, f).toContain("accion.ejecutar");
    }
    // Tras escribir, se relee (el detalle y las listas).
    expect(fuente(`${DIR_COMPONENTES}/detalle-embarque.tsx`)).toMatch(/await onRecargar\(\)/);
    expect(fuente(`${DIR_COMPONENTES}/panel-embarques.tsx`)).toMatch(/Promise\.all\(\[lista\.recargar\(\), detalle\.recargar\(\), ctx\.recargarBase\(\)\]\)/);
    expect(fuente(`${DIR_PANEL}/agrupadores-panel.tsx`)).toContain("<Alert");
  });

  it("los formularios son accesibles: etiquetas con Field, grupos de chips rotulados, casillas con texto accesible y errores con role=alert", () => {
    for (const f of ["modal-embarque", "modal-viaje", "modal-paquete", "dialogo-fechas", "dialogo-ingreso-paquete"]) expect(fuente(`${DIR_COMPONENTES}/${f}.tsx`), f).toContain("<Field");
    expect(fuente(`${DIR_COMPONENTES}/filtros-embarques.tsx`)).toContain('etiqueta="Responsable"');
    expect(fuente(`${DIR_COMPONENTES}/filtros-embarques.tsx`)).toContain('etiqueta="Estado"');
    expect(fuente(`${DIR_COMPONENTES}/tabla-asignaciones.tsx`)).toContain("label={`Marcar ");
    expect(fuente(`${DIR_COMPONENTES}/dialogo-asignar.tsx`)).toContain("aria-invalid={err !== null}");
    expect(fuente(`${DIR_COMPONENTES}/barra-viaje-activo.tsx`)).toContain("aria-describedby");
    expect(fuente("src/components/ui/alert.tsx")).toContain('role="alert"');
  });

  it("las tablas van dentro de DataTable (scroll horizontal) y los embarques tienen tarjetas para el celular", () => {
    for (const f of ["lista-embarques", "lista-viajes", "tabla-asignaciones", "tablas-sin-agrupador"]) expect(fuente(`${DIR_COMPONENTES}/${f}.tsx`), f).toContain("<DataTable");
    const lista = fuente(`${DIR_COMPONENTES}/lista-embarques.tsx`);
    expect(lista).toContain("hidden md:block");
    expect(lista).toContain("md:hidden");
    expect(lista).toContain("<article");
  });

  it("la pestaña Importar reutiliza el importador compartido sin modificarlo", () => {
    const c = fuente(`${DIR_COMPONENTES}/pestana-importar.tsx`);
    for (const m of ["paso-archivo", "paso-mapeo", "reporte", "csv", "excel"]) expect(c, m).toContain(`@/components/importador/${m}`);
    const hook = fuente(`${DIR_COMPONENTES}/use-importar-agrupadores.ts`);
    expect(hook).toContain("@/components/importador/mapeo");
    expect(hook).toContain("archivo_nombre: archivo.nombre");
    expect(hook).toContain('e.codigo === "vuelve_a_previsualizar"');
    expect(hook).toContain("MAX_FILAS_IMPORTAR_AGRUPADORES");
    // Ningún archivo del importador compartido nombra los agrupadores.
    for (const f of archivosDe("src/components/importador")) expect(fuente(f), f).not.toMatch(/agrupador/i);
  });

  it("Excel: las hojas salen de `hojas-agrupadores.ts` con la descarga del navegador, sin import estático de xlsx", () => {
    const d = sinComentarios(fuente(`${DIR_COMPONENTES}/descarga.ts`));
    for (const t of ["hojaEmbarques(", "hojaPaquetes(", "hojaAsignaciones(", "hojaAgrupadores(", "hojaViajes(", "descargarLibro"]) expect(d, t).toContain(t);
    for (const f of ARCHIVOS) expect(fuente(f), f).not.toMatch(/from "xlsx"/);
    expect(fuente(`${DIR_COMPONENTES}/panel-embarques.tsx`)).toContain("descargarEmbarques(");
    expect(fuente(`${DIR_COMPONENTES}/panel-viajes.tsx`)).toContain("descargarViajes(");
  });

  it("no hay colores sueltos: solo los tokens del tema", () => {
    for (const f of TSX) {
      const c = sinComentarios(fuente(f));
      expect(c, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(c, f).not.toMatch(/\b(?:bg|text|border|ring|fill|stroke)-(?:red|green|blue|yellow|gray|slate|zinc|amber|emerald|white|black|orange)\b/);
    }
  });

  it("los textos visibles no nombran campos crudos de la API ni de la base", () => {
    for (const f of [...COMPONENTES_TSX, `${DIR_COMPONENTES}/vista-agrupadores.ts`, `${DIR_COMPONENTES}/vista-importar-agrupadores.ts`, `${DIR_COMPONENTES}/vista-errores.ts`]) {
      const c = sinComentarios(fuente(f)).replace(/Pick<[^>]*>/g, "");
      const literales = [...c.matchAll(/"([^"\n]*)"|`([^`\n]*)`|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
      for (const literal of literales) {
        const t = literal.replace(/\$\{[^}]*\}/g, "");
        if (/^[a-z_]+$/.test(t)) continue;
        expect(t, `${f}: «${t}»`).not.toMatch(/\b(?:huella_plan|compra_revision|revision_destino|periodo_llegada|responsable_efectivo|unidades_sin_embarque|asignacion_id|perfil_id|embarque_id|viaje_id)\b/);
      }
    }
  });

  it("la primera versión de la pantalla no ofrece lo de 08b-2: ni «Recibir embarque» ni «Registrar otra llegada»", () => {
    for (const f of COMPONENTES_TSX) {
      const c = sinComentarios(fuente(f));
      expect(c, f).not.toMatch(/Recibir embarque|Registrar otra llegada|Volver de recibido/);
    }
  });
});

describe("fechas del embarque (08b-1b T3b-1)", () => {
  it("el hook habla con /fechas y /paquetes/[id]/ingreso, con vista previa", () => {
    const h = fuente(HOOK);
    expect(h).toContain("`${urlEmbarque(embarqueId)}/fechas`");
    expect(h).toContain("`${urlPaquete(paqueteId)}/ingreso`");
    expect(h).not.toContain("cambiarFechaLlegada");
  });

  it("los diálogos de fechas usan el cascarón con vista previa, con motivo y causa; ninguno escribe sin pasar por él", () => {
    expect(fuente(`${DIR_COMPONENTES}/dialogo-fechas.tsx`)).toContain("cambiarFechasEmbarque(embarque.id");
    expect(fuente(`${DIR_COMPONENTES}/dialogo-ingreso-paquete.tsx`)).toContain("fijarIngresoPaquete(paquete.id");
    for (const f of ["dialogo-fechas", "dialogo-ingreso-paquete"]) {
      const c = fuente(`${DIR_COMPONENTES}/${f}.tsx`);
      expect(c, f).toContain("LISTA_CAUSAS_FECHA");
      expect(c, f).toContain("MAX_MOTIVO_MOVIMIENTO");
    }
  });

  it("editar un embarque no manda fechas por el PATCH: solo el alta las escribe, y el «ya ocurrió» del alta va por /fechas", () => {
    const m = sinComentarios(fuente(`${DIR_COMPONENTES}/modal-embarque.tsx`));
    expect(m).toMatch(/if \(edita\) cuerpo\.revision = embarque\.revision;\s*else \{[\s\S]*fecha_salida_estimada[\s\S]*fecha_llegada_estimada[\s\S]*\}/);
    expect(m).not.toMatch(/fecha_salida_estimada: form/);
    expect(m).toContain("cambiarFechasEmbarque(creado.id");
  });

  it("el estado de un hito nunca depende solo del color: toda insignia de estado lleva su texto", () => {
    const t = sinComentarios(fuente(`${DIR_COMPONENTES}/linea-tiempo.tsx`));
    expect(t).toContain("textoEstadoCorto(hito, hoy)");
    expect(t).toContain('aria-hidden="true"');
    expect(t).toContain('aria-label="Línea de tiempo del embarque"');
  });

  it("el reloj de las pantallas de fechas se lee una sola vez al montar (sin Date en el render)", () => {
    for (const f of ["dialogo-fechas.tsx", "dialogo-ingreso-paquete.tsx", "modal-embarque.tsx", "lista-embarques.tsx", "detalle-embarque.tsx"]) {
      const c = sinComentarios(fuente(`${DIR_COMPONENTES}/${f}`));
      expect(c, f).not.toMatch(/new Date\(/);
      expect(c, f).toMatch(/useState\(\(\) => (?:fechaLima|ahoraEnLima)\(\)\)/);
    }
  });
});

describe("menú y acceso por rol", () => {
  const compras = NAV_SECTIONS.find((s) => s.title === "Compras");
  const item = compras?.links.find((l) => l.href === "/compras/agrupadores");

  it("«Viajes y embarques» está dentro de Compras, sin pendiente y sin restricción de rol (los tres roles)", () => {
    expect(item).toBeDefined();
    expect(item?.label).toBe("Viajes y embarques");
    expect(item?.pendiente).toBeUndefined();
    expect(item?.roles).toBeUndefined();
    expect(compras?.roles).toEqual(["admin", "planner", "comprador"]);
    expect(hrefDe(item!)).toBe("/compras/agrupadores");
  });

  it("los tres roles lo ven en el menú y pueden abrirlo y sus subrutas, también por URL directa", () => {
    for (const rol of ["admin", "planner", "comprador"] as const) {
      expect(seccionesVisibles(rol).find((s) => s.title === "Compras")?.links.map((l) => l.href), rol).toContain("/compras/agrupadores");
      for (const ruta of ["/compras/agrupadores", "/compras/agrupadores/", "/compras/agrupadores/algo"]) expect(puedeVerRuta(rol, ruta), `${rol} ${ruta}`).toBe(true);
    }
  });

  it("solo se marca activo en su propia ruta; Huecos y Compras no se marcan allí", () => {
    const [huecos, , registro] = compras!.links;
    expect(esActivo("/compras/agrupadores", item!)).toBe(true);
    expect(esActivo("/compras/agrupadores", huecos)).toBe(false);
    expect(esActivo("/compras/agrupadores", registro)).toBe(false);
    expect(esActivo("/compras/registro", item!)).toBe(false);
  });

  it("el menú sigue en el orden fijado: Inicio, Compras, Planificación, Maestros, Administración", () => {
    expect(NAV_SECTIONS.map((s) => s.title)).toEqual(["General", "Compras", "Planificación", "Maestros", "Administración"]);
  });
});
