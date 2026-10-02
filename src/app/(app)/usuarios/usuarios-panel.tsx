"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { useColeccion } from "@/lib/use-coleccion";
import { DESCRIPCION_ROL, ETIQUETA_ROL, ROLES, normalizarRol, type Rol } from "@/lib/auth/roles";
import type { Tables } from "@/lib/supabase/database.types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";

type Perfil = Tables<"perfiles">;

const FORM_INICIAL = { email: "", nombre: "", password: "", rol: "planner" as Rol };

export function UsuariosPanel({ actorId }: { actorId: string }) {
  const { datos, cargando, error, setError, recargar } = useColeccion<Perfil>("/api/usuarios");
  const [form, setForm] = useState(FORM_INICIAL);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  function fallo(e: unknown) {
    setError(e instanceof Error ? e.message : "Error inesperado");
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await api.post("/api/usuarios", { ...form, nombre: form.nombre || null });
      setForm(FORM_INICIAL);
      setAviso(`Usuario ${form.email} creado.`);
      await recargar();
    } catch (err) {
      fallo(err);
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarRol(p: Perfil, rol: Rol) {
    setError(null);
    try {
      await api.patch(`/api/usuarios/${p.id}`, { rol });
      await recargar();
    } catch (err) {
      fallo(err);
    }
  }

  async function alternarActivo(p: Perfil) {
    const accion = p.activo ? "desactivar" : "reactivar";
    if (!confirm(`¿${accion.charAt(0).toUpperCase() + accion.slice(1)} a ${p.email}?`)) return;
    setError(null);
    try {
      await api.patch(`/api/usuarios/${p.id}`, { activo: !p.activo });
      await recargar();
    } catch (err) {
      fallo(err);
    }
  }

  async function resetearClave(p: Perfil) {
    const nueva = prompt(`Nueva contraseña para ${p.email} (mínimo 8 caracteres):`);
    if (!nueva) return;
    setError(null);
    try {
      await api.patch(`/api/usuarios/${p.id}`, { password: nueva });
      setAviso(`Contraseña de ${p.email} actualizada.`);
    } catch (err) {
      fallo(err);
    }
  }

  async function eliminar(p: Perfil) {
    if (!confirm(`¿Eliminar definitivamente a ${p.email}? Esta acción no se puede deshacer.`)) return;
    setError(null);
    try {
      await api.delete(`/api/usuarios/${p.id}`);
      await recargar();
    } catch (err) {
      fallo(err);
    }
  }

  const columnas: Columna<Perfil>[] = [
    {
      clave: "usuario",
      titulo: "Usuario",
      render: (p) => (
        <div>
          <div className="font-medium">
            {p.nombre || <span className="text-tinta-suave">Sin nombre</span>}
            {p.id === actorId && <span className="ml-2 text-xs text-tinta-suave">(tú)</span>}
          </div>
          <div className="text-xs text-tinta-suave">{p.email}</div>
        </div>
      ),
    },
    {
      clave: "rol",
      titulo: "Rol",
      render: (p) => (
        <Select
          value={normalizarRol(p.rol)}
          onChange={(e) => cambiarRol(p, e.target.value as Rol)}
          className="h-8 w-40"
          aria-label={`Rol de ${p.email}`}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ETIQUETA_ROL[r]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      clave: "estado",
      titulo: "Estado",
      render: (p) => <Badge tono={p.activo ? "exito" : "alerta"}>{p.activo ? "Activo" : "Desactivado"}</Badge>,
    },
    {
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (p) => (
        <div className="flex justify-end gap-1">
          <Button variante="fantasma" tamano="sm" onClick={() => resetearClave(p)}>
            Clave
          </Button>
          <Button variante="fantasma" tamano="sm" onClick={() => alternarActivo(p)} disabled={p.id === actorId}>
            {p.activo ? "Desactivar" : "Reactivar"}
          </Button>
          <Button variante="peligro" tamano="sm" onClick={() => eliminar(p)} disabled={p.id === actorId}>
            Eliminar
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          Quién entra a Vector2 y con qué rol. Solo los administradores ven esta pantalla.
        </p>
      </div>

      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}

      <Card titulo="Nuevo usuario" descripcion="Se crea con la contraseña indicada y puede entrar de inmediato.">
        <form onSubmit={crear} className="grid gap-4 md:grid-cols-4">
          <Field label="Correo">
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Nombre">
            <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          </Field>
          <Field label="Contraseña" hint="Mínimo 8 caracteres.">
            <Input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="Rol" hint={DESCRIPCION_ROL[form.rol]}>
            <Select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value as Rol })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ETIQUETA_ROL[r]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="md:col-span-4">
            <Button type="submit" disabled={guardando}>
              {guardando ? "Creando…" : "Crear usuario"}
            </Button>
          </div>
        </form>
      </Card>

      <Card titulo="Usuarios registrados">
        <DataTable columnas={columnas} filas={datos} claveFila={(p) => p.id} cargando={cargando} />
        <p className="mt-3 text-xs text-tinta-suave">
          El sistema conserva siempre al menos un administrador activo y nadie puede desactivarse o eliminarse a sí mismo.
        </p>
      </Card>
    </div>
  );
}
