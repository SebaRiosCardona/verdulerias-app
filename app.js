import { firebaseConfig, TIENDA_POR_DEFECTO, MAPA_CENTRO_DEFECTO, MAPA_ZOOM_DEFECTO } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  query, where
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

// ---------------------------------------------------------------
// Unidades de venta
// ---------------------------------------------------------------
function formatoGramos(kg) {
  return `${Math.round(kg * 1000)}g`;
}

const UNIDADES_VENTA = {
  kg: { paso: 0.5, formato: (c) => formatoKg(c), kgPorUnidad: 1 },
  medio_kg: { paso: 0.5, formato: (c) => formatoKg(c), kgPorUnidad: 1 },
  "100g": { paso: 0.1, formato: (c) => c < 1 ? formatoGramos(c) : formatoKg(c), kgPorUnidad: 1 },
  unidad: { paso: 1, formato: (c) => `${Math.round(c)} u.`, kgPorUnidad: 0.5 },
};

function unidadDe(producto) {
  return UNIDADES_VENTA[producto?.unidadVenta || "kg"];
}

function pasoDe(producto) {
  return unidadDe(producto).paso;
}

function formatoCantidad(producto, cantidad) {
  return unidadDe(producto).formato(cantidad);
}

function subtotalDe(producto, cantidad) {
  return (producto?.precioPorKg || 0) * cantidad;
}

function kgEquivalente(producto, cantidad) {
  return cantidad * unidadDe(producto).kgPorUnidad;
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

const barraDescuento = el("barra-descuento");
const barraKg = el("barra-kg");
const barraTotal = el("barra-total");
const btnConfirmar = el("btn-confirmar");

const btnVerCompras = el("btn-ver-compras");
const btnVolverCatalogo = el("btn-volver-catalogo");
const btnSalir = el("btn-salir");
const btnSalir2 = el("btn-salir-2");

const modalConfirmarPedido = el("modal-confirmar-pedido");
const modalConfirmarItems = el("modal-confirmar-items");
const modalConfirmarTotales = el("modal-confirmar-totales");
const modalConfirmarTotalesEnvio = el("modal-confirmar-totales-envio");
const modalConfirmarCancelar = el("modal-confirmar-cancelar");
const modalConfirmarEnviar = el("modal-confirmar-enviar");
const botonesMomento = document.querySelectorAll(".momento-opcion");
const botonesEntrega = document.querySelectorAll(".entrega-opcion");
const modalConfirmarMomentoWrap = el("modal-confirmar-momento-wrap");
const modalConfirmarDireccion = el("modal-confirmar-direccion");
const direccionSinUbicacionLocal = el("direccion-sin-ubicacion-local");

const MOMENTOS_TEXTO = { manana: "Mañana", tarde: "Tarde", noche: "Noche" };
let momentoSeleccionado = null;
let tipoEntregaSeleccionado = null;
let resumenActual = null;
let pinClienteActual = null;
let mapaCliente = null;
let markerCliente = null;

botonesMomento.forEach((btn) => {
  btn.addEventListener("click", () => {
    momentoSeleccionado = btn.dataset.momento;
    botonesMomento.forEach((b) => b.classList.toggle("activo", b === btn));
  });
});

botonesEntrega.forEach((btn) => {
  btn.addEventListener("click", () => {
    tipoEntregaSeleccionado = btn.dataset.entrega;
    botonesEntrega.forEach((b) => b.classList.toggle("activo", b === btn));

    if (tipoEntregaSeleccionado === "envio") {
      modalConfirmarMomentoWrap.classList.add("oculto");
      modalConfirmarDireccion.classList.remove("oculto");
      if (mapaCliente) {
        setTimeout(() => mapaCliente.invalidateSize(), 0);
      }
    } else {
      modalConfirmarDireccion.classList.add("oculto");
      modalConfirmarMomentoWrap.classList.remove("oculto");
    }
    renderTotalesModal();
  });
});

function distanciaKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function inicializarMapaCliente() {
  if (mapaCliente) return;

  const centro = tiendaInfo?.ubicacion || MAPA_CENTRO_DEFECTO;
  const zoom = tiendaInfo?.ubicacion ? 14 : MAPA_ZOOM_DEFECTO;

  mapaCliente = L.map("mapa-direccion-cliente").setView([centro.lat, centro.lng], zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
  }).addTo(mapaCliente);

  mapaCliente.on("click", (ev) => {
    pinClienteActual = { lat: ev.latlng.lat, lng: ev.latlng.lng };
    if (markerCliente) {
      markerCliente.setLatLng(ev.latlng);
    } else {
      markerCliente = L.marker(ev.latlng).addTo(mapaCliente);
    }
    renderTotalesModal();
  });
}

