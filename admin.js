import { firebaseConfig, TIENDA_POR_DEFECTO, MAPA_CENTRO_DEFECTO, MAPA_ZOOM_DEFECTO } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, updateDoc, addDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const params = new URLSearchParams(window.location.search);
const tiendaId = params.get("tienda") || TIENDA_POR_DEFECTO;
const CLAVE_SESION_ADMIN = `verduleria_admin_${tiendaId}`;

const el = (id) => document.getElementById(id);

const MOMENTOS_TEXTO = { manana: "Mañana", tarde: "Tarde", noche: "Noche" };

const RANGO_DIACRITICOS = new RegExp("[̀-ͯ]", "g");

function slugify(texto) {
  return texto
    .toString()
    .normalize("NFD").replace(RANGO_DIACRITICOS, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function formatoMoneda(valor) {
  return "$" + Math.round(valor).toLocaleString("es-AR");
}
function formatoMiles(valor) {
  return Math.round(valor).toLocaleString("es-AR");
}
function parsearMiles(texto) {
  return parseFloat(texto.replace(/\./g, "").replace(",", "."));
}
function activarFormatoMiles(input, alConfirmar) {
  input.addEventListener("input", () => {
    const cursorDesdeElFinal = input.value.length - input.selectionStart;
    const valor = parsearMiles(input.value);
    input.value = valor > 0 ? formatoMiles(valor) : input.value.replace(/[^\d]/g, "");
    const nuevaPosicion = Math.max(0, input.value.length - cursorDesdeElFinal);
    input.setSelectionRange(nuevaPosicion, nuevaPosicion);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    if (alConfirmar) {
      alConfirmar();
    } else {
      input.blur();
      input.dispatchEvent(new Event("change"));
    }
  });
}
function formatoKg(valor) {
  return (Math.round(valor * 10) / 10).toFixed(1) + " kg";
}
function formatoCantidad(item) {
  if ((item.unidadVenta || "kg") === "unidad") return `${Math.round(item.kg)} u.`;
  return formatoKg(item.kg);
}

const pantallaCarga = el("pantalla-carga");
const vistaLoginAdmin = el("vista-login-admin");
const vistaPanel = el("vista-panel");
const formLoginAdmin = el("form-login-admin");
const inputPasswordAdmin = el("input-password-admin");
const errorLoginAdmin = el("error-login-admin");
const nombreTiendaAdmin = el("nombre-tienda-admin");
const subtituloAdmin = el("subtitulo-admin");
const btnSalirAdmin = el("btn-salir-admin");

const EYE_OPEN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

const btnTogglePasswordAdmin = el("toggle-password-admin");
btnTogglePasswordAdmin.innerHTML = EYE_CLOSED;
btnTogglePasswordAdmin.addEventListener("click", () => {
  if (inputPasswordAdmin.type === "password") {
    inputPasswordAdmin.type = "text";
    btnTogglePasswordAdmin.innerHTML = EYE_OPEN;
  } else {
    inputPasswordAdmin.type = "password";
    btnTogglePasswordAdmin.innerHTML = EYE_CLOSED;
  }
});

let tiendaInfo = null;
let productosCache = [];
let pedidosCache = [];
let filtroTextoCliente = "";
let filtroEntregado = "";
let filtroEntregadoHoy = "";

init();

async function init() {
  try {
    await signInAnonymously(auth);
    onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      await cargarTienda();
    });
  } catch (e) {
    alert("Error al conectar: " + e.message);
  }
}

async function cargarTienda() {
  const tiendaSnap = await getDoc(doc(db, "verdulerias", tiendaId));
  if (!tiendaSnap.exists()) {
    pantallaCarga.classList.add("oculto");
    document.body.innerHTML = `<div style="padding:40px;text-align:center;">No existe la verdulería "${tiendaId}". Revisá el link (?tienda=...).</div>`;
    return;
  }
  if (tiendaSnap.data().activa === false) {
    pantallaCarga.classList.add("oculto");
    document.body.innerHTML = `<div style="padding:40px;text-align:center;">Esta verdulería está desactivada. Contactá al súper admin para reactivarla.</div>`;
    return;
  }
  tiendaInfo = tiendaSnap.data();
  nombreTiendaAdmin.textContent = tiendaInfo.nombre || tiendaId;
  subtituloAdmin.textContent = tiendaInfo.nombre || tiendaId;
  document.title = "Admin — " + (tiendaInfo.nombre || tiendaId);

  pantallaCarga.classList.add("oculto");

  const sesion = sessionStorage.getItem(CLAVE_SESION_ADMIN);
  if (sesion === "ok") {
    mostrarPanel();
  } else {
    vistaLoginAdmin.classList.remove("oculto");
  }
}

