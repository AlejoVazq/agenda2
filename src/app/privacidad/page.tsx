import type { Metadata } from "next";
import type { ReactNode } from "react";
import { env } from "@/lib/env";
import { MARCA } from "@/lib/marca";

export const metadata: Metadata = { title: "Privacidad" };

// La sección "Datos de Google" es la que revisa Google para verificar el permiso de
// calendario (docs/verificacion-google.md). Si cambia lo que la app hace con esos
// datos (src/lib/google.ts), hay que actualizarla.

function Seccion({ id, titulo, children }: { id?: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-2">
      <h2 className="text-base font-bold text-tinta">{titulo}</h2>
      {children}
    </section>
  );
}

export default function PaginaPrivacidad() {
  const contacto = env.contactoEmail ? (
    <a href={`mailto:${env.contactoEmail}`} className="font-semibold text-marca-700 underline">
      {env.contactoEmail}
    </a>
  ) : (
    "el mail de contacto que figura en el sitio"
  );

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10 text-sm leading-relaxed text-zinc-700 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-tinta">Política de privacidad</h1>
        <p className="mt-1 text-xs text-zinc-500">Última actualización: 12 de noviembre de 2026.</p>
      </div>

      <p>
        {MARCA.nombre} es una herramienta para que negocios de servicios tomen turnos online. Esta política explica qué datos
        usamos, para qué y qué podés hacer con ellos. Ante cualquier consulta, escribinos a {contacto}.
      </p>

      <Seccion titulo="Qué datos usamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Si reservás un turno:</strong> tu nombre, celular y email, los turnos que pediste y si asististe o no.
          </li>
          <li>
            <strong>Si tenés un negocio o trabajás en uno:</strong> tu nombre, tu email, tu contraseña (guardada cifrada,
            nunca en texto), los datos del negocio, su agenda, sus servicios y su equipo.
          </li>
          <li>
            <strong>Datos técnicos:</strong> para mantener tu sesión iniciada guardamos la dirección IP y el navegador de
            cada sesión. Para frenar abusos contamos los intentos por IP, guardando solo una versión cifrada (hash) de la IP.
          </li>
          <li>
            <strong>Si conectás Google Calendar:</strong> lo que se detalla en <a href="#google" className="underline">Datos de Google</a>.
          </li>
        </ul>
      </Seccion>

      <Seccion titulo="Para qué los usamos">
        <p>
          Para que funcione el servicio: gestionar los turnos, mandar la confirmación y los recordatorios, aplicar los
          límites de reserva de cada negocio, mantener la seguridad de las cuentas y avisarle al negocio sobre su plan. No
          usamos tus datos para publicidad ni los vendemos.
        </p>
      </Seccion>

      <Seccion titulo="Quién accede">
        <p>
          El negocio donde reservaste y su equipo ven los datos de tus turnos. Para prestar el servicio usamos proveedores
          que procesan datos en nuestro nombre: el alojamiento de los servidores y la base de datos (Hostinger) y el envío
          de mails (Resend). Si un negocio activa funciones opcionales, también intervienen Google (Calendar) o Meta
          (WhatsApp). Algunos de estos servidores pueden estar fuera de Argentina.
        </p>
        <p>
          Si el profesional que te atiende conectó su Google Calendar, el turno (servicio, horario, tu nombre y tu contacto)
          se copia a su calendario para que lo tenga a mano.
        </p>
      </Seccion>

      <Seccion id="google" titulo="Datos de Google (Google Calendar)">
        <p>
          Conectar Google Calendar es opcional. Lo hace cada profesional desde Panel → Integraciones, y Google le muestra
          antes qué permisos pide {MARCA.nombre}.
        </p>
        <p>
          <strong>A qué accedemos.</strong> Al mail de la cuenta de Google conectada y a los eventos del calendario
          principal de esa cuenta. No accedemos a otros calendarios, contactos, mails ni archivos.
        </p>
        <p>
          <strong>Para qué lo usamos.</strong> Solo para dos cosas, que el profesional ve en su agenda:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Crear, actualizar y borrar en su calendario un evento por cada turno (cuando se reserva, se mueve o se cancela).
          </li>
          <li>
            Saber cuándo está ocupado, para no ofrecer esos horarios a los clientes. De cada evento leemos solo cuándo
            empieza y termina, si está marcado como ocupado o disponible, si el profesional lo rechazó y su identificador
            (para reconocer los que creamos nosotros). No leemos ni guardamos títulos, descripciones, lugares ni invitados.
          </li>
        </ul>
        <p>
          <strong>Qué guardamos.</strong> El mail de la cuenta conectada; el permiso de acceso que da Google, guardado
          cifrado (AES-256) y separado del resto de los datos; el identificador de los eventos que creamos; y los horarios
          ocupados (solo inicio y fin), que se actualizan cada hora.
        </p>
        <p>
          <strong>Con quién lo compartimos.</strong> Con nadie. No vendemos ni transferimos datos de Google a terceros, no
          los usamos para publicidad ni para entrenar modelos de inteligencia artificial, y ninguna persona los lee, salvo
          que el usuario nos lo pida para resolver un problema, por seguridad o si la ley lo exige.
        </p>
        <p>
          <strong>Cómo se borran.</strong> Al desconectar Google Calendar en Panel → Integraciones borramos de su calendario
          los turnos futuros que habíamos creado, eliminamos los horarios ocupados importados y el permiso guardado, y le
          pedimos a Google que lo anule. También se puede quitar el acceso desde la cuenta de Google
          (myaccount.google.com/permissions) o pedirnos el borrado escribiendo a {contacto}.
        </p>
        <p className="rounded-lg bg-zinc-50 px-3 py-2">
          El uso que hace {MARCA.nombre} de la información recibida de las API de Google, y su transferencia a cualquier otra
          aplicación, se ajusta a la{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="font-medium text-marca-700 underline"
            target="_blank"
            rel="noopener"
          >
            Política de Datos del Usuario de los Servicios de API de Google
          </a>
          , incluidos los requisitos de Uso Limitado.
          <br />
          <span lang="en" className="text-xs text-zinc-500">
            {MARCA.nombre}&apos;s use and transfer to any other app of information received from Google APIs will adhere to
            the Google API Services User Data Policy, including the Limited Use requirements.
          </span>
        </p>
      </Seccion>

      <Seccion titulo="Cómo los protegemos">
        <p>
          Todo viaja cifrado (HTTPS). Las contraseñas se guardan con hash y los permisos de servicios externos (Google,
          Mercado Pago) cifrados. Cada negocio solo puede ver sus propios datos, y dentro de un negocio cada empleado ve solo
          su agenda.
        </p>
      </Seccion>

      <Seccion titulo="Cuánto tiempo los guardamos">
        <p>
          Mientras el negocio use {MARCA.nombre}. Si un negocio deja de usarlo o alguien pide el borrado de sus datos, los
          eliminamos, salvo lo que debamos conservar por ley. Las copias de seguridad se borran solas a los 14 días.
        </p>
      </Seccion>

      <Seccion titulo="Tus derechos">
        <p>
          Podés pedir ver, corregir o borrar tus datos escribiendo a {contacto}. La Ley 25.326 protege estos derechos, y la
          Agencia de Acceso a la Información Pública es el organismo de control que atiende los reclamos.
        </p>
      </Seccion>

      <Seccion titulo="Cambios">
        <p>
          Si cambiamos esta política, actualizamos la fecha de arriba. Si el cambio es importante, se lo avisamos por mail a
          los negocios.
        </p>
      </Seccion>
    </main>
  );
}