function costoEnvioActual() {
  if (tipoEntregaSeleccionado !== "envio") return 0;
  if (!pinClienteActual || !tiendaInfo?.ubicacion) return 0;
  const km = distanciaKm(tiendaInfo.ubicacion, pinClienteActual);
  return Math.round((tiendaInfo.envioBase || 0) + km * (tiendaInfo.envioPorKm || 0));
}

function renderTotalesModal() {
  if (!resumenActual) return;
  const costoEnvio = costoEnvioActual();
  const total = resumenActual.total + costoEnvio;
  const html = `
    <div class="fila-total"><span>Subtotal</span><span>${formatoMoneda(resumenActual.subtotal)}</span></div>
    ${resumenActual.cumpleMinimo ? `<div class="fila-total ahorro"><span>Ahorrás (10%)</span><span>-${formatoMoneda(resumenActual.descuentoMonto)}</span></div>` : ""}
    ${costoEnvio > 0 ? `<div class="fila-total"><span>Envío</span><span>${formatoMoneda(costoEnvio)}</span></div>` : ""}
    <div class="fila-total a-pagar"><span>Total</span><span>${formatoMoneda(total)}</span></div>
  `;
  modalConfirmarTotales.innerHTML = html;
  modalConfirmarTotalesEnvio.innerHTML = html;
}

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

function esCategoriaBolson(categoria) {
  return categoria === "bolson_verduras" || categoria === "bolson_frutas" || categoria === "bolson_mixto";
}

