import { firebaseConfig, TIENDA_POR_DEFECTO } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  query, where, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------------------------------------------------------------
// Reglas de negocio del bolsón
// ---------------------------------------------------------------
const KG_MINIMO_DESCUENTO = 5;
const PORCENTAJE_DESCUENTO = 0.10;

// ---------------------------------------------------------------
// Setup Firebase
// ---------------------------------------------------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
const RANGO_DIACRITICOS = new RegExp("[̀-ͯ]", "g");

function slugify(texto) {
  return texto
    .toString()
    .normalize("NFD").replace(RANGO_DIACRITICOS, "") // saca acentos
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

const params = new URLSearchParams(window.location.search);
const tiendaId = params.get("tienda") || TIENDA_POR_DEFECTO;

const CLAVE_SESION = `verduleria_sesion_${tiendaId}`;

// ---------------------------------------------------------------
// Elementos del DOM
// ---------------------------------------------------------------
const el = (id) => document.getElementById(id);

const pantallaCarga = el("pantalla-carga");
const spinnerCarga = el("spinner-carga");
const errorCarga = el("error-carga");
const errorCargaTexto = el("error-carga-texto");
const btnRecargar = el("btn-recargar");

const vistaTiendaInvalida = el("vista-tienda-invalida");
const vistaLogin = el("vista-login");
const vistaCatalogo = el("vista-catalogo");
const vistaMisCompras = el("vista-mis-compras");

const formLogin = el("form-login");
const inputNombre = el("input-nombre");
const inputApellido = el("input-apellido");
const nombreTiendaEl = el("nombre-tienda");
const tituloCatalogo = el("titulo-catalogo");
const saludoCliente = el("saludo-cliente");
const saludoClienteCompras = el("saludo-cliente-compras");

const inputBuscar = el("input-buscar");
const listaProductos = el("lista-productos");

const barraCarrito = el("barra-carrito");
const barraDescuento = el("barra-descuento");
const barraKg = el("barra-kg");
const barraTotal = el("barra-total");
const btnConfirmar = el("btn-confirmar");

const btnVerCompras = el("btn-ver-compras");
const btnVolverCatalogo = el("btn-volver-catalogo");
const btnSalir = el("btn-salir");
const btnSalir2 = el("btn-salir-2");

const listaPedidos = el("lista-pedidos");

btnRecargar.addEventListener("click", () => window.location.reload());

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((e) => console.warn("SW error:", e));
  });
}

// ---------------------------------------------------------------
// Estado en memoria
// ---------------------------------------------------------------
let tiendaInfo = null;
let productos = [];       // catálogo completo (todos activos)
let carrito = {};         // { productoId: kg }
let cliente = null;       // { clienteId, nombre, apellido }
let ultimoPedidoId = null;

// ---------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------
init();

async function init() {
  if (!params.get("tienda") && !TIENDA_POR_DEFECTO) {
    mostrarTiendaInvalida();
    return;
  }
  try {
    await signInAnonymously(auth);
    onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      await cargarTienda();
    });
  } catch (e) {
    mostrarErrorCarga(e);
  }
}

async function cargarTienda() {
  try {
    const tiendaRef = doc(db, "verdulerias", tiendaId);
    const tiendaSnap = await getDoc(tiendaRef);

    if (!tiendaSnap.exists() || tiendaSnap.data().activa === false) {
      mostrarTiendaInvalida();
      return;
    }
    tiendaInfo = tiendaSnap.data();
    nombreTiendaEl.textContent = tiendaInfo.nombre || "Verdulería";
    tituloCatalogo.textContent = tiendaInfo.nombre || "Catálogo";
    document.title = (tiendaInfo.nombre || "Verdulería") + " — Pedidos";

    await cargarProductos();

    const sesionGuardada = localStorage.getItem(CLAVE_SESION);
    if (sesionGuardada) {
      cliente = JSON.parse(sesionGuardada);
      mostrarCatalogo();
    } else {
      mostrarLogin();
    }
    ocultarCarga();
  } catch (e) {
    mostrarErrorCarga(e);
  }
}

async function cargarProductos() {
  const productosRef = collection(db, "verdulerias", tiendaId, "productos");
  const snap = await getDocs(productosRef);
  productos = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.activo !== false)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

function mostrarErrorCarga(e) {
  console.error(e);
  spinnerCarga.classList.add("oculto");
  errorCarga.classList.remove("oculto");
  errorCargaTexto.textContent = "No pudimos cargar la tienda. Detalle: " + (e?.message || e);
}

function ocultarCarga() {
  pantallaCarga.classList.add("oculto");
}

function mostrarTiendaInvalida() {
  ocultarCarga();
  vistaTiendaInvalida.classList.remove("oculto");
}

// ---------------------------------------------------------------
// Login público (auto-registro por nombre + apellido)
// ---------------------------------------------------------------
function mostrarLogin() {
  vistaLogin.classList.remove("oculto");
  vistaCatalogo.classList.add("oculto");
  vistaMisCompras.classList.add("oculto");
}