formLoginAdmin.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const clave = inputPasswordAdmin.value;
  if (clave === tiendaInfo.adminPassword) {
    sessionStorage.setItem(CLAVE_SESION_ADMIN, "ok");
    vistaLoginAdmin.classList.add("oculto");
    mostrarPanel();
  } else {
    errorLoginAdmin.textContent = "Contraseña incorrecta.";
    errorLoginAdmin.classList.remove("oculto");
  }
});

btnSalirAdmin.addEventListener("click", () => {
  sessionStorage.removeItem(CLAVE_SESION_ADMIN);
  location.reload();
});

async function mostrarPanel() {
  vistaPanel.classList.remove("oculto");
  await Promise.all([cargarProductos(), cargarPedidos()]);
  renderTodo();
  renderTabProductos();
  renderTabConfiguracion();
}

// ---------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("activo"));
    btn.classList.add("activo");
    ["hoy", "pedidos", "productos", "configuracion"].forEach((t) => {
      el(`tab-${t}`).classList.toggle("oculto", t !== btn.dataset.tab);
    });
    if (btn.dataset.tab === "configuracion" && mapaLocal) {
      setTimeout(() => mapaLocal.invalidateSize(), 0);
    }
  });
});

// ---------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------
async function cargarProductos() {
  const snap = await getDocs(collection(db, "verdulerias", tiendaId, "productos"));
  productosCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

async function cargarPedidos() {
  const snap = await getDocs(collection(db, "verdulerias", tiendaId, "pedidos"));
  pedidosCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

// ---------------------------------------------------------------
// Tab Hoy
// ---------------------------------------------------------------
function esDeHoy(fechaIso) {
  const fecha = new Date(fechaIso);
  const hoy = new Date();
  return fecha.toDateString() === hoy.toDateString();
}

function renderTabHoy() {
  const selectEntregadoHoy = el("select-filtro-entregado-hoy");
  selectEntregadoHoy.value = filtroEntregadoHoy;
  selectEntregadoHoy.onchange = () => { filtroEntregadoHoy = selectEntregadoHoy.value; renderTabHoy(); };

  let lista = pedidosCache.filter((p) => esDeHoy(p.fecha));
  if (filtroEntregadoHoy) lista = lista.filter((p) => (filtroEntregadoHoy === "si") === !!p.entregado);

  renderListaPedidosEn("lista-pedidos-hoy", lista, renderTodo, "hoy");
}

// ---------------------------------------------------------------
// Tab Pedidos (todos)
// ---------------------------------------------------------------
function renderTabPedidos() {
  const inputBuscarCliente = el("input-buscar-cliente");
  inputBuscarCliente.value = filtroTextoCliente;
  inputBuscarCliente.oninput = () => { filtroTextoCliente = inputBuscarCliente.value; renderTabPedidos(); };

  const selectEntregado = el("select-filtro-entregado");
  selectEntregado.value = filtroEntregado;
  selectEntregado.onchange = () => { filtroEntregado = selectEntregado.value; renderTabPedidos(); };

  let lista = pedidosCache.filter((p) => !esDeHoy(p.fecha));
  if (filtroTextoCliente.trim()) {
    const texto = slugify(filtroTextoCliente);
    lista = lista.filter((p) => slugify(p.clienteNombre || "").includes(texto));
  }
  if (filtroEntregado) lista = lista.filter((p) => (filtroEntregado === "si") === !!p.entregado);

  renderListaPedidosEn("lista-pedidos-admin", lista, renderTodo, "pedidos");
}

function renderTodo() {
  renderTabHoy();
  renderTabPedidos();
}

function renderListaPedidosEn(contenedorId, lista, onCambio, nombreTab) {
  const contenedor = el(contenedorId);

  const tabBtn = document.querySelector(`[data-tab="${nombreTab}"]`);
  tabBtn.querySelector(".tab-contador").textContent = lista.length > 0 ? `(${lista.length})` : "";

  if (lista.length === 0) {
    contenedor.innerHTML = `<p style="color:var(--gris);text-align:center;">No hay pedidos.</p>`;
    return;
  }

  contenedor.innerHTML = lista.map((p) => {
    const fecha = new Date(p.fecha);
    const fechaTexto = fecha.toLocaleDateString("es-AR") + " " + fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
    const itemsHtml = (p.items || []).map((it) => `<li>${it.nombre} — ${formatoCantidad(it)}</li>`).join("");
    const d = p.direccionEntrega;
    const linkUbicacion = p.ubicacionEntrega ? `<a href="https://maps.google.com/?q=${p.ubicacionEntrega.lat},${p.ubicacionEntrega.lng}" target="_blank">Ver ubicación</a>` : "";
    const entregaHtml = p.tipoEntrega === "envio"
      ? `<div style="font-size:13px;">🚚 Envío${p.distanciaKm ? " — " + p.distanciaKm.toFixed(1) + " km" : ""}${d ? `: ${d.direccion}${d.pisoDepto ? ", " + d.pisoDepto : ""} · ${d.nombre} ${d.apellido} · Tel: ${d.telefono}${d.notas ? " · " + d.notas : ""}` : ""}${linkUbicacion ? " · " + linkUbicacion : ""}</div>`
      : `<div style="font-size:13px;">🏠 Retiro en el local${MOMENTOS_TEXTO[p.momentoRetiro] ? ` · Retira por la ${MOMENTOS_TEXTO[p.momentoRetiro]}` : ""}</div>`;
    return `
      <div class="pedido-admin" data-id="${p.id}">
        <div style="display:flex;justify-content:space-between;">
          <strong>${p.clienteNombre}</strong>
          <span style="font-size:12px;color:var(--gris);">${fechaTexto}</span>
        </div>
        <ul class="lista-items-pedido">${itemsHtml}</ul>
        <div style="font-size:13px;">${formatoKg(p.pesoTotalKg)} · ${p.descuentoAplicado ? "10% desc. aplicado" : "sin descuento"}</div>
        ${entregaHtml}
        <div style="font-weight:700;margin-top:4px;">Total: ${formatoMoneda(p.total)}</div>
        <div class="fila-acciones">
          <button data-accion="entregado" class="${p.entregado ? "btn-toggle-si" : "btn-toggle-no"}">${p.entregado ? "Entregado" : "No entregado"}</button>
          <button data-accion="borrar" class="btn-borrar">Borrar</button>
        </div>
      </div>
    `;
  }).join("");

  contenedor.querySelectorAll(".pedido-admin").forEach((card) => {
    const id = card.dataset.id;
    const pedido = pedidosCache.find((p) => p.id === id);

    card.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const accion = btn.dataset.accion;
        if (accion === "entregado") {
          const nuevoValor = !pedido.entregado;
          await updateDoc(doc(db, "verdulerias", tiendaId, "pedidos", id), { entregado: nuevoValor, pagado: nuevoValor });
          pedido.entregado = nuevoValor;
          pedido.pagado = nuevoValor;
          onCambio();
        } else if (accion === "borrar") {
          if (confirm(`¿Borrar el pedido de ${pedido.clienteNombre}?`)) {
            await deleteDoc(doc(db, "verdulerias", tiendaId, "pedidos", id));
            pedidosCache = pedidosCache.filter((p) => p.id !== id);
            onCambio();
          }
        }
      });
    });
  });
}

