import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, configurada } from "./supabase";

/* ---------- fechas ---------- */

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

// Etiqueta corta de vencimiento, la que va a la izquierda de cada tarea.
function cuando(iso, hoy) {
  if (iso === hoy) return "hoy";
  if (iso === correr(hoy, 1)) return "mañana";
  const dif = diasEntre(hoy, iso);
  if (dif > 1 && dif < 7) return DIAS[desdeISO(iso).getDay()].slice(0, 3);
  const d = desdeISO(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function atraso(iso, hoy) {
  const dif = diasEntre(iso, hoy);
  if (dif === 1) return "venció ayer";
  if (dif < 7) return `venció el ${DIAS[desdeISO(iso).getDay()]}`;
  return `${dif} días de atraso`;
}

/* ---------- app ---------- */

export default function App() {
  const [yo, setYo] = useState(() => localStorage.getItem("yo") || "");
  const [hoy, setHoy] = useState(() => aISO(new Date()));
  const [filtro, setFiltro] = useState("todo");
  const [tareas, setTareas] = useState([]);
  const [equipo, setEquipo] = useState([]);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState(null);

  // Todo lo que está pendiente, sin importar para qué día vence,
  // más lo que se entregó hoy (que se ve tachado hasta que termine el día).
  const cargar = useCallback(async () => {
    if (!supabase) return;
    const ahora = aISO(new Date());
    setHoy(ahora);
    const [t, e] = await Promise.all([
      supabase.from("tareas").select("*").or(`estado.eq.pendiente,entregada_en.eq.${ahora}`),
      supabase.from("equipo").select("*").order("nombre"),
    ]);
    if (t.error || e.error) {
      setError((t.error || e.error).message);
      return;
    }
    setError("");
    setTareas(t.data || []);
    setEquipo(e.data || []);
  }, []);

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
    const alVolver = () => document.visibilityState === "visible" && cargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      supabase.removeChannel(canal);
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [cargar]);

  useEffect(() => {
    if (yo) localStorage.setItem("yo", yo);
  }, [yo]);

  const visibles = useMemo(() => {
    const base = filtro === "mio" && yo ? tareas.filter((t) => t.responsable === yo) : tareas;
    return [...base].sort((a, b) => {
      const ha = a.estado === "lista" ? 1 : 0;
      const hb = b.estado === "lista" ? 1 : 0;
      if (ha !== hb) return ha - hb;
      if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
      if (!a.hora && !b.hora) return a.titulo.localeCompare(b.titulo);
      if (!a.hora) return 1;
      if (!b.hora) return -1;
      return a.hora.localeCompare(b.hora);
    });
  }, [tareas, filtro, yo]);

  const abiertas = visibles.filter((t) => t.estado !== "lista").length;
  const entregadas = visibles.filter((t) => t.estado === "lista").length;
  const atrasadas = visibles.filter((t) => t.estado !== "lista" && t.fecha < hoy).length;

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
          Vercel, en Settings → Environment Variables, y volvé a publicar.
        </div>
      </div>
    );
  }

  const d = desdeISO(hoy);

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
        <h1>Pendientes</h1>
        <span className="fecha">
          {DIAS[d.getDay()]} {d.getDate()} de {MESES[d.getMonth()]}
        </span>
      </div>
      <p className="resumen">
        {abiertas === 0 && entregadas === 0 ? (
          "No hay nada cargado"
        ) : (
          <>
            <b>{abiertas}</b> por entregar
            {atrasadas > 0 && <span className="vencidas"> · {atrasadas} atrasadas</span>}
            {entregadas > 0 && <> · {entregadas} entregadas hoy</>}
          </>
        )}
      </p>

      <div className="controles">
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
          <strong>{filtro === "mio" ? "No tenés nada pendiente" : "Todo al día"}</strong>
          {filtro === "mio" ? "Ninguna tarea tuya sin entregar." : "Cargá la primera tarea."}
        </div>
      ) : (
        <div className="lista">
          {visibles.map((t) => {
            const hecha = t.estado === "lista";
            const tarde = !hecha && t.fecha < hoy;
            return (
              <div key={t.id} className={`fila ${hecha ? "hecha" : ""}`}>
                <span className={`punto ${tarde ? "tarde" : hecha ? "lista" : "pendiente"}`} />
                <span className={`hora ${tarde ? "tarde" : ""}`}>{cuando(t.fecha, hoy)}</span>
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
                    {t.hora && !hecha && (
                      <>
                        <span className="sep">/</span>
                        {t.hora}
                      </>
                    )}
                    {tarde && <span className="etiqueta">{atraso(t.fecha, hoy)}</span>}
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
                  hoy={hoy}
                  onGuardar={async (dat) => {
                    const ok = await guardarTarea(dat);
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

function FormaTarea({ equipo, yo, hoy, onGuardar }) {
  const [titulo, setTitulo] = useState("");
  const [cliente, setCliente] = useState("");
  const [responsable, setResponsable] = useState(yo || "");
  const [hora, setHora] = useState("");
  const [vence, setVence] = useState(hoy);
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
      fecha: vence,
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
          <label htmlFor="f">Fecha de entrega</label>
          <input id="f" type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
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

/* ---------- detalle ---------- */

function DetalleTarea({ tarea, equipo, onCambiar, onBorrar }) {
  const [confirmar, setConfirmar] = useState(false);

  return (
    <>
      <h2>{tarea.titulo}</h2>
      <p className="detalle">
        {tarea.responsable || "Sin asignar"}
        {tarea.cliente && ` · ${tarea.cliente}`}
        {tarea.hora && ` · ${tarea.hora}`}
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
        <label htmlFor="nf">Cambiar la fecha de entrega</label>
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
