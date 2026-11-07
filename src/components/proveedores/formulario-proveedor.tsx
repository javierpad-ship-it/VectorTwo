"use client";

import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { api, codigoDeError, ErrorApi } from "@/lib/api-client";
import { INCOTERMS } from "@/lib/proveedores/constantes";
import type { ProveedorFichaApi } from "@/lib/proveedores/tipos-api";
import { CamposPaisRegion } from "./campos-pais-region";
import { Contactos } from "./contactos";
import { ayudaPlazos, borradorDeFicha, borradorVacio, cuerpoProveedor, validarBorrador, type BorradorProveedor } from "./vista-proveedores";

const URL_PROVEEDORES = "/api/compras/proveedores";

type Conflicto = { id: string; nombre: string; activo: boolean };

function conflictoDe(e: unknown): Conflicto | null {
  if (!(e instanceof ErrorApi)) return null;
  const c = e.cuerpo?.conflicto;
  if (typeof c !== "object" || c === null) return null;
  const { id, nombre, activo } = c as Record<string, unknown>;
  return typeof id === "string" && typeof nombre === "string" ? { id, nombre, activo: activo !== false } : null;
}

/**
 * Alta y edición de un proveedor (08c, §4.2) en tres bloques: Empresa, Importación y Contactos. La ficha y los contactos se guardan juntos
 * (una transacción en la base). Valida con el mismo esquema que la API, estado controlado, botón deshabilitado mientras envía. Con
 * `409 nombre_repetido` ofrece abrir el existente; con `409 proveedor_cambio` ofrece recargar la ficha. El comprador ve la casilla
 * «intercompany» deshabilitada: la marca el planner.
 */
