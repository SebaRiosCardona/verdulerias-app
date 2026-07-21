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
  const etiquetaBase = nombreTab === "hoy" ? "Pedidos de hoy" : "Historial de pedidos";
  tabBtn.textContent = lista.length > 0 ? `${etiquetaBase} (${lista.length})` : etiquetaBase;

  if (lista.length === 0) {
    contenedor.innerHTML = `<p style="color:var(--gris);text-align:center;">No hay pedidos.</p>`;
    return;
  }

  contenedor.innerHTML = lista.map((p) => {
    const fecha = new Date(p.fecha);
    const fechaTexto = fecha.toLocaleDateString("es-AR") + " " + fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
    const itemsHtml = (p.items || []).map((it) => `<li>${it.nombre} — ${formatoCantidad(it)}</li>`).join("");
    return `
      <div class="pedido-admin" data-id="${p.id}">
        <div style="display:flex;justify-content:space-between;">
          <strong>${p.clienteNombre}</strong>
          <span style="font-size:12px;color:var(--gris);">${fechaTexto}</span>
        </div>
        <ul class="lista-items-pedido">${itemsHtml}</ul>
        <div style="font-size:13px;">${formatoKg(p.pesoTotalKg)} · ${p.descuentoAplicado ? "10% desc. aplicado" : "sin descuento"}${MOMENTOS_TEXTO[p.momentoRetiro] ? ` · Retira por la ${MOMENTOS_TEXTO[p.momentoRetiro]}` : ""}</div>
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
function renderTabConfiguracion() {
  const inputTelefonoCfg = el("cfg-telefono");
  inputTelefonoCfg.value = tiendaInfo.telefonoContacto || "";
  el("btn-guardar-telefono").onclick = async () => {
    const telefonoContacto = inputTelefonoCfg.value.replace(/\D/g, "");
    await updateDoc(doc(db, "verdulerias", tiendaId), { telefonoContacto });
    tiendaInfo.telefonoContacto = telefonoContacto;
    alert("Teléfono de contacto guardado.");
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
  kg: { etiqueta: "Kilo", precioLabel: "Precio por kg", sufijoPrecio: "/ kg" },
  medio_kg: { etiqueta: "Medio kilo", precioLabel: "Precio por kg", sufijoPrecio: "/ kg" },
  "100g": { etiqueta: "100 gramos", precioLabel: "Precio por kg", sufijoPrecio: "/ kg" },
  unidad: { etiqueta: "Unidad", precioLabel: "Precio por unidad", sufijoPrecio: "/ unidad" },
};

function renderTabProductos() {
  const modalProducto = el("modal-producto");
  const inputBuscarProducto = el("input-buscar-producto");
  inputBuscarProducto.value = filtroTextoProducto;
  inputBuscarProducto.oninput = () => { filtroTextoProducto = inputBuscarProducto.value; renderListaProductosAdmin(); };

  el("np-unidad").onchange = () => {
    el("np-precio-label").textContent = UNIDADES_VENTA[el("np-unidad").value].precioLabel;
  };

  el("btn-abrir-modal-producto").onclick = () => {
    productoEnEdicion = null;
    el("modal-producto-titulo").textContent = "Nuevo producto";
    el("btn-agregar-producto").textContent = "Agregar producto";
    el("np-nombre").value = "";
    el("np-categoria").value = "verdura";
    el("np-unidad").value = "kg";
    el("np-precio-label").textContent = UNIDADES_VENTA.kg.precioLabel;
    el("np-precio").value = "";
    modalProducto.classList.remove("oculto");
  };

  el("modal-producto-cancelar").onclick = () => {
    modalProducto.classList.add("oculto");
  };

  el("btn-agregar-producto").onclick = async () => {
    const nombre = el("np-nombre").value.trim();
    const categoria = el("np-categoria").value;
    const unidadVenta = el("np-unidad").value;
    const precio = parseFloat(el("np-precio").value);
    if (!nombre || !precio || precio <= 0) {
      alert("Completá nombre y precio válido.");
      return;
    }

    if (productoEnEdicion) {
      await updateDoc(doc(db, "verdulerias", tiendaId, "productos", productoEnEdicion.id), {
        nombre, categoria, unidadVenta, precioPorKg: precio
      });
      productoEnEdicion.nombre = nombre;
      productoEnEdicion.categoria = categoria;
      productoEnEdicion.unidadVenta = unidadVenta;
      productoEnEdicion.precioPorKg = precio;
    } else {
      const ref = await addDoc(collection(db, "verdulerias", tiendaId, "productos"), {
        nombre, categoria, unidadVenta, precioPorKg: precio, activo: true
      });
      productosCache.push({ id: ref.id, nombre, categoria, unidadVenta, precioPorKg: precio, activo: true });
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
  el("np-categoria").value = producto.categoria;
  el("np-unidad").value = unidad;
  el("np-precio-label").textContent = UNIDADES_VENTA[unidad].precioLabel;
  el("np-precio").value = producto.precioPorKg;
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
        <div style="font-weight:600;">${p.nombre} <span style="font-size:11px;color:var(--gris);">(${p.categoria})</span></div>
        <div style="font-size:12px;color:var(--gris);">${unidad.precioLabel} · ${unidad.etiqueta}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <input type="number" min="0" step="10" value="${p.precioPorKg}" data-campo="precio" />
        <label class="switch">
          <input type="checkbox" data-campo="activo" ${p.activo !== false ? "checked" : ""} />
          <span class="slider"></span>
        </label>
        <button class="btn-editar-producto" data-accion="editar" title="Editar producto" aria-label="Editar producto">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
        </button>
        <button class="btn-eliminar-producto" data-accion="eliminar" title="Eliminar producto" aria-label="Eliminar producto">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
        </button>
      </div>
    </div>
  `;
  }).join("");

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

    row.querySelector('[data-accion="editar"]').addEventListener("click", () => {
      abrirModalEditarProducto(producto);
    });

    row.querySelector('[data-accion="eliminar"]').addEventListener("click", async () => {
      if (confirm(`¿Eliminar "${producto.nombre}" del catálogo?`)) {
        await deleteDoc(doc(db, "verdulerias", tiendaId, "productos", id));
        productosCache = productosCache.filter((p) => p.id !== id);
        renderListaProductosAdmin();
      }
    });
  });
}