// ---------------------------------------------------------------
// Tab Configuración
// ---------------------------------------------------------------
let ubicacionLocalSeleccionada = null;
let mapaLocal = null;
let markerLocal = null;

function ubicarPinLocal(latlng, zoom) {
  ubicacionLocalSeleccionada = { lat: latlng.lat, lng: latlng.lng };
  if (markerLocal) {
    markerLocal.setLatLng(latlng);
  } else {
    markerLocal = L.marker(latlng).addTo(mapaLocal);
  }
  if (zoom) {
    mapaLocal.setView(latlng, zoom);
  }
}

async function buscarDireccionInversaLocal(latlng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}`;
    const res = await fetch(url);
    const resultado = await res.json();
    const direccion = resultado?.address;
    if (!direccion) return;
    const calle = [direccion.road, direccion.house_number].filter(Boolean).join(" ");
    if (calle) {
      el("local-direccion").value = calle;
    }
  } catch (e) {
    // si falla, se puede seguir escribiendo la dirección a mano
  }
}

async function buscarDireccionEnMapaLocal() {
  const direccion = el("local-direccion").value.trim();
  const elBuscando = el("local-direccion-buscando");
  const elNoEncontrada = el("local-direccion-no-encontrada");
  elNoEncontrada.classList.add("oculto");
  if (!direccion || !mapaLocal) return;

  const centro = ubicacionLocalSeleccionada || MAPA_CENTRO_DEFECTO;
  elBuscando.classList.remove("oculto");
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&viewbox=${centro.lng - 0.3},${centro.lat + 0.3},${centro.lng + 0.3},${centro.lat - 0.3}&bounded=0&q=${encodeURIComponent(direccion)}`;
    const res = await fetch(url);
    const resultados = await res.json();
    elBuscando.classList.add("oculto");
    if (!resultados.length) {
      elNoEncontrada.classList.remove("oculto");
      return;
    }
    const { lat, lon } = resultados[0];
    ubicarPinLocal({ lat: parseFloat(lat), lng: parseFloat(lon) }, 16);
  } catch (e) {
    elBuscando.classList.add("oculto");
    elNoEncontrada.classList.remove("oculto");
  }
}

