import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Ingresar" };

export default function LoginPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-marca text-xl font-bold text-white">
            V2
          </div>
          <h1 className="text-2xl font-semibold text-tinta">Vector2</h1>
          <p className="mt-1 text-sm text-tinta-suave">Planificación de producto · Lukers</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
