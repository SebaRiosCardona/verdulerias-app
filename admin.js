import { firebaseConfig, TIENDA_POR_DEFECTO } from "./firebase-config.js";
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
function formatoKg(valor) {
  return (Math.round(valor * 10) / 10).toFixed(1) + " kg";
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
let filtroPagado = "";
let filtroEntregado = "";
let filtroPagadoHoy = "";
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
}

// ---------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("activo"));
    btn.classList.add("activo");
    ["hoy", "pedidos", "productos"].forEach((t) => {
      el(`tab-${t}`).classList.toggle("oculto", t !== btn.dataset.tab);
    });
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
  const selectPagadoHoy = el("select-filtro-pagado-hoy");
  selectPagadoHoy.value = filtroPagadoHoy;
  selectPagadoHoy.onchange = () => { filtroPagadoHoy = selectPagadoHoy.value; renderTabHoy(); };

  const selectEntregadoHoy = el("select-filtro-entregado-hoy");
  selectEntregadoHoy.value = filtroEntregadoHoy;
  selectEntregadoHoy.onchange = () => { filtroEntregadoHoy = selectEntregadoHoy.value; renderTabHoy(); };

  el("btn-marcar-vistos-hoy").onclick = async () => {
    const deHoy = pedidosCache.filter((p) => esDeHoy(p.fecha));
    const noVistos = deHoy.filter((p) => !p.vistoPorAdmin);
    for (const p of noVistos) {
      await updateDoc(doc(db, "verdulerias", tiendaId, "pedidos", p.id), { vistoPorAdmin: true });
      p.vistoPorAdmin = true;
    }
    renderTodo();
  };

  const pedidosHoy = pedidosCache.filter((p) => esDeHoy(p.fecha));
  let lista = pedidosHoy;
  if (filtroPagadoHoy) lista = lista.filter((p) => (filtroPagadoHoy === "si") === !!p.pagado);
  if (filtroEntregadoHoy) lista = lista.filter((p) => (filtroEntregadoHoy === "si") === !!p.entregado);

  renderResumenSaldos("resumen-saldos-hoy", pedidosHoy);
  renderListaPedidosEn("lista-pedidos-hoy", lista, renderTodo, "hoy");
}

// ---------------------------------------------------------------
// Tab Pedidos (todos)
// ---------------------------------------------------------------
function renderTabPedidos() {
  const inputBuscarCliente = el("input-buscar-cliente");
  inputBuscarCliente.value = filtroTextoCliente;
  inputBuscarCliente.oninput = () => { filtroTextoCliente = inputBuscarCliente.value; renderTabPedidos(); };

  const selectPagado = el("select-filtro-pagado");
  selectPagado.value = filtroPagado;
  selectPagado.onchange = () => { filtroPagado = selectPagado.value; renderTabPedidos(); };

  const selectEntregado = el("select-filtro-entregado");
  selectEntregado.value = filtroEntregado;
  selectEntregado.onchange = () => { filtroEntregado = selectEntregado.value; renderTabPedidos(); };

  el("btn-marcar-vistos").onclick = async () => {
    const historial = pedidosCache.filter((p) => !esDeHoy(p.fecha));
    const noVistos = historial.filter((p) => !p.vistoPorAdmin);
    for (const p of noVistos) {
      await updateDoc(doc(db, "verdulerias", tiendaId, "pedidos", p.id), { vistoPorAdmin: true });
      p.vistoPorAdmin = true;
    }
    renderTodo();
  };

  let pedidosTexto = pedidosCache.filter((p) => !esDeHoy(p.fecha));
  if (filtroTextoCliente.trim()) {
    const texto = slugify(filtroTextoCliente);
    pedidosTexto = pedidosTexto.filter((p) => slugify(p.clienteNombre || "").includes(texto));
  }

  let lista = pedidosTexto;
  if (filtroPagado) lista = lista.filter((p) => (filtroPagado === "si") === !!p.pagado);
  if (filtroEntregado) lista = lista.filter((p) => (filtroEntregado === "si") === !!p.entregado);

  renderResumenSaldos("resumen-saldos", pedidosTexto);
  renderListaPedidosEn("lista-pedidos-admin", lista, renderTodo, "pedidos");
}

function renderTodo() {
  renderTabHoy();
  renderTabPedidos();
}

// ---------------------------------------------------------------
// Render genérico (compartido entre tabs Hoy y Todos)
// ---------------------------------------------------------------
function renderResumenSaldos(contenedorId, lista) {
  const saldos = {};
  lista.filter((p) => !p.pagado).forEach((p) => {
    saldos[p.clienteNombre] = (saldos[p.clienteNombre] || 0) + p.total;
  });
  const entradas = Object.entries(saldos);
  const resumen = el(contenedorId);
  if (entradas.length === 0) {
    resumen.className = "resumen-saldos sin-saldos";
    resumen.innerHTML = `<strong>🎉 Sin saldos pendientes</strong>`;
    return;
  }
  resumen.className = "resumen-saldos";
  resumen.innerHTML = `<strong>💸 Pedidos no abonados</strong>` +
    entradas.map(([nombre, monto]) => `<div class="fila-saldo"><span>${nombre}</span><span>${formatoMoneda(monto)}</span></div>`).join("");
}