function inicializarMapaLocal() {
  if (mapaLocal) return;

  ubicacionLocalSeleccionada = tiendaInfo.ubicacion || null;

  const centro = ubicacionLocalSeleccionada || MAPA_CENTRO_DEFECTO;
  const zoom = ubicacionLocalSeleccionada ? 15 : MAPA_ZOOM_DEFECTO;

  mapaLocal = L.map("mapa-local").setView([centro.lat, centro.lng], zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
  }).addTo(mapaLocal);

  if (ubicacionLocalSeleccionada) {
    markerLocal = L.marker([ubicacionLocalSeleccionada.lat, ubicacionLocalSeleccionada.lng]).addTo(mapaLocal);
  }

  mapaLocal.on("click", (ev) => {
    ubicarPinLocal(ev.latlng);
    buscarDireccionInversaLocal(ev.latlng);
  });

  el("btn-buscar-direccion-local").addEventListener("click", buscarDireccionEnMapaLocal);

  setTimeout(() => mapaLocal.invalidateSize(), 0);
}

function renderTabConfiguracion() {
  const inputTelefonoCfg = el("cfg-telefono");
  inputTelefonoCfg.value = tiendaInfo.telefonoContacto || "";
  el("btn-guardar-telefono").onclick = async () => {
    const telefonoContacto = inputTelefonoCfg.value.replace(/\D/g, "");
    await updateDoc(doc(db, "verdulerias", tiendaId), { telefonoContacto });
    tiendaInfo.telefonoContacto = telefonoContacto;
    alert("Teléfono de contacto guardado.");
  };

  inicializarMapaLocal();

  const inputEnvioBase = el("cfg-envio-base");
  const inputEnvioPorKm = el("cfg-envio-por-km");
  inputEnvioBase.value = tiendaInfo.envioBase ? formatoMiles(tiendaInfo.envioBase) : "";
  inputEnvioPorKm.value = tiendaInfo.envioPorKm ? formatoMiles(tiendaInfo.envioPorKm) : "";
  activarFormatoMiles(inputEnvioBase);
  activarFormatoMiles(inputEnvioPorKm);

  el("btn-guardar-envio").onclick = async () => {
    if (!ubicacionLocalSeleccionada) {
      alert("Marcá la ubicación de tu local en el mapa.");
      return;
    }
    const envioBase = parsearMiles(inputEnvioBase.value) || 0;
    const envioPorKm = parsearMiles(inputEnvioPorKm.value) || 0;
    await updateDoc(doc(db, "verdulerias", tiendaId), {
      ubicacion: ubicacionLocalSeleccionada,
      envioBase,
      envioPorKm,
    });
    tiendaInfo.ubicacion = ubicacionLocalSeleccionada;
    tiendaInfo.envioBase = envioBase;
    tiendaInfo.envioPorKm = envioPorKm;
    alert("Datos de envío guardados.");
  };

  const inputPasswordActual = el("cfg-password-actual");
  const inputPasswordNueva = el("cfg-password-nueva");
  const inputPasswordNuevaConfirmar = el("cfg-password-nueva-confirmar");
  const passwordError = el("cfg-password-error");

  el("btn-cambiar-password").onclick = async () => {
    passwordError.classList.add("oculto");

    const actual = inputPasswordActual.value;
    const nueva = inputPasswordNueva.value;
    const confirmar = inputPasswordNuevaConfirmar.value;

    if (actual !== tiendaInfo.adminPassword) {
      passwordError.textContent = "La contraseña actual no es correcta.";
      passwordError.classList.remove("oculto");
      return;
    }
    if (!nueva) {
      passwordError.textContent = "Ingresá la nueva contraseña.";
      passwordError.classList.remove("oculto");
      return;
    }
    if (nueva !== confirmar) {
      passwordError.textContent = "Las contraseñas nuevas no coinciden.";
      passwordError.classList.remove("oculto");
      return;
    }

    await updateDoc(doc(db, "verdulerias", tiendaId), { adminPassword: nueva });
    tiendaInfo.adminPassword = nueva;
    inputPasswordActual.value = "";
    inputPasswordNueva.value = "";
    inputPasswordNuevaConfirmar.value = "";
    alert("Contraseña actualizada con éxito.");
  };
}