function renderProductos() {
  const texto = slugify(inputBuscar.value || "");
  const filtrados = productos.filter((p) => slugify(p.nombre).includes(texto));

  if (filtrados.length === 0) {
    listaProductos.innerHTML = `<div class="sin-resultados">No encontramos productos con ese nombre.</div>`;
    return;
  }

  const grupos = { bolson: [], fruta: [], verdura: [] };
  filtrados.forEach((p) => {
    const cat = esCategoriaBolson(p.categoria) ? "bolson" : (p.categoria === "fruta" ? "fruta" : "verdura");
    grupos[cat].push(p);
  });

  let html = "";
  if (grupos.bolson.length) {
    html += `<div class="categoria-titulo">Bolsones</div>`;
    html += grupos.bolson.map(renderFilaProducto).join("");
  }
  if (grupos.fruta.length) {
    html += `<div class="categoria-titulo">Frutas</div>`;
    html += grupos.fruta.map(renderFilaProducto).join("");
  }
  if (grupos.verdura.length) {
    html += `<div class="categoria-titulo">Verduras</div>`;
    html += grupos.verdura.map(renderFilaProducto).join("");
  }
  listaProductos.innerHTML = html;

  // Listeners de +/-
  listaProductos.querySelectorAll("[data-accion]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const accion = btn.dataset.accion;
      const producto = productos.find((x) => x.id === id);
      const paso = pasoDe(producto);
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
  const cantidad = carrito[p.id] || 0;
  const tieneContenido = esCategoriaBolson(p.categoria) && p.contenido;
  return `
    <div class="producto">
      <div class="producto-fila">
        <div class="producto-info">
          <div class="producto-nombre">${p.nombre}</div>
          <div class="producto-precio">${formatoMoneda(p.precioPorKg)} ${p.unidadVenta === "unidad" ? "/ unidad" : "/ kg"}</div>
        </div>
        <div class="producto-cantidad">
          <button class="btn-qty" data-id="${p.id}" data-accion="restar" ${cantidad <= 0 ? "disabled" : ""}>−</button>
          <div class="qty-valor">${cantidad > 0 ? formatoCantidad(p, cantidad) : "—"}</div>
          <button class="btn-qty" data-id="${p.id}" data-accion="sumar">+</button>
        </div>
      </div>
      ${tieneContenido ? `
        <details class="producto-detalle">
          <summary>¿Qué lleva?</summary>
          <ul>${p.contenido.split(",").map((item) => `<li>${item.trim()}</li>`).join("")}</ul>
        </details>
      ` : ""}
    </div>
  `;
}

function calcularCarrito() {
  const items = Object.entries(carrito).map(([productoId, cantidad]) => {
    const p = productos.find((x) => x.id === productoId);
    const subtotal = subtotalDe(p, cantidad);
    return {
      productoId,
      nombre: p?.nombre || "?",
      categoria: p?.categoria || "verdura",
      precioPorKg: p?.precioPorKg || 0,
      unidadVenta: p?.unidadVenta || "kg",
      kg: cantidad,
      kgEquivalente: kgEquivalente(p, cantidad),
      subtotal
    };
  });
  const pesoTotalKg = items.reduce((acc, it) => acc + it.kgEquivalente, 0);
  const subtotal = items.reduce((acc, it) => acc + it.subtotal, 0);
  const cumpleMinimo = pesoTotalKg >= KG_MINIMO_DESCUENTO;
  const descuentoMonto = cumpleMinimo ? subtotal * PORCENTAJE_DESCUENTO : 0;
  const total = subtotal - descuentoMonto;
  return { items, pesoTotalKg, subtotal, cumpleMinimo, descuentoMonto, total };
}

function actualizarBarraCarrito() {
  const { items, pesoTotalKg, total, cumpleMinimo } = calcularCarrito();

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
  btnConfirmar.disabled = items.length === 0;
}

btnConfirmar.addEventListener("click", () => {
  const resumen = calcularCarrito();
  if (resumen.items.length === 0) return;
  abrirModalConfirmarPedido(resumen);
});

function abrirModalConfirmarPedido(resumen) {
  resumenActual = resumen;

  modalConfirmarItems.innerHTML = resumen.items.map((it) => `
    <div class="pedido-item-fila">
      <span>${it.nombre} — ${formatoCantidad(it, it.kg)}</span>
      <span>${formatoMoneda(it.subtotal)}</span>
    </div>
  `).join("");

  momentoSeleccionado = null;
  botonesMomento.forEach((b) => b.classList.remove("activo"));

  tipoEntregaSeleccionado = null;
  botonesEntrega.forEach((b) => b.classList.remove("activo"));
  modalConfirmarMomentoWrap.classList.add("oculto");
  modalConfirmarDireccion.classList.add("oculto");

  pinClienteActual = null;
  if (markerCliente && mapaCliente) {
    mapaCliente.removeLayer(markerCliente);
    markerCliente = null;
  }

  if (!tiendaInfo?.ubicacion) {
    el("mapa-direccion-cliente").classList.add("oculto");
    direccionSinUbicacionLocal.classList.remove("oculto");
  } else {
    el("mapa-direccion-cliente").classList.remove("oculto");
    direccionSinUbicacionLocal.classList.add("oculto");
    inicializarMapaCliente();
    if (mapaCliente) {
      const centro = tiendaInfo.ubicacion;
      mapaCliente.setView([centro.lat, centro.lng], 14);
      setTimeout(() => mapaCliente.invalidateSize(), 0);
    }
  }
  el("direccion-nombre").value = "";
  el("direccion-apellido").value = "";
  el("direccion-calle").value = "";
  el("direccion-piso").value = "";
  el("direccion-telefono").value = "";
  el("direccion-notas").value = "";

  renderTotalesModal();

  modalConfirmarEnviar.disabled = false;
  modalConfirmarEnviar.textContent = "Enviar pedido";
  modalConfirmarPedido.classList.remove("oculto");
  document.body.classList.add("body-bloqueado");

  modalConfirmarEnviar.onclick = () => {
    if (!tipoEntregaSeleccionado) {
      alert("Elegí cómo querés recibir tu pedido.");
      return;
    }
    if (tipoEntregaSeleccionado === "retiro" && !momentoSeleccionado) {
      alert("Elegí en qué momento del día pasás a buscarlo.");
      return;
    }
    if (tipoEntregaSeleccionado === "envio") {
      if (!tiendaInfo?.ubicacion) {
        alert("Este local todavía no tiene envío a domicilio configurado.");
        return;
      }
      if (!pinClienteActual) {
        alert("Marcá tu ubicación en el mapa.");
        return;
      }
      const nombre = el("direccion-nombre").value.trim();
      const apellido = el("direccion-apellido").value.trim();
      const direccion = el("direccion-calle").value.trim();
      const telefono = el("direccion-telefono").value.trim();
      if (!nombre || !apellido || !direccion || !telefono) {
        alert("Completá los datos de entrega.");
        return;
      }
    }
    enviarPedido(resumen);
  };
}

function cerrarModalConfirmarPedido() {
  modalConfirmarPedido.classList.add("oculto");
  document.body.classList.remove("body-bloqueado");
}

modalConfirmarCancelar.addEventListener("click", cerrarModalConfirmarPedido);

async function enviarPedido(resumen) {
  modalConfirmarEnviar.disabled = true;
  modalConfirmarEnviar.textContent = "Enviando...";

  const ventanaWhatsApp = tiendaInfo?.telefonoContacto ? window.open("", "_blank") : null;

  const esEnvio = tipoEntregaSeleccionado === "envio";
  const costoEnvio = costoEnvioActual();
  const distancia = esEnvio && tiendaInfo?.ubicacion && pinClienteActual ? distanciaKm(tiendaInfo.ubicacion, pinClienteActual) : null;
  const ubicacionEntrega = esEnvio ? pinClienteActual : null;
  const direccionEntrega = esEnvio ? {
    nombre: el("direccion-nombre").value.trim(),
    apellido: el("direccion-apellido").value.trim(),
    direccion: el("direccion-calle").value.trim(),
    pisoDepto: el("direccion-piso").value.trim(),
    telefono: el("direccion-telefono").value.trim(),
    notas: el("direccion-notas").value.trim(),
  } : null;
  const totalConEnvio = resumen.total + costoEnvio;

  try {
    const pedidoRef = await addDoc(collection(db, "verdulerias", tiendaId, "pedidos"), {
      clienteId: cliente.clienteId,
      clienteNombre: `${cliente.nombre} ${cliente.apellido}`,
      items: resumen.items,
      pesoTotalKg: resumen.pesoTotalKg,
      subtotal: resumen.subtotal,
      descuentoAplicado: resumen.cumpleMinimo,
      descuentoMonto: resumen.descuentoMonto,
      tipoEntrega: tipoEntregaSeleccionado,
      momentoRetiro: esEnvio ? null : momentoSeleccionado,
      ubicacionEntrega,
      distanciaKm: distancia,
      costoEnvio,
      direccionEntrega,
      total: totalConEnvio,
      pagado: false,
      metodoPago: null,
      entregado: false,
      armado: false,
      vistoPorAdmin: false,
      fecha: new Date().toISOString()
    });

    ultimoPedidoId = pedidoRef.id;
    carrito = {};

    const linkWhatsApp = armarLinkWhatsApp({ ...resumen, total: totalConEnvio, tipoEntrega: tipoEntregaSeleccionado, ubicacionEntrega, distanciaKm: distancia, costoEnvio, direccionEntrega }, momentoSeleccionado);
    if (linkWhatsApp && ventanaWhatsApp) {
      ventanaWhatsApp.location.href = linkWhatsApp;
    } else if (linkWhatsApp) {
      window.open(linkWhatsApp, "_blank");
    }

    cerrarModalConfirmarPedido();
    mostrarConfirmacion();
  } catch (e) {
    if (ventanaWhatsApp) ventanaWhatsApp.close();
    alert("No pudimos confirmar el pedido: " + e.message);
    modalConfirmarEnviar.disabled = false;
    modalConfirmarEnviar.textContent = "Enviar pedido";
  }
}

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

function armarLinkWhatsApp(p, momentoRetiro) {
  const telefono = tiendaInfo?.telefonoContacto;
  if (!telefono) return null;
  const itemsTextoWhatsApp = (p.items || []).map((it) => `• ${it.nombre} — ${formatoCantidad(it, it.kg)}`).join("\n");
  const lineasWhatsApp = [
    "Hola! Te paso mi pedido para que lo confirmes:",
    "",
    itemsTextoWhatsApp,
    "",
    `Total: ${formatoMoneda(p.total)}`,
  ];
  if (p.tipoEntrega === "envio" && p.direccionEntrega) {
    const d = p.direccionEntrega;
    lineasWhatsApp.push("");
    lineasWhatsApp.push(`Envío a: ${d.direccion}${d.pisoDepto ? ", " + d.pisoDepto : ""}`);
    lineasWhatsApp.push(`Envío: ${formatoMoneda(p.costoEnvio || 0)}${p.distanciaKm ? ` (${p.distanciaKm.toFixed(1)} km)` : ""}`);
    if (p.ubicacionEntrega) lineasWhatsApp.push(`Ver ubicación: https://maps.google.com/?q=${p.ubicacionEntrega.lat},${p.ubicacionEntrega.lng}`);
    lineasWhatsApp.push(`A nombre de: ${d.nombre} ${d.apellido} — Tel: ${d.telefono}`);
    if (d.notas) lineasWhatsApp.push(`Notas: ${d.notas}`);
  } else if (momentoRetiro && MOMENTOS_TEXTO[momentoRetiro]) {
    lineasWhatsApp.push(`Paso a buscarlo por la ${MOMENTOS_TEXTO[momentoRetiro]}`);
  }
  const mensajeWhatsApp = encodeURIComponent(lineasWhatsApp.join("\n"));
  return `https://wa.me/54${telefono}?text=${mensajeWhatsApp}`;
}

function renderPedido(p) {
  const fecha = new Date(p.fecha);
  const fechaTexto = fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

  const itemsHtml = (p.items || []).map((it) => `
    <div class="pedido-item-fila">
      <span>${it.nombre} — ${formatoCantidad(it, it.kg)}</span>
      <span>${formatoMoneda(it.subtotal)}</span>
    </div>
  `).join("");

  const esReciente = p.id === ultimoPedidoId;

  const linkWhatsApp = armarLinkWhatsApp(p, p.momentoRetiro);
  const notaPago = linkWhatsApp
    ? `Mandanos tu pedido a <a href="${linkWhatsApp}" target="_blank">WhatsApp</a>. Una vez que lo confirmemos, te pasamos el total y el alias para transferir.`
    : `Esperá a que confirmemos tu pedido para recibir el total y el alias para transferir.`;

  const entregaTexto = p.tipoEntrega === "envio"
    ? `Envío a domicilio${p.distanciaKm ? " — " + p.distanciaKm.toFixed(1) + " km" : ""}`
    : "Retiro en el local";

  return `
    <div class="pedido-card ${esReciente ? "recien-confirmado" : ""}">
      <div class="pedido-header">
        <div class="pedido-fecha">${fechaTexto} · ${formatoKg(p.pesoTotalKg)}</div>
      </div>
      <div class="pedido-entrega">${entregaTexto}</div>
      <div class="pedido-items">${itemsHtml}</div>
      <div class="pedido-totales">
        <div class="fila-total"><span>Subtotal</span><span>${formatoMoneda(p.subtotal)}</span></div>
        ${p.descuentoAplicado ? `<div class="fila-total ahorro"><span>Ahorraste (10%)</span><span>-${formatoMoneda(p.descuentoMonto)}</span></div>` : ""}
        ${p.costoEnvio ? `<div class="fila-total"><span>Envío</span><span>${formatoMoneda(p.costoEnvio)}</span></div>` : ""}
        <div class="fila-total a-pagar"><span>Total a pagar</span><span>${formatoMoneda(p.total)}</span></div>
      </div>
      <div class="nota-pago">${notaPago}</div>
    </div>
  `;
}
