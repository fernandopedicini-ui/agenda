# Agenda del día — cómo ponerla a andar

Son tres pasos: base de datos, GitHub, Vercel. Calculá 20 minutos la primera vez.

---

## 1. La base compartida (Supabase)

Esto es lo que hace que los diez vean lo mismo al mismo tiempo.

1. Entrá a **supabase.com** → **Start your project** → entrá con GitHub o Google.
2. **New project**. Nombre: `agenda`. Región: **South America (São Paulo)**. Poné una contraseña cualquiera y guardala. **Create new project** y esperá un minuto.
3. En el menú de la izquierda, el ícono de **SQL Editor**. Pegá esto y tocá **Run**:

```sql
create table tareas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  cliente text,
  responsable text,
  fecha date not null,
  hora text,
  estado text not null default 'pendiente',
  entregada_en date,
  creada_por text,
  created_at timestamptz default now()
);

create table equipo (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

alter table tareas enable row level security;
alter table equipo enable row level security;

create policy "acceso agenda" on tareas for all to anon using (true) with check (true);
create policy "acceso equipo" on equipo for all to anon using (true) with check (true);

alter publication supabase_realtime add table tareas;
alter publication supabase_realtime add table equipo;
```

Tiene que decir **Success. No rows returned**.

> Si ya habías corrido este bloque antes de esta versión, corré además:
> `alter table tareas add column if not exists entregada_en date;`

4. Ahora los datos de conexión. Son dos, y están en dos pantallas distintas dentro de
   **Project Settings**:

   - En **Data API**: el **Project URL**, algo tipo `https://abcdxyz.supabase.co`.
   - En **API Keys**: la **Publishable key**, la que empieza con `sb_publishable_`.
     (En proyectos viejos aparece como "anon public". Es la misma.)

   Guardalos en una nota, los vas a pegar en el paso 3.

   > La **Secret key** de esa misma pantalla no se usa acá y no va nunca en la app:
   > da acceso total a la base sin restricciones.

---

## 2. Subir el código a GitHub

1. Descomprimí el zip. Te queda la carpeta `agenda`.
2. Entrá a **github.com** → **New repository** → nombre `agenda` → **Private** → **Create**.
3. En la pantalla que aparece, tocá **uploading an existing file**.
4. Abrí la carpeta `agenda`, seleccioná **todo lo de adentro** (no la carpeta) y arrastralo.
   Tienen que quedar listados: `src`, `public`, `index.html`, `package.json`, `vite.config.js`.
5. Botón verde **Commit changes**.

---

## 3. Publicar en Vercel

1. Entrá a **vercel.com** con la misma cuenta de siempre.
2. **Add New** → **Project** → al lado de `agenda`, **Import**.
3. **Antes de dar Deploy**, abrí la sección **Environment Variables** y cargá las dos:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | el Project URL de Supabase |
   | `VITE_SUPABASE_ANON_KEY` | la anon public key |

   Ojo: los nombres van escritos exactamente así, en mayúsculas.
4. **Deploy**. En un minuto te da el link, tipo `agenda.vercel.app`.

Si te olvidaste de cargar las variables, la app te lo avisa en pantalla. Las cargás en
**Settings → Environment Variables** y después **Deployments → ... → Redeploy**.

---

## 4. Instalarla en los celulares

Mandale el link a los diez por WhatsApp.

- **Android:** abrir el link en **Chrome** → tres puntos → **Instalar app**.
- **iPhone:** abrir el link en **Safari** → botón compartir → **Agregar a inicio**.

Queda con ícono propio y abre en ventana completa, sin barra de navegador.

---

## 5. El primer día

1. Abrí la app y tocá **¿quién sos?** arriba a la derecha.
2. Cargá los diez nombres del equipo.
3. Cada uno, la primera vez que abre, toca su propio nombre. Queda guardado en ese teléfono
   y habilita el filtro **Lo mío**.

Listo. Cargar una tarea son cuatro toques: nombre, quién la tiene, hora, guardar.

Para dar algo por entregado, el círculo de la derecha. Lo toca la persona que tiene la tarea,
no vos: así la agenda se mantiene sola y ves el estado sin preguntar.

Cómo se comporta la lista:

- Lo entregado queda tachado al final, pero solo ese día. Al día siguiente ya no aparece.
- Lo que quedó sin entregar se arrastra solo al día siguiente, arriba de todo, con la etiqueta
  del día del que viene. Sigue apareciendo hasta que alguien lo tilde.
- Si te equivocaste y tildaste algo, tocás de nuevo y vuelve a pendiente.

O sea que la lista nunca crece: siempre muestra lo que falta, no el historial.

---

## Lo que conviene saber

**Costo:** cero. Vercel plan Hobby y Supabase plan gratis alcanzan de sobra para diez personas.

**Seguridad:** no tiene contraseña. Cualquiera con el link puede ver y cargar tareas. Para una
agenda interna suele estar bien, porque el link no está publicado en ningún lado. Si en algún
momento querés login real, se le agrega.

**Sin internet:** la app abre, pero las tareas no se actualizan hasta que vuelva la señal.