// ---------------------------------------------------------------
// Tab Productos
// ---------------------------------------------------------------
let filtroTextoProducto = "";
let productoEnEdicion = null;

const UNIDADES_VENTA = {
  kg: { etiqueta: "Kilo", etiquetaCorta: "kg", precioLabel: "Precio por kg", sufijoPrecio: "/ kg", paso: 0.5 },
  medio_kg: { etiqueta: "Medio kilo", etiquetaCorta: "kg", precioLabel: "Precio por kg", sufijoPrecio: "/ kg", paso: 0.5 },
  "100g": { etiqueta: "100 gramos", etiquetaCorta: "100g", precioLabel: "Precio por kg", sufijoPrecio: "/ kg", paso: 0.1 },
  unidad: { etiqueta: "Unidad", etiquetaCorta: "u", precioLabel: "Precio por unidad", sufijoPrecio: "/ unidad", paso: 1 },
};

function esCategoriaBolson(categoria) {
  return categoria === "bolson_verduras" || categoria === "bolson_frutas" || categoria === "bolson_mixto";
}

function formatoCantidadItem(producto, cantidad) {
  if ((producto?.unidadVenta || "kg") === "unidad") {
    const n = Math.round(cantidad);
    return `${n} ${n === 1 ? "unidad" : "unidades"}`;
  }
  const kg = Math.round(cantidad * 10) / 10;
  return `${kg % 1 === 0 ? kg.toFixed(0) : kg.toFixed(1)} kg`;
}

let filasContenidoBolson = [];

function productosDisponiblesParaBolson() {
  const categoriaBolson = el("np-categoria").value;
  if (categoriaBolson === "bolson_frutas") return productosCache.filter((p) => p.categoria === "fruta");
  if (categoriaBolson === "bolson_verduras") return productosCache.filter((p) => p.categoria === "verdura");
  return productosCache.filter((p) => !esCategoriaBolson(p.categoria));
}

