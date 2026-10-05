import Image from "next/image";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Ingresar" };

export default function LoginPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Image
            src="/marca/logo-vertical.png"
            alt="Vector Two"
            width={800}
            height={800}
            priority
            className="mx-auto h-40 w-auto"
          />
          <h1 className="sr-only">Vector Two</h1>
          <p className="mt-1 text-sm text-tinta-suave">Planificación de producto · Lukers</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
