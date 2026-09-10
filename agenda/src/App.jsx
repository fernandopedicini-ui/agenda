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

/* ---------- horas ---------- */

const ATAJOS_HORAS = [1, 2, 4, 6, 8, 16];

// Un número de horas listo para mostrar: 4 → "4h", 1.5 → "1,5h".
function fmtH(n) {
  const v = Number(n);
  if (n === null || n === undefined || n === "" || !Number.isFinite(v)) return null;
  return `${Number.isInteger(v) ? v : String(v).replace(".", ",")}h`;
}

// Lo que escribe la gente ("2,5") a número, o null si no cargó nada.
function aHoras(texto) {
  const limpio = String(texto ?? "").replace(",", ".").trim();
  if (!limpio) return null;
  const v = Number(limpio);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

// Cuánto se desvió lo real de lo estimado. Sin estimación no hay desvío.
function desvio(est, real) {
  const e = aHoras(est);
  const r = aHoras(real);
  if (e === null || r === null || e <= 0) return "";
  if (r > e * 1.15) return "pasado";
  if (r < e * 0.85) return "menos";
  return "clavado";
}

/* ---------- permisos ---------- */

// Cada tarea es de quien la cargó: solo esa persona la tacha, la edita o la borra.
// Las tareas viejas, cargadas antes de que se guardara el autor, quedan abiertas
// para todos; si no, no habría manera de cerrarlas nunca.
function esMia(tarea, yo) {
  if (!tarea.creada_por) return true;
  return tarea.creada_por === yo;
}

/* ---------- meses ---------- */

function mesDe(iso) {
  return iso.slice(0, 7);
}

// Primer y último día del mes, en ISO, para pedirle el rango a la base.
function rangoMes(ym) {
  const [a, m] = ym.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  const ultimo = new Date(a, m, 0).getDate();
  return { desde: `${a}-${mm}-01`, hasta: `${a}-${mm}-${ultimo}` };
}

function correrMes(ym, cuantos) {
  const [a, m] = ym.split("-").map(Number);
  const d = new Date(a, m - 1 + cuantos, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nombreMes(ym) {
  const [a, m] = ym.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}

// Junta las tareas del mes por cliente o por responsable.
function agrupar(tareas, clave, sinNombre) {
  const mapa = new Map();
  for (const t of tareas) {
    const k = (t[clave] || "").trim() || sinNombre;
    const fila = mapa.get(k) || { nombre: k, horas: 0, estimadas: 0, tareas: 0, sinHoras: 0 };
    const reales = aHoras(t.horas_reales);
    const est = aHoras(t.horas_estimadas);
    fila.tareas += 1;
    if (reales === null) fila.sinHoras += 1;
    else fila.horas += reales;
    if (est !== null) fila.estimadas += est;
    mapa.set(k, fila);
  }
  return [...mapa.values()].sort((a, b) => b.horas - a.horas || b.tareas - a.tareas);
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

  // Horas estimadas que quedan por delante, para saber si la semana entra o no.
  const horasAbiertas = visibles.reduce(
    (suma, t) => (t.estado !== "lista" ? suma + (Number(t.horas_estimadas) || 0) : suma),
    0
  );

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

  // Al entregar preguntamos las horas reales; al reabrir las borramos,
  // así el dato siempre corresponde a la entrega que quedó firme.
  function tildar(t) {
    if (!yo) {
      setPanel({ tipo: "equipo" });
      return;
    }
    if (!esMia(t, yo)) {
      setError(`"${t.titulo}" la cargó ${t.creada_por}. Solo esa persona puede tacharla.`);
      return;
    }
    if (t.estado === "lista") {
      cambiarTarea(t.id, { estado: "pendiente", entregada_en: null, horas_reales: null });
      return;
    }
    setPanel({ tipo: "cerrar", tarea: t });
  }

  function cerrarTarea(t, horas) {
    cambiarTarea(t.id, {
      estado: "lista",
      entregada_en: aISO(new Date()),
      horas_reales: horas,
    });
    setPanel(null);
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
      </div>
      <p className="resumen">
        <span className="fecha">
          {DIAS[d.getDay()]} {d.getDate()} de {MESES[d.getMonth()]}
        </span>
        {abiertas === 0 && entregadas === 0 ? (
          <> · nada cargado</>
        ) : (
          <>
            {" · "}
            <b>{abiertas}</b> por entregar
            {horasAbiertas > 0 && <> · <b>{fmtH(horasAbiertas)}</b> estimadas</>}
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
        <button className="filtro mes" onClick={() => setPanel({ tipo: "mes" })}>
          Horas del mes
        </button>
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
            const ajena = !esMia(t, yo);
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
                    <Horas tarea={t} hecha={hecha} />
                    {t.descripcion && <span className="conDetalle">detalle</span>}
                    {tarde && <span className="etiqueta">{atraso(t.fecha, hoy)}</span>}
                  </span>
                </button>
                <button
                  className={`tildar ${hecha ? "hecha" : ""} ${ajena ? "ajena" : ""}`}
                  aria-label={
                    ajena
                      ? `La cargó ${t.creada_por}, solo esa persona puede tacharla`
                      : hecha
                      ? "Volver a pendiente"
                      : "Marcar como entregada"
                  }
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
          <button
            className="principal"
            onClick={() => setPanel({ tipo: yo ? "nueva" : "equipo" })}
          >
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
                  yo={yo}
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
              {panel.tipo === "cerrar" && (
                <PanelCierre tarea={panel.tarea} onCerrar={(h) => cerrarTarea(panel.tarea, h)} />
              )}
              {panel.tipo === "mes" && <PanelMes hoy={hoy} />}
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

/* ---------- horas en la fila ---------- */

function Horas({ tarea, hecha }) {
  const est = fmtH(tarea.horas_estimadas);
  const real = fmtH(tarea.horas_reales);

  if (hecha && real) {
    const d = desvio(tarea.horas_estimadas, tarea.horas_reales);
    return (
      <span className={`horas ${d}`}>{est ? `${est} → ${real}` : real}</span>
    );
  }
  if (est) return <span className="horas">{est}</span>;
  return null;
}

/* ---------- campo de horas, reusable ---------- */

function CampoHoras({ id, etiqueta, valor, onCambio, placeholder }) {
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={valor}
        onChange={(e) => onCambio(e.target.value.replace(/[^0-9.,]/g, ""))}
        placeholder={placeholder}
      />
      <div className="gente atajos">
        {ATAJOS_HORAS.map((n) => (
          <button
            key={n}
            className={`persona ${aHoras(valor) === n ? "elegida" : ""}`}
            onClick={() => onCambio(aHoras(valor) === n ? "" : String(n).replace(".", ","))}
          >
            {fmtH(n)}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- cerrar tarea: cuántas horas llevó ---------- */

function PanelCierre({ tarea, onCerrar }) {
  const [reales, setReales] = useState(
    tarea.horas_reales != null ? String(tarea.horas_reales).replace(".", ",") : ""
  );
  const est = fmtH(tarea.horas_estimadas);
  const cargadas = aHoras(reales);

  return (
    <>
      <h2>{tarea.titulo}</h2>
      <p className="detalle">
        {est ? `Estimaste ${est}. ¿Cuántas te llevó de verdad?` : "¿Cuántas horas te llevó?"}
      </p>

      <CampoHoras
        id="hr"
        etiqueta="Horas reales"
        valor={reales}
        onCambio={setReales}
        placeholder="ej. 3,5"
      />

      <button
        className="principal"
        onPointerDown={(e) => {
          e.preventDefault();
          onCerrar(cargadas);
        }}
      >
        {cargadas != null ? `Entregada · ${fmtH(cargadas)}` : "Entregada"}
      </button>

      {cargadas == null && (
        <p className="detalle" style={{ margin: "10px 0 0", textAlign: "center" }}>
          Podés entregarla sin cargar las horas y ponerlas después.
        </p>
      )}
    </>
  );
}

/* ---------- horas del mes ---------- */

function Ranking({ filas, tope }) {
  if (filas.length === 0) return <p className="detalle">Nada entregado este mes.</p>;
  return (
    <div className="ranking">
      {filas.map((f) => (
        <div className="rank" key={f.nombre}>
          <div className="rankTop">
            <span className="rankNombre">{f.nombre}</span>
            <span className="rankHoras">{f.horas > 0 ? fmtH(f.horas) : "—"}</span>
          </div>
          <div className="barra">
            <span style={{ width: `${tope > 0 ? Math.round((f.horas / tope) * 100) : 0}%` }} />
          </div>
          <span className="rankPie">
            {f.tareas} {f.tareas === 1 ? "tarea" : "tareas"}
            {f.estimadas > 0 && ` · ${fmtH(f.estimadas)} estimadas`}
            {f.sinHoras > 0 && ` · ${f.sinHoras} sin horas`}
          </span>
        </div>
      ))}
    </div>
  );
}

function PanelMes({ hoy }) {
  const mesActual = mesDe(hoy);
  const [mes, setMes] = useState(mesActual);
  const [tareas, setTareas] = useState(null);
  const [error, setError] = useState("");

  // Traemos solo lo entregado dentro del mes elegido. El historial vive en la
  // base aunque la lista del día ya no lo muestre.
  useEffect(() => {
    let vigente = true;
    setTareas(null);
    const { desde, hasta } = rangoMes(mes);
    supabase
      .from("tareas")
      .select("*")
      .eq("estado", "lista")
      .gte("entregada_en", desde)
      .lte("entregada_en", hasta)
      .then(({ data, error }) => {
        if (!vigente) return;
        if (error) {
          setError(error.message);
          setTareas([]);
          return;
        }
        setError("");
        setTareas(data || []);
      });
    return () => {
      vigente = false;
    };
  }, [mes]);

  const resumen = useMemo(() => {
    if (!tareas) return null;
    const porCliente = agrupar(tareas, "cliente", "Sin cliente");
    const porPersona = agrupar(tareas, "responsable", "Sin asignar");
    const totalReal = tareas.reduce((s, t) => s + (aHoras(t.horas_reales) || 0), 0);
    const totalEst = tareas.reduce((s, t) => s + (aHoras(t.horas_estimadas) || 0), 0);
    const sinHoras = tareas.filter((t) => aHoras(t.horas_reales) === null).length;
    return { porCliente, porPersona, totalReal, totalEst, sinHoras, entregadas: tareas.length };
  }, [tareas]);

  return (
    <>
      <h2>Horas del mes</h2>

      <div className="mesNav">
        <button onClick={() => setMes(correrMes(mes, -1))} aria-label="Mes anterior">
          ‹
        </button>
        <span>{nombreMes(mes)}</span>
        <button
          onClick={() => setMes(correrMes(mes, 1))}
          disabled={mes >= mesActual}
          aria-label="Mes siguiente"
        >
          ›
        </button>
      </div>

      {error && <p className="aviso">{error}</p>}

      {!resumen ? (
        <p className="detalle">Buscando…</p>
      ) : resumen.entregadas === 0 ? (
        <div className="vacio">
          <strong>Sin entregas</strong>
          No hay nada entregado en {nombreMes(mes)}.
        </div>
      ) : (
        <>
          <div className="granTotal">
            <strong>{resumen.totalReal > 0 ? fmtH(resumen.totalReal) : "sin horas cargadas"}</strong>
            <span>
              en {resumen.entregadas} {resumen.entregadas === 1 ? "tarea entregada" : "tareas entregadas"}
              {resumen.totalEst > 0 && ` · ${fmtH(resumen.totalEst)} estimadas`}
            </span>
          </div>

          <h3 className="seccion">Por cliente</h3>
          <Ranking filas={resumen.porCliente} tope={resumen.porCliente[0]?.horas || 0} />

          <h3 className="seccion">Por persona</h3>
          <Ranking filas={resumen.porPersona} tope={resumen.porPersona[0]?.horas || 0} />

          {resumen.sinHoras > 0 && (
            <p className="ojo">
              {resumen.sinHoras === resumen.entregadas
                ? resumen.entregadas === 1
                  ? "La única tarea entregada este mes se cerró sin cargar las horas."
                  : `Ninguna de las ${resumen.entregadas} tareas entregadas tiene horas cargadas.`
                : `${resumen.sinHoras} ${
                    resumen.sinHoras === 1 ? "tarea se entregó" : "tareas se entregaron"
                  } sin cargar las horas, así que el total real es más alto que este.`}
            </p>
          )}
        </>
      )}
    </>
  );
}

/* ---------- nueva tarea ---------- */

function FormaTarea({ equipo, yo, hoy, onGuardar }) {
  const [titulo, setTitulo] = useState("");
  const [cliente, setCliente] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [responsable, setResponsable] = useState(yo || "");
  const [hora, setHora] = useState("");
  const [estimadas, setEstimadas] = useState("");
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
      descripcion: descripcion.trim() || null,
      responsable: responsable || null,
      hora: hora || null,
      horas_estimadas: aHoras(estimadas),
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
        <label htmlFor="dsc">Detalle del trabajo</label>
        <textarea
          id="dsc"
          rows={4}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Qué hay que hacer, formatos, referencias, lo que haga falta"
        />
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

      <CampoHoras
        id="he"
        etiqueta="Horas estimadas"
        valor={estimadas}
        onCambio={setEstimadas}
        placeholder="Opcional — ej. 4"
      />

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

// Cabecera común: quién la tiene y cómo le fue con las horas.
function CabezaTarea({ tarea }) {
  const d = desvio(tarea.horas_estimadas, tarea.horas_reales);
  return (
    <>
      <h2>{tarea.titulo}</h2>
      <p className="detalle">
        {tarea.responsable || "Sin asignar"}
        {tarea.cliente && ` · ${tarea.cliente}`}
        {tarea.hora && ` · ${tarea.hora}`}
      </p>

      {d && (
        <p className={`balance ${d}`}>
          {d === "pasado" && `Se pasó: ${fmtH(tarea.horas_estimadas)} estimadas, ${fmtH(tarea.horas_reales)} reales.`}
          {d === "menos" && `Salió más rápido: ${fmtH(tarea.horas_estimadas)} estimadas, ${fmtH(tarea.horas_reales)} reales.`}
          {d === "clavado" && `Clavada: ${fmtH(tarea.horas_estimadas)} estimadas, ${fmtH(tarea.horas_reales)} reales.`}
        </p>
      )}
    </>
  );
}

// Lo que ve alguien que no cargó la tarea: todo, pero sin poder tocar nada.
function DetalleAjeno({ tarea }) {
  const est = fmtH(tarea.horas_estimadas);
  const real = fmtH(tarea.horas_reales);
  return (
    <>
      <CabezaTarea tarea={tarea} />

      <div className="campo">
        <label>Detalle del trabajo</label>
        <p className="lectura">{tarea.descripcion || "Sin detalle cargado."}</p>
      </div>

      {(est || real) && (
        <div className="campo">
          <label>Horas</label>
          <p className="lectura">
            {est ? `${est} estimadas` : "Sin estimar"}
            {real && ` · ${real} reales`}
          </p>
        </div>
      )}

      <p className="ojo">
        Esta tarea la cargó <b>{tarea.creada_por}</b>. Solo esa persona puede editarla, pasarla
        a otro o darla por entregada.
      </p>
    </>
  );
}

function DetalleTarea({ tarea, equipo, yo, onCambiar, onBorrar }) {
  if (!esMia(tarea, yo)) return <DetalleAjeno tarea={tarea} />;
  return <DetalleMia tarea={tarea} equipo={equipo} onCambiar={onCambiar} onBorrar={onBorrar} />;
}

function DetalleMia({ tarea, equipo, onCambiar, onBorrar }) {
  const [confirmar, setConfirmar] = useState(false);
  const [texto, setTexto] = useState(tarea.descripcion || "");
  const [estimadas, setEstimadas] = useState(
    tarea.horas_estimadas != null ? String(tarea.horas_estimadas).replace(".", ",") : ""
  );
  const [reales, setReales] = useState(
    tarea.horas_reales != null ? String(tarea.horas_reales).replace(".", ",") : ""
  );
  const hecha = tarea.estado === "lista";

  const cambios = {};
  if (texto.trim() !== (tarea.descripcion || "")) cambios.descripcion = texto.trim() || null;
  // aHoras() normaliza los dos lados: la base puede devolver el numeric como texto.
  if (aHoras(estimadas) !== aHoras(tarea.horas_estimadas)) cambios.horas_estimadas = aHoras(estimadas);
  if (aHoras(reales) !== aHoras(tarea.horas_reales)) cambios.horas_reales = aHoras(reales);
  const hayCambios = Object.keys(cambios).length > 0;

  return (
    <>
      <CabezaTarea tarea={tarea} />

      <div className="campo">
        <label htmlFor="d2">Detalle del trabajo</label>
        <textarea
          id="d2"
          rows={5}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Todavía no hay detalle. Escribilo acá."
        />
      </div>

      <CampoHoras
        id="he2"
        etiqueta="Horas estimadas"
        valor={estimadas}
        onCambio={setEstimadas}
        placeholder="Sin estimar"
      />

      {(hecha || aHoras(reales) != null) && (
        <CampoHoras
          id="hr2"
          etiqueta="Horas reales"
          valor={reales}
          onCambio={setReales}
          placeholder="Sin cargar"
        />
      )}

      {hayCambios && (
        <button
          className="principal"
          onPointerDown={(e) => {
            e.preventDefault();
            onCambiar(cambios);
          }}
        >
          Guardar los cambios
        </button>
      )}

      <div className="campo" style={{ marginTop: 18 }}>
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