function renderFilasContenidoBolson() {
  const contenedor = el("np-contenido-filas");
  const disponibles = productosDisponiblesParaBolson();

  if (filasContenidoBolson.length === 0) {
    contenedor.innerHTML = `<p style="color:var(--gris);font-size:12.5px;margin:0 0 8px;">Todavía no agregaste ningún item.</p>`;
    return;
  }

  contenedor.innerHTML = filasContenidoBolson.map((fila, index) => {
    const productoFila = disponibles.find((p) => p.id === fila.productoId);
    const unidadFila = UNIDADES_VENTA[productoFila?.unidadVenta || "kg"];
    return `
    <div class="fila-item-bolson" data-index="${index}">
      <select data-campo="producto">
        <option value="">Elegir producto...</option>
        ${disponibles.map((p) => `<option value="${p.id}" ${fila.productoId === p.id ? "selected" : ""}>${p.nombre}</option>`).join("")}
      </select>
      <div class="cantidad-item-bolson">
        <button type="button" class="btn-qty-bolson" data-accion="restar-item" ${fila.cantidad > 0 ? "" : "disabled"}>−</button>
        <span class="valor-qty-bolson">${fila.cantidad || 0}</span>
        <button type="button" class="btn-qty-bolson" data-accion="sumar-item" ${fila.productoId ? "" : "disabled"}>+</button>
      </div>
      <span class="unidad-item-bolson">${fila.productoId ? unidadFila.etiquetaCorta : ""}</span>
      <button type="button" class="btn-quitar-item-bolson" data-accion="quitar-item" title="Quitar item">×</button>
    </div>
  `;
  }).join("");

  contenedor.querySelectorAll(".fila-item-bolson").forEach((filaEl) => {
    const index = parseInt(filaEl.dataset.index);

    filaEl.querySelector('[data-campo="producto"]').addEventListener("change", (ev) => {
      filasContenidoBolson[index].productoId = ev.target.value;
      filasContenidoBolson[index].cantidad = 0;
      renderFilasContenidoBolson();
    });

    const productoFila = disponibles.find((p) => p.id === filasContenidoBolson[index].productoId);
    const paso = UNIDADES_VENTA[productoFila?.unidadVenta || "kg"].paso;

    filaEl.querySelector('[data-accion="sumar-item"]').addEventListener("click", () => {
      const actual = filasContenidoBolson[index].cantidad || 0;
      filasContenidoBolson[index].cantidad = Math.round((actual + paso) * 100) / 100;
      renderFilasContenidoBolson();
    });

    filaEl.querySelector('[data-accion="restar-item"]').addEventListener("click", () => {
      const actual = filasContenidoBolson[index].cantidad || 0;
      filasContenidoBolson[index].cantidad = Math.max(0, Math.round((actual - paso) * 100) / 100);
      renderFilasContenidoBolson();
    });

    filaEl.querySelector('[data-accion="quitar-item"]').addEventListener("click", () => {
      filasContenidoBolson.splice(index, 1);
      renderFilasContenidoBolson();
    });
  });
}

function contenidoBolsonATexto() {
  const disponibles = productosDisponiblesParaBolson();
  return filasContenidoBolson
    .filter((fila) => fila.productoId && fila.cantidad > 0)
    .map((fila) => {
      const producto = disponibles.find((p) => p.id === fila.productoId);
      if (!producto) return null;
      return `${formatoCantidadItem(producto, fila.cantidad)} ${producto.nombre}`;
    })
    .filter(Boolean)
    .join(", ");
}

