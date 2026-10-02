import { BotonSalir } from "./boton-salir";

export function CuentaBloqueada({
  email,
  titulo,
  detalle,
}: {
  email: string;
  titulo: string;
  detalle: string;
}) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-borde bg-superficie p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-tinta">{titulo}</h1>
        <p className="mt-2 text-sm text-tinta-suave">{detalle}</p>
        <p className="mt-3 text-xs text-tinta-suave">Sesión: {email}</p>
        <div className="mt-5">
          <BotonSalir variante="secundario" />
        </div>
      </div>
    </main>
  );
}