formLogin.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const nombre = inputNombre.value.trim();
  const apellido = inputApellido.value.trim();
  if (!nombre || !apellido) return;

  const clienteId = slugify(`${nombre}-${apellido}`);
  const clienteRef = doc(db, "verdulerias", tiendaId, "clientes", clienteId);
  const clienteSnap = await getDoc(clienteRef);

  if (!clienteSnap.exists()) {
    await setDoc(clienteRef, {
      nombre,
      apellido,
      creadoEn: new Date().toISOString()
    });
  }

  cliente = { clienteId, nombre, apellido };
  localStorage.setItem(CLAVE_SESION, JSON.stringify(cliente));

  vistaLogin.classList.add("oculto");
  mostrarCatalogo();
});

btnSalir.addEventListener("click", cerrarSesion);
btnSalir2.addEventListener("click", cerrarSesion);

function cerrarSesion() {
  localStorage.removeItem(CLAVE_SESION);
  cliente = null;
  carrito = {};
  inputNombre.value = "";
  inputApellido.value = "";
  vistaCatalogo.classList.add("oculto");
  vistaMisCompras.classList.add("oculto");
  mostrarLogin();
}

// ---------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------
function mostrarCatalogo() {
  vistaCatalogo.classList.remove("oculto");
  vistaMisCompras.classList.add("oculto");
  saludoCliente.textContent = `Hola ${cliente.nombre}!`;
  renderProductos();
  actualizarBarraCarrito();
}

btnVerCompras.addEventListener("click", () => mostrarMisCompras());
btnVolverCatalogo.addEventListener("click", () => mostrarCatalogo());

inputBuscar.addEventListener("input", () => renderProductos());

function renderProductos() {
  const texto = slugify(inputBuscar.value || "");
  const filtrados = productos.filter((p) => slugify(p.nombre).includes(texto));

  if (filtrados.length === 0) {
    listaProductos.innerHTML = `<div class="sin-resultados">No encontramos productos con ese nombre.</div>`;
    return;
  }

  const grupos = { fruta: [], verdura: [] };
  filtrados.forEach((p) => {
    const cat = p.categoria === "fruta" ? "fruta" : "verdura";
    grupos[cat].push(p);
  });

  let html = "";
  if (grupos.fruta.length) {
    html += `<div class="categoria-titulo">🍎 Frutas</div>`;
    html += grupos.fruta.map(renderFilaProducto).join("");
  }
  if (grupos.verdura.length) {
    html += `<div class="categoria-titulo">🥕 Verduras</div>`;
    html += grupos.verdura.map(renderFilaProducto).join("");
  }
  listaProductos.innerHTML = html;

  // Listeners de +/-
  listaProductos.querySelectorAll("[data-accion]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const accion = btn.dataset.accion;
      const paso = 0.5;
      const actual = carrito[id] || 0;
      let nuevo = accion === "sumar" ? actual + paso : actual - paso;
      if (nuevo < 0) nuevo = 0;
      nuevo = Math.round(nuevo * 10) / 10;
      if (nuevo === 0) delete carrito[id];
      else carrito[id] = nuevo;
      renderProductos();
      actualizarBarraCarrito();
    });
  });
}

function renderFilaProducto(p) {
  const kg = carrito[p.id] || 0;
  return `
    <div class="producto">
      <div class="producto-info">
        <div class="producto-nombre">${p.emoji ? p.emoji + " " : ""}${p.nombre}</div>
        <div class="producto-precio">${formatoMoneda(p.precioPorKg)} / kg</div>
      </div>
      <div class="producto-cantidad">
        <button class="btn-qty" data-id="${p.id}" data-accion="restar" ${kg <= 0 ? "disabled" : ""}>−</button>
        <div class="qty-valor">${kg > 0 ? formatoKg(kg) : "—"}</div>
        <button class="btn-qty" data-id="${p.id}" data-accion="sumar">+</button>
      </div>
    </div>
  `;
}

function calcularCarrito() {
  const items = Object.entries(carrito).map(([productoId, kg]) => {
    const p = productos.find((x) => x.id === productoId);
    const subtotal = p ? p.precioPorKg * kg : 0;
    return { productoId, nombre: p?.nombre || "?", categoria: p?.categoria || "verdura", precioPorKg: p?.precioPorKg || 0, kg, subtotal };
  });
  const pesoTotalKg = items.reduce((acc, it) => acc + it.kg, 0);
  const subtotal = items.reduce((acc, it) => acc + it.subtotal, 0);
  const cumpleMinimo = pesoTotalKg >= KG_MINIMO_DESCUENTO;
  const descuentoMonto = cumpleMinimo ? subtotal * PORCENTAJE_DESCUENTO : 0;
  const total = subtotal - descuentoMonto;
  return { items, pesoTotalKg, subtotal, cumpleMinimo, descuentoMonto, total };
}