function renderTabProductos() {
  const modalProducto = el("modal-producto");
  const inputBuscarProducto = el("input-buscar-producto");
  inputBuscarProducto.value = filtroTextoProducto;
  inputBuscarProducto.oninput = () => { filtroTextoProducto = inputBuscarProducto.value; renderListaProductosAdmin(); };

  activarFormatoMiles(el("np-precio"), () => el("btn-agregar-producto").click());

  el("np-unidad").onchange = () => {
    el("np-precio-label").textContent = UNIDADES_VENTA[el("np-unidad").value].precioLabel;
  };

  el("np-categoria").onchange = () => {
    const selectCategoria = el("np-categoria");
    const esBolson = esCategoriaBolson(selectCategoria.value);

    el("np-precio").value = "";
    filasContenidoBolson = [];
    el("np-contenido-wrap").classList.toggle("oculto", !esBolson);

    if (esBolson) {
      el("np-unidad").value = "unidad";
      el("np-precio-label").textContent = UNIDADES_VENTA.unidad.precioLabel;
      el("np-nombre").value = selectCategoria.selectedOptions[0].textContent;
      renderFilasContenidoBolson();
    } else {
      el("np-unidad").value = "kg";
      el("np-precio-label").textContent = UNIDADES_VENTA.kg.precioLabel;
      el("np-nombre").value = "";
      el("np-nombre").placeholder = selectCategoria.value === "fruta" ? "Ej: Banana" : selectCategoria.value === "almacen" ? "Ej: Avena" : selectCategoria.value === "condimento" ? "Ej: Orégano" : "Ej: Zanahoria";
    }
    el("np-unidad").disabled = esBolson;
    el("np-nombre").disabled = esBolson;
  };

  el("btn-agregar-item-bolson").onclick = () => {
    filasContenidoBolson.push({ productoId: "", cantidad: 0 });
    renderFilasContenidoBolson();
  };

  el("btn-abrir-modal-producto").onclick = () => {
    productoEnEdicion = null;
    el("modal-producto-titulo").textContent = "Nuevo producto";
    el("btn-agregar-producto").textContent = "Agregar producto";
    el("np-nombre").value = "";
    el("np-nombre").disabled = false;
    el("np-categoria").value = "verdura";
    filasContenidoBolson = [];
    el("np-contenido-wrap").classList.add("oculto");
    el("np-unidad").value = "kg";
    el("np-unidad").disabled = false;
    el("np-precio-label").textContent = UNIDADES_VENTA.kg.precioLabel;
    el("np-precio").value = "";
    el("btn-eliminar-producto-modal").classList.add("oculto");
    modalProducto.classList.remove("oculto");
  };

  el("modal-producto-cancelar").onclick = () => {
    modalProducto.classList.add("oculto");
  };

  el("btn-eliminar-producto-modal").onclick = () => {
    if (productoEnEdicion) eliminarProducto(productoEnEdicion);
  };

  el("btn-agregar-producto").onclick = async () => {
    const nombre = el("np-nombre").value.trim();
    const categoria = el("np-categoria").value;
    const esBolson = esCategoriaBolson(categoria);
    const contenido = esBolson ? contenidoBolsonATexto() : "";
    const contenidoItems = esBolson ? filasContenidoBolson.filter((f) => f.productoId && f.cantidad > 0) : [];
    const unidadVenta = el("np-unidad").value;
    const precio = parsearMiles(el("np-precio").value);
    if (!nombre || !precio || precio <= 0) {
      alert("Completá nombre y precio válido.");
      return;
    }
    if (esBolson && contenidoItems.length === 0) {
      alert("Agregá al menos un item al bolsón.");
      return;
    }

    if (productoEnEdicion) {
      await updateDoc(doc(db, "verdulerias", tiendaId, "productos", productoEnEdicion.id), {
        nombre, categoria, contenido, contenidoItems, unidadVenta, precioPorKg: precio
      });
      productoEnEdicion.nombre = nombre;
      productoEnEdicion.categoria = categoria;
      productoEnEdicion.contenido = contenido;
      productoEnEdicion.contenidoItems = contenidoItems;
      productoEnEdicion.unidadVenta = unidadVenta;
      productoEnEdicion.precioPorKg = precio;
    } else {
      const ref = await addDoc(collection(db, "verdulerias", tiendaId, "productos"), {
        nombre, categoria, contenido, contenidoItems, unidadVenta, precioPorKg: precio, activo: true
      });
      productosCache.push({ id: ref.id, nombre, categoria, contenido, contenidoItems, unidadVenta, precioPorKg: precio, activo: true });
    }
    productosCache.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    modalProducto.classList.add("oculto");
    renderListaProductosAdmin();
  };

  renderListaProductosAdmin();
}