export function FormularioProveedor({
  ficha,
  puedeIntercompany,
  puertosSugeridos,
  onCerrar,
  onGuardado,
  onAbrirExistente,
}: {
  /** `null` = proveedor nuevo. */
  ficha: ProveedorFichaApi | null;
  puedeIntercompany: boolean;
  puertosSugeridos: readonly string[];
  onCerrar: () => void;
  onGuardado: (ficha: ProveedorFichaApi) => void | Promise<void>;
  onAbrirExistente: (id: string) => void;
}) {
  const idFormulario = useId();
  const idPuertos = useId();
  const [borrador, setBorrador] = useState<BorradorProveedor>(() => (ficha ? borradorDeFicha(ficha) : borradorVacio()));
  const [revision, setRevision] = useState<number | null>(ficha ? ficha.revision : null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<Conflicto | null>(null);
  const [desactualizada, setDesactualizada] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const campo = <K extends keyof BorradorProveedor>(k: K, v: BorradorProveedor[K]) => setBorrador((b) => ({ ...b, [k]: v }));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setErrorApi(null);
    setConflicto(null);
    setDesactualizada(false);
    const problemas = validarBorrador(borrador);
    setErrores(problemas);
    if (Object.keys(problemas).length > 0) {
      setErrorApi("Revisa los campos marcados en rojo.");
      return;
    }
    setEnviando(true);
    try {
      const cuerpo = cuerpoProveedor(borrador, revision);
      const guardada = ficha ? await api.patch<ProveedorFichaApi>(`${URL_PROVEEDORES}/${ficha.id}`, cuerpo) : await api.post<ProveedorFichaApi>(URL_PROVEEDORES, { modo: "ficha", ...cuerpo });
      await onGuardado(guardada);
    } catch (err) {
      const codigo = codigoDeError(err);
      const mensaje = err instanceof Error ? err.message : "No pudimos guardar el proveedor.";
      if (codigo === "nombre_repetido") {
        setErrores({ nombre: mensaje });
        setConflicto(conflictoDe(err));
      } else if (codigo === "codigo_repetido") {
        setErrores({ codigo: mensaje });
        setConflicto(conflictoDe(err));
      } else if (codigo === "proveedor_cambio") {
        setDesactualizada(true);
      }
      setErrorApi(mensaje);
    } finally {
      setEnviando(false);
    }
  }

  async function recargarFicha() {
    if (!ficha) return;
    if (!confirm("Se recarga la ficha con lo último que guardó la otra persona y se pierden los cambios que escribiste aquí. ¿Continuar?")) return;
    setEnviando(true);
    try {
      const nueva = await api.get<ProveedorFichaApi>(`${URL_PROVEEDORES}/${ficha.id}`);
      setBorrador(borradorDeFicha(nueva));
      setRevision(nueva.revision);
      setErrores({});
      setErrorApi(null);
      setDesactualizada(false);
    } catch (err) {
      setErrorApi(err instanceof Error ? err.message : "No pudimos recargar la ficha.");
    } finally {
      setEnviando(false);
    }
  }

  const err = (k: string) => errores[k];

  return (
    <Modal
      titulo={ficha ? `Editar «${ficha.nombre}»` : "Nuevo proveedor"}
      descripcion="Los campos con * son obligatorios. La ficha y los contactos se guardan juntos."
      onCerrar={onCerrar}
      cerrable={!enviando}
      pie={
        <>
          <Button variante="secundario" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" form={idFormulario} disabled={enviando}>
            {enviando ? "Guardando…" : ficha ? "Guardar cambios" : "Crear proveedor"}
          </Button>
        </>
      }
    >
      <form id={idFormulario} onSubmit={enviar} noValidate className="space-y-6">
        {errorApi && (
          <Alert onCerrar={() => setErrorApi(null)}>
            <span>{errorApi}</span>
            {conflicto && (
              <>
                {" "}
                <button type="button" className="font-semibold underline underline-offset-2" onClick={() => onAbrirExistente(conflicto.id)}>
                  Abrir «{conflicto.nombre}»
                </button>
              </>
            )}
            {desactualizada && (
              <>
                {" "}
                <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void recargarFicha()}>
                  Recargar la ficha
                </button>
              </>
            )}
          </Alert>
        )}

        <section aria-labelledby={`${idFormulario}-empresa`} className="space-y-3">
          <h3 id={`${idFormulario}-empresa`} className="text-sm font-semibold">
            Empresa
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre *" error={err("nombre")}>
              <Input value={borrador.nombre} maxLength={120} aria-invalid={Boolean(err("nombre"))} onChange={(e) => campo("nombre", e.target.value)} />
            </Field>
            <Field label="Código" error={err("codigo")}>
              <Input value={borrador.codigo} maxLength={30} aria-invalid={Boolean(err("codigo"))} onChange={(e) => campo("codigo", e.target.value)} />
            </Field>
            <Field label="RUC / Tax ID" error={err("identificacion")}>
              <Input value={borrador.identificacion} maxLength={40} onChange={(e) => campo("identificacion", e.target.value)} />
            </Field>
            <div className="hidden sm:block" aria-hidden />
            <CamposPaisRegion
              pais={borrador.pais}
              region={borrador.region}
              errorPais={err("pais")}
              errorRegion={err("region")}
              onCambiar={({ pais, region }) => setBorrador((b) => ({ ...b, pais, region }))}
            />
            <Field label="Ciudad" error={err("ciudad")}>
              <Input value={borrador.ciudad} maxLength={80} onChange={(e) => campo("ciudad", e.target.value)} />
            </Field>
            <Field label="Dirección" error={err("direccion")}>
              <Input value={borrador.direccion} maxLength={300} onChange={(e) => campo("direccion", e.target.value)} />
            </Field>
          </div>
        </section>

        <section aria-labelledby={`${idFormulario}-importacion`} className="space-y-3">
          <h3 id={`${idFormulario}-importacion`} className="text-sm font-semibold">
            Importación
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Puerto de embarque habitual" hint="Ningbo, Shenzhen, Miami… El de cada envío se define en su embarque." error={err("puerto_embarque")}>
              <Input list={idPuertos} value={borrador.puerto_embarque} maxLength={80} onChange={(e) => campo("puerto_embarque", e.target.value)} />
              <datalist id={idPuertos}>
                {puertosSugeridos.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
            <Field label="Incoterm habitual" hint="Solo informativo: el costo se toma siempre como FOB." error={err("incoterm")}>
              <Select value={borrador.incoterm} onChange={(e) => campo("incoterm", e.target.value)}>
                <option value="">Sin definir</option>
                {INCOTERMS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Moneda habitual" error={err("moneda")}>
              <Select value={borrador.moneda} onChange={(e) => campo("moneda", e.target.value)}>
                <option value="">Sin definir</option>
                <option value="USD">USD · dólares</option>
                <option value="PEN">PEN · soles</option>
              </Select>
            </Field>
            <Field label="Condiciones de pago" error={err("condiciones_pago")}>
              <Input value={borrador.condiciones_pago} maxLength={200} placeholder="30 % adelanto, 70 % contra BL" onChange={(e) => campo("condiciones_pago", e.target.value)} />
            </Field>
            <Field label="Plazo de producción (días)" hint="De la orden al embarque (0 a 365)." error={err("plazo_produccion_dias")}>
              <Input inputMode="numeric" value={borrador.plazo_produccion_dias} onChange={(e) => campo("plazo_produccion_dias", e.target.value)} aria-invalid={Boolean(err("plazo_produccion_dias"))} />
            </Field>
            <Field label="Plazo de tránsito (días)" hint="Del embarque a la llegada al CD (0 a 180)." error={err("plazo_transito_dias")}>
              <Input inputMode="numeric" value={borrador.plazo_transito_dias} onChange={(e) => campo("plazo_transito_dias", e.target.value)} aria-invalid={Boolean(err("plazo_transito_dias"))} />
            </Field>
          </div>
          <p className="text-xs text-tinta-suave">{ayudaPlazos(borrador.plazo_produccion_dias, borrador.plazo_transito_dias)}</p>
          <div>
            <label className="inline-flex min-h-9 items-center gap-2 text-sm text-tinta">
              <input
                type="checkbox"
                checked={borrador.es_intercompany}
                disabled={!puedeIntercompany}
                onChange={(e) => campo("es_intercompany", e.target.checked)}
                aria-describedby={puedeIntercompany ? undefined : `${idFormulario}-ayuda-intercompany`}
                className="h-4 w-4 accent-marca disabled:cursor-not-allowed disabled:opacity-50"
              />
              Es intercompany (CD del grupo)
            </label>
            {!puedeIntercompany && (
              <p id={`${idFormulario}-ayuda-intercompany`} className="text-xs text-tinta-suave">
                La marca el planner.
              </p>
            )}
          </div>
          <Field label="Nota" error={err("nota")}>
            <Textarea value={borrador.nota} maxLength={300} rows={2} onChange={(e) => campo("nota", e.target.value)} />
          </Field>
        </section>

        <section aria-labelledby={`${idFormulario}-contactos`} className="space-y-3">
          <h3 id={`${idFormulario}-contactos`} className="text-sm font-semibold">
            Contactos
          </h3>
          <Contactos contactos={borrador.contactos} errores={errores} deshabilitado={enviando} onCambiar={(contactos) => campo("contactos", contactos)} />
          <p className="text-xs text-tinta-suave">Si no marcas un contacto principal, el primero lo será.</p>
        </section>
      </form>
    </Modal>
  );
}