function actualizarBarraCarrito() {
  const { pesoTotalKg, total, cumpleMinimo } = calcularCarrito();

  if (cumpleMinimo) {
    barraDescuento.className = "barra-descuento lograda";
    barraDescuento.textContent = `¡10% de descuento aplicado por superar los ${KG_MINIMO_DESCUENTO} kg! 🎉`;
  } else {
    const faltan = KG_MINIMO_DESCUENTO - pesoTotalKg;
    barraDescuento.className = "barra-descuento falta";
    barraDescuento.textContent = `Te faltan ${formatoKg(faltan)} para el 10% de descuento`;
  }

  barraKg.textContent = formatoKg(pesoTotalKg);
  barraTotal.textContent = formatoMoneda(total);
  btnConfirmar.disabled = pesoTotalKg <= 0;
}

btnConfirmar.addEventListener("click", async () => {
  const resumen = calcularCarrito();
  if (resumen.pesoTotalKg <= 0) return;

  btnConfirmar.disabled = true;
  btnConfirmar.textContent = "Confirmando...";

  try {
    const pedidoRef = await addDoc(collection(db, "verdulerias", tiendaId, "pedidos"), {
      clienteId: cliente.clienteId,
      clienteNombre: `${cliente.nombre} ${cliente.apellido}`,
      items: resumen.items,
      pesoTotalKg: resumen.pesoTotalKg,
      subtotal: resumen.subtotal,
      descuentoAplicado: resumen.cumpleMinimo,
      descuentoMonto: resumen.descuentoMonto,
      total: resumen.total,
      pagado: false,
      metodoPago: null,
      entregado: false,
      vistoPorAdmin: false,
      fecha: new Date().toISOString()
    });

    ultimoPedidoId = pedidoRef.id;
    carrito = {};
    mostrarConfirmacion();
  } catch (e) {
    alert("No pudimos confirmar el pedido: " + e.message);
  } finally {
    btnConfirmar.disabled = false;
    btnConfirmar.textContent = "Confirmar pedido";
  }
});

function mostrarConfirmacion() {
  const mensaje = document.createElement("div");
  mensaje.className = "mensaje-confirmacion";
  mensaje.textContent = "¡Pedido confirmado! 🛒";
  document.body.appendChild(mensaje);
  setTimeout(() => {
    mensaje.remove();
    mostrarMisCompras();
  }, 900);
}

// ---------------------------------------------------------------
// Mis Compras
// ---------------------------------------------------------------
async function mostrarMisCompras() {
  vistaCatalogo.classList.add("oculto");
  vistaMisCompras.classList.remove("oculto");
  saludoClienteCompras.textContent = `${cliente.nombre} ${cliente.apellido}`;
  actualizarBarraCarrito();

  listaPedidos.innerHTML = `<div class="sin-resultados">Cargando tus compras...</div>`;

  const pedidosRef = collection(db, "verdulerias", tiendaId, "pedidos");
  const q = query(pedidosRef, where("clienteId", "==", cliente.clienteId));
  const snap = await getDocs(q);

  let pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  pedidos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  if (pedidos.length === 0) {
    listaPedidos.innerHTML = `<div class="sin-resultados">Todavía no hiciste ningún pedido.</div>`;
    return;
  }

  listaPedidos.innerHTML = pedidos.map(renderPedido).join("");
}

function renderPedido(p) {
  const fecha = new Date(p.fecha);
  const fechaTexto = fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  const itemsHtml = (p.items || []).map((it) => `
    <div class="pedido-item-fila">
      <span>${it.nombre} — ${formatoKg(it.kg)}</span>
      <span>${formatoMoneda(it.subtotal)}</span>
    </div>
  `).join("");

  const esReciente = p.id === ultimoPedidoId;

  return `
    <div class="pedido-card ${esReciente ? "recien-confirmado" : ""}">
      <div class="pedido-header">
        <div class="pedido-fecha">${fechaTexto} · ${formatoKg(p.pesoTotalKg)}</div>
        <div class="badges">
          <span class="badge ${p.pagado ? "pagado" : "no-pagado"}">${p.pagado ? "PAGADO" : "NO PAGADO"}</span>
          <span class="badge ${p.entregado ? "entregado" : "no-entregado"}">${p.entregado ? "ENTREGADO" : "NO ENTREGADO"}</span>
        </div>
      </div>
      <div class="pedido-items">${itemsHtml}</div>
      <div class="pedido-totales">
        <div class="fila-total"><span>Subtotal</span><span>${formatoMoneda(p.subtotal)}</span></div>
        ${p.descuentoAplicado ? `<div class="fila-total ahorro"><span>Ahorraste (10%)</span><span>-${formatoMoneda(p.descuentoMonto)}</span></div>` : ""}
        <div class="fila-total a-pagar"><span>Total a pagar</span><span>${formatoMoneda(p.total)}</span></div>
      </div>
      <div class="nota-pago">Podés abonar por transferencia o en efectivo al momento de retirar tu bolsón.</div>
    </div>
  `;
}