function abrirModalEditarProducto(producto) {
  productoEnEdicion = producto;
  const unidad = producto.unidadVenta || "kg";
  el("modal-producto-titulo").textContent = "Editar producto";
  el("btn-agregar-producto").textContent = "Guardar cambios";
  el("np-nombre").value = producto.nombre;
  el("np-nombre").disabled = esCategoriaBolson(producto.categoria);
  el("np-categoria").value = producto.categoria;
  filasContenidoBolson = (producto.contenidoItems || []).map((f) => ({ ...f }));
  el("np-contenido-wrap").classList.toggle("oculto", !esCategoriaBolson(producto.categoria));
  if (esCategoriaBolson(producto.categoria)) renderFilasContenidoBolson();
  el("np-unidad").value = unidad;
  el("np-unidad").disabled = esCategoriaBolson(producto.categoria);
  el("np-precio-label").textContent = UNIDADES_VENTA[unidad].precioLabel;
  el("np-precio").value = formatoMiles(producto.precioPorKg);
  el("btn-eliminar-producto-modal").classList.remove("oculto");
  el("modal-producto").classList.remove("oculto");
}

function renderListaProductosAdmin() {
  const contenedor = el("lista-productos-admin");

  let lista = productosCache;
  if (filtroTextoProducto.trim()) {
    const texto = slugify(filtroTextoProducto);
    lista = lista.filter((p) => slugify(p.nombre).includes(texto));
  }

  if (lista.length === 0) {
    contenedor.innerHTML = `<p style="color:var(--gris);text-align:center;">${productosCache.length === 0 ? "Todavía no cargaste productos." : "No encontramos productos con ese nombre."}</p>`;
    return;
  }
  contenedor.innerHTML = lista.map((p) => {
    const unidad = UNIDADES_VENTA[p.unidadVenta || "kg"];
    return `
    <div class="producto-admin" data-id="${p.id}">
      <div>
        <div style="font-weight:600;">${p.nombre}</div>
        <div style="font-size:12px;color:var(--gris);">${(p.unidadVenta || "kg") === "unidad" ? unidad.precioLabel : `${unidad.precioLabel} · ${unidad.etiqueta}`}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="campo-precio">
          <input type="text" inputmode="numeric" value="${formatoMiles(p.precioPorKg)}" data-campo="precio" />
        </div>
        <label class="switch">
          <input type="checkbox" data-campo="activo" ${p.activo !== false ? "checked" : ""} />
          <span class="slider"></span>
        </label>
        <button class="btn-editar-producto" data-accion="editar" title="Editar producto" aria-label="Editar producto">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
        </button>
      </div>
    </div>
  `;
  }).join("");

  contenedor.querySelectorAll(".producto-admin").forEach((row) => {
    const id = row.dataset.id;
    const producto = productosCache.find((p) => p.id === id);

    const inputPrecio = row.querySelector('[data-campo="precio"]');
    activarFormatoMiles(inputPrecio);
    inputPrecio.addEventListener("change", async (ev) => {
      const nuevoPrecio = parsearMiles(ev.target.value);
      if (!nuevoPrecio || nuevoPrecio <= 0) return;
      await updateDoc(doc(db, "verdulerias", tiendaId, "productos", id), { precioPorKg: nuevoPrecio });
      producto.precioPorKg = nuevoPrecio;
    });

    row.querySelector('[data-campo="activo"]').addEventListener("change", async (ev) => {
      const activo = ev.target.checked;
      await updateDoc(doc(db, "verdulerias", tiendaId, "productos", id), { activo });
      producto.activo = activo;
    });

    row.querySelector('[data-accion="editar"]').addEventListener("click", () => {
      abrirModalEditarProducto(producto);
    });
  });
}

async function eliminarProducto(producto) {
  if (!confirm(`¿Eliminar "${producto.nombre}" del catálogo?`)) return;
  await deleteDoc(doc(db, "verdulerias", tiendaId, "productos", producto.id));
  productosCache = productosCache.filter((p) => p.id !== producto.id);
  el("modal-producto").classList.add("oculto");
  renderListaProductosAdmin();
}