function renderListaPedidosEn(contenedorId, lista, onCambio, nombreTab) {
  const contenedor = el(contenedorId);

  const nuevos = lista.filter((p) => !p.vistoPorAdmin).length;
  const tabBtn = document.querySelector(`[data-tab="${nombreTab}"]`);
  const etiquetaBase = nombreTab === "hoy" ? "Pedidos de hoy" : "Historial de pedidos";
  tabBtn.textContent = nuevos > 0 ? `${etiquetaBase} (${nuevos})` : etiquetaBase;

  if (lista.length === 0) {
    contenedor.innerHTML = `<p style="color:var(--gris);text-align:center;">No hay pedidos.</p>`;
    return;
  }

  contenedor.innerHTML = lista.map((p) => {
    const fecha = new Date(p.fecha);
    const fechaTexto = fecha.toLocaleDateString("es-AR") + " " + fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    const itemsHtml = (p.items || []).map((it) => `<li>${it.nombre} — ${formatoKg(it.kg)}</li>`).join("");
    return `
      <div class="pedido-admin ${!p.vistoPorAdmin ? "nuevo" : ""}" data-id="${p.id}">
        <div style="display:flex;justify-content:space-between;">
          <strong>${p.clienteNombre}${!p.vistoPorAdmin ? '<span class="etiqueta-nuevo">NUEVO</span>' : ""}</strong>
          <span style="font-size:12px;color:var(--gris);">${fechaTexto}</span>
        </div>
        <ul class="lista-items-pedido">${itemsHtml}</ul>
        <div style="font-size:13px;">${formatoKg(p.pesoTotalKg)} · ${p.descuentoAplicado ? "10% desc. aplicado" : "sin descuento"}</div>
        <div style="font-weight:700;margin-top:4px;">Total: ${formatoMoneda(p.total)}</div>
        <div class="fila-acciones">
          <button data-accion="pagado" class="${p.pagado ? "btn-toggle-si" : "btn-toggle-no"}">${p.pagado ? "Pagado" : "No pagado"}</button>
          <button data-accion="entregado" class="${p.entregado ? "btn-toggle-si" : "btn-toggle-no"}">${p.entregado ? "Entregado" : "No entregado"}</button>
          <button data-accion="borrar" class="btn-borrar">Borrar</button>
        </div>
      </div>
    `;
  }).join("");

  contenedor.querySelectorAll(".pedido-admin").forEach((card) => {
    const id = card.dataset.id;
    const pedido = pedidosCache.find((p) => p.id === id);

    card.addEventListener("click", async (ev) => {
      if (ev.target.closest("button")) return;
      if (!pedido.vistoPorAdmin) {
        await updateDoc(doc(db, "verdulerias", tiendaId, "pedidos", id), { vistoPorAdmin: true });
        pedido.vistoPorAdmin = true;
        onCambio();
      }
    });

    card.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const accion = btn.dataset.accion;
        if (accion === "pagado" || accion === "entregado") {
          const campo = accion;
          const nuevoValor = !pedido[campo];
          await updateDoc(doc(db, "verdulerias", tiendaId, "pedidos", id), { [campo]: nuevoValor });
          pedido[campo] = nuevoValor;
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
// Tab Productos
// ---------------------------------------------------------------
function renderTabProductos() {
  el("btn-agregar-producto").onclick = async () => {
    const nombre = el("np-nombre").value.trim();
    const categoria = el("np-categoria").value;
    const precio = parseFloat(el("np-precio").value);
    if (!nombre || !precio || precio <= 0) {
      alert("Completá nombre y precio válido.");
      return;
    }
    const ref = await addDoc(collection(db, "verdulerias", tiendaId, "productos"), {
      nombre, categoria, precioPorKg: precio, activo: true
    });
    productosCache.push({ id: ref.id, nombre, categoria, precioPorKg: precio, activo: true });
    productosCache.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    el("np-nombre").value = "";
    el("np-precio").value = "";
    renderListaProductosAdmin();
  };
  renderListaProductosAdmin();
}

function renderListaProductosAdmin() {
  const contenedor = el("lista-productos-admin");
  if (productosCache.length === 0) {
    contenedor.innerHTML = `<p style="color:var(--gris);text-align:center;">Todavía no cargaste productos.</p>`;
    return;
  }
  contenedor.innerHTML = productosCache.map((p) => `
    <div class="producto-admin" data-id="${p.id}">
      <div>
        <div style="font-weight:600;">${p.nombre} <span style="font-size:11px;color:var(--gris);">(${p.categoria})</span></div>
        <div style="font-size:12px;color:var(--gris);">Precio por kg</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <input type="number" min="0" step="10" value="${p.precioPorKg}" data-campo="precio" />
        <label class="switch">
          <input type="checkbox" data-campo="activo" ${p.activo !== false ? "checked" : ""} />
          <span class="slider"></span>
        </label>
      </div>
    </div>
  `).join("");

  contenedor.querySelectorAll(".producto-admin").forEach((row) => {
    const id = row.dataset.id;
    const producto = productosCache.find((p) => p.id === id);

    row.querySelector('[data-campo="precio"]').addEventListener("change", async (ev) => {
      const nuevoPrecio = parseFloat(ev.target.value);
      if (!nuevoPrecio || nuevoPrecio <= 0) return;
      await updateDoc(doc(db, "verdulerias", tiendaId, "productos", id), { precioPorKg: nuevoPrecio });
      producto.precioPorKg = nuevoPrecio;
    });

    row.querySelector('[data-campo="activo"]').addEventListener("change", async (ev) => {
      const activo = ev.target.checked;
      await updateDoc(doc(db, "verdulerias", tiendaId, "productos", id), { activo });
      producto.activo = activo;
    });
  });
}
