import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, configurada } from "./supabase";

/* ---------- utilidades de fecha ---------- */

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function aISO(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

function desdeISO(s) {
  const [a, m, d] = s.split("-").map(Number);
  return new Date(a, m - 1, d);
}

function correr(iso, dias) {
  const d = desdeISO(iso);
  d.setDate(d.getDate() + dias);
  return aISO(d);
}

function diasEntre(a, b) {
  return Math.round((desdeISO(b) - desdeISO(a)) / 86400000);
}

function tituloDia(iso) {
  const hoy = aISO(new Date());
  if (iso === hoy) return "Hoy";
  if (iso === correr(hoy, 1)) return "Mañana";
  if (iso === correr(hoy, -1)) return "Ayer";
  const d = desdeISO(iso);
  return DIAS[d.getDay()];
}

function subtituloDia(iso) {
  const d = desdeISO(iso);
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
}

function deDondeViene(iso, hasta) {
  const dif = diasEntre(iso, hasta);
  if (dif === 1) return "viene de ayer";
  if (dif < 7) return `viene del ${DIAS[desdeISO(iso).getDay()]}`;
  const d = desdeISO(iso);
  return `viene del ${d.getDate()}/${d.getMonth() + 1}`;
}

function pasoLaHora(t) {
  if (t.estado === "lista" || !t.hora) return false;
  const ahora = new Date();
  if (t.fecha !== aISO(ahora)) return false;
  const reloj = `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;
  return t.hora < reloj;
}

/* ---------- app ---------- */

export default function App() {
  const [yo, setYo] = useState(() => localStorage.getItem("yo") || "");
  const [fecha, setFecha] = useState(() => aISO(new Date()));
  const [filtro, setFiltro] = useState("todo");
  const [tareas, setTareas] = useState([]);
  const [equipo, setEquipo] = useState([]);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState(null);

  // Hoy y días pasados: se arrastra todo lo pendiente hasta esa fecha.
  // Días futuros: solo lo agendado para ese día, para no repetir lo mismo en cada pantalla.
  // En los dos casos se suma lo que se entregó ese mismo día, y nada más.
  const cargar = useCallback(async () => {
    if (!supabase) return;
    const futuro = fecha > aISO(new Date());
    const pendientes = `and(estado.eq.pendiente,fecha.${futuro ? "eq" : "lte"}.${fecha})`;
    const [t, e] = await Promise.all([
      supabase
        .from("tareas")
        .select("*")
        .or(`${pendientes},entregada_en.eq.${fecha}`),
      supabase.from("equipo").select("*").order("nombre"),
    ]);
    if (t.error || e.error) {
      setError((t.error || e.error).message);
      return;
    }
    setError("");
    setTareas(t.data || []);
    setEquipo(e.data || []);
  }, [fecha]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!supabase) return;
    const canal = supabase
      .channel("agenda")
      .on("postgres_changes", { event: "*", schema: "public", table: "tareas" }, cargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "equipo" }, cargar)
      .subscribe();
    const reloj = setInterval(cargar, 60000);
    return () => {
      supabase.removeChannel(canal);
      clearInterval(reloj);
    };
  }, [cargar]);

  useEffect(() => {
    if (yo) localStorage.setItem("yo", yo);
  }, [yo]);

  const visibles = useMemo(() => {
    const base = filtro === "mio" && yo ? tareas.filter((t) => t.responsable === yo) : tareas;
    const rango = (t) => (t.estado === "lista" ? 2 : t.fecha < fecha ? 0 : 1);
    return [...base].sort((a, b) => {
      const ra = rango(a);
      const rb = rango(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0 && a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
      if (!a.hora && !b.hora) return a.titulo.localeCompare(b.titulo);
      if (!a.hora) return 1;
      if (!b.hora) return -1;
      return a.hora.localeCompare(b.hora);
    });
  }, [tareas, filtro, yo, fecha]);

  const abiertas = visibles.filter((t) => t.estado !== "lista").length;
  const entregadas = visibles.filter((t) => t.estado === "lista").length;
  const colgadas = visibles.filter((t) => t.estado !== "lista" && t.fecha < fecha).length;

  async function guardarTarea(datos) {
    const { error } = await supabase.from("tareas").insert(datos);
    if (error) {
      setError("No se pudo guardar: " + error.message);
      return false;
    }
    setError("");
    cargar();
    return true;
  }

  async function cambiarTarea(id, cambios) {
    const antes = tareas;
    setTareas((prev) => prev.map((t) => (t.id === id ? { ...t, ...cambios } : t)));
    const { error } = await supabase.from("tareas").update(cambios).eq("id", id);
    if (error) {
      setTareas(antes);
      setError("No se pudo guardar el cambio: " + error.message);
      return;
    }
    setError("");
    cargar();
  }

  function tildar(t) {
    const hecha = t.estado === "lista";
    cambiarTarea(t.id, {
      estado: hecha ? "pendiente" : "lista",
      entregada_en: hecha ? null : aISO(new Date()),
    });
  }

  async function borrarTarea(id) {
    setTareas((prev) => prev.filter((t) => t.id !== id));
    await supabase.from("tareas").delete().eq("id", id);
    cargar();
  }

  if (!configurada) {
    return (
      <div className="app">
        <div className="tope">
          <div className="marca">
            <span className="be">be</span>singular
          </div>
        </div>
        <div className="aviso">
          <strong>Falta conectar la base</strong>
          Cargá las variables <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> en
          Vercel, en Settings → Environment Variables, y volvé a publicar. Está todo explicado en el
          instructivo.
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="tope">
        <div className="marca">
          <span className="be">be</span>singular
        </div>
        <button className="yo" onClick={() => setPanel({ tipo: "equipo" })}>
          {yo ? (
            <>
              soy <b>{yo}</b>
            </>
          ) : (
            "¿quién sos?"
          )}
        </button>
      </div>

      <div className="dia">
        <h1>{tituloDia(fecha)}</h1>
        <span className="fecha">{subtituloDia(fecha)}</span>
      </div>
      <p className="resumen">
        {visibles.length === 0 ? (
          "Nada pendiente"
        ) : (
          <>
            <b>{abiertas}</b> por entregar
            {entregadas > 0 && <> · {entregadas} listas</>}
            {colgadas > 0 && <span className="vencidas"> · {colgadas} de días anteriores</span>}
          </>
        )}
      </p>

      <div className="controles">
        <div className="nav">
          <button onClick={() => setFecha(correr(fecha, -1))} aria-label="Día anterior">
            ‹
          </button>
          <button onClick={() => setFecha(aISO(new Date()))} aria-label="Volver a hoy">
            ●
          </button>
          <button onClick={() => setFecha(correr(fecha, 1))} aria-label="Día siguiente">
            ›
          </button>
        </div>
        <div className="filtros">
          <button
            className={`filtro ${filtro === "todo" ? "activo" : ""}`}
            onClick={() => setFiltro("todo")}
          >
            Todo
          </button>
          <button
            className={`filtro ${filtro === "mio" ? "activo" : ""}`}
            onClick={() => (yo ? setFiltro("mio") : setPanel({ tipo: "equipo" }))}
          >
            Lo mío
          </button>
        </div>
      </div>

      {error && <p className="aviso">{error}</p>}

      {visibles.length === 0 ? (
        <div className="vacio">
          <strong>{filtro === "mio" ? "No tenés nada acá" : "Día limpio"}</strong>
          {filtro === "mio"
            ? "Ninguna tarea tuya sin entregar."
            : "Cargá la primera tarea del día."}
        </div>
      ) : (
        <div className="lista">
          {visibles.map((t) => {
            const hecha = t.estado === "lista";
            const vieja = !hecha && t.fecha < fecha;
            const tarde = pasoLaHora(t);
            return (
              <div key={t.id} className={`fila ${hecha ? "hecha" : ""}`}>
                <span className={`punto ${vieja || tarde ? "tarde" : hecha ? "lista" : "pendiente"}`} />
                <span className={`hora ${tarde ? "tarde" : ""} ${t.hora ? "" : "libre"}`}>
                  {t.hora || "s/h"}
                </span>
                <button className="cuerpo" onClick={() => setPanel({ tipo: "tarea", tarea: t })}>
                  <span className="titulo">{t.titulo}</span>
                  <span className="meta">
                    <span className={`quien ${t.responsable === yo ? "mia" : ""}`}>
                      {t.responsable || "sin asignar"}
                    </span>
                    {t.cliente && (
                      <>
                        <span className="sep">/</span>
                        {t.cliente}
                      </>
                    )}
                    {vieja && <span className="etiqueta">{deDondeViene(t.fecha, fecha)}</span>}
                    {tarde && <span className="etiqueta">pasó la hora</span>}
                  </span>
                </button>
                <button
                  className={`tildar ${hecha ? "hecha" : ""}`}
                  aria-label={hecha ? "Volver a pendiente" : "Marcar como entregada"}
                  onClick={() => tildar(t)}
                >
                  ✓
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="pie">
        <div className="adentro">
          <button className="principal" onClick={() => setPanel({ tipo: "nueva" })}>
            Nueva tarea
          </button>
        </div>
      </div>

      {panel && (
        <>
          <div className="fondo" onClick={() => setPanel(null)} />
          <div className="panel">
            <div className="adentro">
              <div className="agarre" />
              {panel.tipo === "nueva" && (
                <FormaTarea
                  equipo={equipo}
                  yo={yo}
                  fecha={fecha}
                  onGuardar={async (d) => {
                    const ok = await guardarTarea(d);
                    if (ok) setPanel(null);
                  }}
                />
              )}
              {panel.tipo === "tarea" && (
                <DetalleTarea
                  tarea={panel.tarea}
                  equipo={equipo}
                  onCambiar={(c) => {
                    cambiarTarea(panel.tarea.id, c);
                    setPanel(null);
                  }}
                  onBorrar={() => {
                    borrarTarea(panel.tarea.id);
                    setPanel(null);
                  }}
                />
              )}
              {panel.tipo === "equipo" && (
                <PanelEquipo
                  equipo={equipo}
                  yo={yo}
                  onElegir={(n) => {
                    setYo(n);
                    setPanel(null);
                  }}
                  onCambio={cargar}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- nueva tarea ---------- */

function FormaTarea({ equipo, yo, fecha, onGuardar }) {
  const [titulo, setTitulo] = useState("");
  const [cliente, setCliente] = useState("");
  const [responsable, setResponsable] = useState(yo || "");
  const [hora, setHora] = useState("");
  const [cuando, setCuando] = useState(fecha);
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function enviar() {
    if (guardando) return;
    if (!titulo.trim()) return setAviso("Ponele un nombre a la tarea.");
    setGuardando(true);
    await onGuardar({
      titulo: titulo.trim(),
      cliente: cliente.trim() || null,
      responsable: responsable || null,
      hora: hora || null,
      fecha: cuando,
      estado: "pendiente",
      creada_por: yo || null,
    });
    setGuardando(false);
  }

  return (
    <>
      <h2>Nueva tarea</h2>
      {aviso && <p className="error">{aviso}</p>}

      <div className="campo">
        <label htmlFor="t">Qué hay que hacer</label>
        <input
          id="t"
          value={titulo}
          onChange={(e) => {
            setTitulo(e.target.value);
            setAviso("");
          }}
          placeholder="Guion del reel"
          autoFocus
        />
      </div>

      <div className="campo">
        <label htmlFor="c">Cliente o proyecto</label>
        <input id="c" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Opcional" />
      </div>

      <div className="campo">
        <label>Quién la tiene</label>
        <div className="gente">
          {equipo.map((p) => (
            <button
              key={p.id}
              className={`persona ${responsable === p.nombre ? "elegida" : ""}`}
              onClick={() => setResponsable(responsable === p.nombre ? "" : p.nombre)}
            >
              {p.nombre}
            </button>
          ))}
          {equipo.length === 0 && <p className="detalle">Cargá primero al equipo desde "¿quién sos?".</p>}
        </div>
      </div>

      <div className="duo">
        <div className="campo">
          <label htmlFor="f">Día de entrega</label>
          <input id="f" type="date" value={cuando} onChange={(e) => setCuando(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="h">Hora</label>
          <input id="h" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
        </div>
      </div>

      <button
        className="principal"
        disabled={guardando}
        onPointerDown={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        {guardando ? "Guardando…" : "Guardar tarea"}
      </button>
    </>
  );
}

/* ---------- detalle de una tarea ---------- */

function DetalleTarea({ tarea, equipo, onCambiar, onBorrar }) {
  const [confirmar, setConfirmar] = useState(false);

  return (
    <>
      <h2>{tarea.titulo}</h2>
      <p className="detalle">
        {tarea.responsable || "Sin asignar"}
        {tarea.cliente && ` · ${tarea.cliente}`}
        {tarea.hora && ` · entrega ${tarea.hora}`}
      </p>

      <div className="campo">
        <label>Pasarla a otra persona</label>
        <div className="gente">
          {equipo.map((p) => (
            <button
              key={p.id}
              className={`persona ${tarea.responsable === p.nombre ? "elegida" : ""}`}
              onClick={() => onCambiar({ responsable: p.nombre })}
            >
              {p.nombre}
            </button>
          ))}
        </div>
      </div>

      <div className="campo">
        <label htmlFor="nf">Mover a otro día</label>
        <input
          id="nf"
          type="date"
          defaultValue={tarea.fecha}
          onChange={(e) => e.target.value && onCambiar({ fecha: e.target.value })}
        />
      </div>

      {confirmar ? (
        <button className="secundario borrar" onClick={onBorrar}>
          Confirmar: eliminar la tarea
        </button>
      ) : (
        <button className="secundario borrar" onClick={() => setConfirmar(true)}>
          Eliminar
        </button>
      )}
    </>
  );
}

/* ---------- equipo ---------- */

function PanelEquipo({ equipo, yo, onElegir, onCambio }) {
  const [nuevo, setNuevo] = useState("");

  async function sumar() {
    const nombre = nuevo.trim();
    if (!nombre) return;
    setNuevo("");
    await supabase.from("equipo").insert({ nombre });
    onCambio();
  }

  async function quitar(id) {
    await supabase.from("equipo").delete().eq("id", id);
    onCambio();
  }

  return (
    <>
      <h2>El equipo</h2>
      <p className="detalle">Tocá tu nombre para que la app sepa quién sos en este teléfono.</p>

      {equipo.map((p) => (
        <div className="hilera" key={p.id}>
          <button className={`persona ${yo === p.nombre ? "elegida" : ""}`} onClick={() => onElegir(p.nombre)}>
            {p.nombre}
          </button>
          <button className="quitar" onClick={() => quitar(p.id)}>
            quitar
          </button>
        </div>
      ))}

      <div className="sumar">
        <input
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          placeholder="Sumar a alguien"
          onKeyDown={(e) => e.key === "Enter" && sumar()}
        />
        <button onClick={sumar}>Sumar</button>
      </div>
    </>
  );
}
