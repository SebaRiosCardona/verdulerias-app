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
// Reglas de negocio del descuento
// ---------------------------------------------------------------
const MONTO_MINIMO_DESCUENTO_DEFECTO = 20000;
const PORCENTAJE_DESCUENTO_DEFECTO = 0.10;

function montoMinimoDescuento() {
  return tiendaInfo?.montoMinimoDescuento || MONTO_MINIMO_DESCUENTO_DEFECTO;
}

function porcentajeDescuento() {
  return tiendaInfo?.porcentajeDescuento !== undefined ? tiendaInfo.porcentajeDescuento : PORCENTAJE_DESCUENTO_DEFECTO;
}

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
  const redondeado = Math.round(valor * 100) / 100;
  const decimales = redondeado * 10 % 1 === 0 ? 1 : 2;
  return redondeado.toFixed(decimales) + " kg";
}

// ---------------------------------------------------------------
// Unidades de venta
// ---------------------------------------------------------------
function formatoGramos(kg) {
  return `${Math.round(kg * 1000)}g`;
}

function textoPesoAproximado(gramos) {
  if (gramos >= 1000) {
    const kg = Math.round(gramos / 10) / 100;
    return `${kg}kg`;
  }
  return `${gramos}g`;
}

function formatoFraccionable(c, etiquetaUnidad) {
  if (c === 0.25) return `1/4 ${etiquetaUnidad}`;
  if (c === 0.5) return `1/2 ${etiquetaUnidad}`;
  if (c === 0.75) return `3/4 ${etiquetaUnidad}`;
  const entero = Math.round(c);
  return `${entero} ${etiquetaUnidad}${entero === 1 ? "" : "s"}`;
}

const UNIDADES_VENTA = {
  kg: { paso: 0.5, formato: (c) => formatoKg(c), kgPorUnidad: 1 },
  medio_kg: { paso: 0.5, formato: (c) => formatoKg(c), kgPorUnidad: 1 },
  "100g": { paso: 0.1, formato: (c) => c < 1 ? formatoGramos(c) : formatoKg(c), kgPorUnidad: 1 },
  unidad: { paso: 1, formato: (c) => `${Math.round(c)} u.`, kgPorUnidad: 0.5 },
  atado: { paso: 1, formato: (c) => `${Math.round(c)} atado${Math.round(c) === 1 ? "" : "s"}`, kgPorUnidad: 0.5 },
  bolsa: { paso: 1, formato: (c) => `${Math.round(c)} bolsa${Math.round(c) === 1 ? "" : "s"}`, kgPorUnidad: 0.5 },
};

function unidadDe(producto) {
  return UNIDADES_VENTA[producto?.unidadVenta || "kg"];
}

// precioPorKg siempre se guarda como $/kg; para mostrarlo en la unidad que
// eligió el admin (medio kilo, 100g) hay que convertirlo de vuelta.
function factorConversionPrecio(unidadVenta) {
  if (unidadVenta === "medio_kg") return 2;
  if (unidadVenta === "100g") return 10;
  return 1;
}

function sufijoPrecioDe(unidadVenta) {
  if (unidadVenta === "unidad") return "/ unidad";
  if (unidadVenta === "atado") return "/ atado";
  if (unidadVenta === "bolsa") return "/ bolsa";
  if (unidadVenta === "medio_kg") return "/ medio kilo";
  if (unidadVenta === "100g") return "/ 100g";
  return "/ kg";
}

function esFraccionable(producto) {
  const unidad = producto?.unidadVenta;
  return (unidad === "atado" || unidad === "unidad") && !!producto?.atadoFraccionable;
}

function pasoDe(producto) {
  if (esFraccionable(producto)) return 0.25;
  return unidadDe(producto).paso;
}

function esUnidadEntera(unidadVenta) {
  return unidadVenta === "unidad" || unidadVenta === "atado" || unidadVenta === "bolsa";
}

function textoPasoFijo(producto) {
  const unidad = producto?.unidadVenta || "kg";
  if (unidad === "100g") return "100g";
  if (esUnidadEntera(unidad)) return "1 unidad";
  return "500g";
}

function formatoCantidad(producto, cantidad) {
  if (esFraccionable(producto)) return formatoFraccionable(cantidad, producto.unidadVenta === "atado" ? "atado" : "unidad");
  return unidadDe(producto).formato(cantidad);
}

function subtotalDe(producto, cantidad) {
  return (producto?.precioPorKg || 0) * cantidad;
}

function kgEquivalente(producto, cantidad) {
  if (esCategoriaBolson(producto?.categoria)) return 0;
  return cantidad * unidadDe(producto).kgPorUnidad;
}

const params = new URLSearchParams(window.location.search);
const tiendaId = params.get("tienda") || TIENDA_POR_DEFECTO;

const CLAVE_SESION = `verduleria_sesion_${tiendaId}`;

const LOGOS_POR_TIENDA = {
  "vida-verde": "logo-vida-verde.svg",
};

const SLOGANS_POR_TIENDA = {
  "vida-verde": "Fresco, natural, Vida Verde",
};

if (LOGOS_POR_TIENDA[tiendaId]) {
  const elLogo = document.getElementById("logo-tienda");
  if (elLogo) {
    elLogo.innerHTML = `<img src="${LOGOS_POR_TIENDA[tiendaId]}" alt="Logo" />`;
  }
}

if (SLOGANS_POR_TIENDA[tiendaId]) {
  const elSlogan = document.getElementById("slogan-tienda");
  if (elSlogan) {
    elSlogan.textContent = SLOGANS_POR_TIENDA[tiendaId];
  }
}

// ---------------------------------------------------------------
// Manifest dinámico por tienda
// ---------------------------------------------------------------
// manifest.json es un solo archivo estático compartido por todas las
// verdulerías. Sin este ajuste, el "start_url" que trae siempre es el
// mismo (sin ?tienda=...), así que el acceso directo del celular termina
// abriendo siempre la tienda por defecto, sin importar cuál estabas viendo.
async function ajustarManifestParaTienda() {
  try {
    const manifestLinkEl = document.querySelector('link[rel="manifest"]');
    if (!manifestLinkEl) return;
    const respuesta = await fetch(manifestLinkEl.href);
    const manifestBase = await respuesta.json();
    manifestBase.start_url = `./index.html?tienda=${tiendaId}`;
    const blob = new Blob([JSON.stringify(manifestBase)], { type: "application/json" });
    manifestLinkEl.href = URL.createObjectURL(blob);
  } catch (e) {
    console.warn("No se pudo ajustar el manifest dinámico:", e);
  }
}
ajustarManifestParaTienda();

// ---------------------------------------------------------------
// Elementos del DOM
// ---------------------------------------------------------------
const el = (id) => document.getElementById(id);

const modalAviso = el("modal-aviso");
const modalAvisoTexto = el("modal-aviso-texto");
const modalAvisoOk = el("modal-aviso-ok");

function mostrarAviso(mensaje) {
  modalAvisoTexto.textContent = mensaje;
  modalAviso.classList.remove("oculto");
}

modalAvisoOk.addEventListener("click", () => modalAviso.classList.add("oculto"));

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
const categoriasNav = el("categorias-nav");

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

function ubicarPinCliente(latlng, zoom) {
  pinClienteActual = { lat: latlng.lat, lng: latlng.lng };
  if (markerCliente) {
    markerCliente.setLatLng(latlng);
  } else {
    markerCliente = L.marker(latlng).addTo(mapaCliente);
  }
  if (zoom) {
    mapaCliente.setView(latlng, zoom);
  }
  renderTotalesModal();
}

async function buscarDireccionEnMapa() {
  const direccion = el("direccion-calle").value.trim();
  const elBuscando = el("direccion-buscando");
  const elNoEncontrada = el("direccion-no-encontrada");
  elNoEncontrada.classList.add("oculto");
  if (!direccion || !mapaCliente) return;

  const centro = tiendaInfo?.ubicacion || MAPA_CENTRO_DEFECTO;
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
    ubicarPinCliente({ lat: parseFloat(lat), lng: parseFloat(lon) }, 16);
  } catch (e) {
    elBuscando.classList.add("oculto");
    elNoEncontrada.classList.remove("oculto");
  }
}

el("btn-buscar-direccion").addEventListener("click", buscarDireccionEnMapa);

function inicializarMapaCliente() {
  if (mapaCliente) return;

  const centro = tiendaInfo?.ubicacion || MAPA_CENTRO_DEFECTO;
  const zoom = tiendaInfo?.ubicacion ? 14 : MAPA_ZOOM_DEFECTO;

  mapaCliente = L.map("mapa-direccion-cliente").setView([centro.lat, centro.lng], zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
  }).addTo(mapaCliente);

  mapaCliente.on("click", (ev) => {
    ubicarPinCliente(ev.latlng);
    buscarDireccionInversa(ev.latlng);
  });
}

async function buscarDireccionInversa(latlng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}`;
    const res = await fetch(url);
    const resultado = await res.json();
    const direccion = resultado?.address;
    if (!direccion) return;
    const calle = [direccion.road, direccion.house_number].filter(Boolean).join(" ");
    if (calle) {
      el("direccion-calle").value = calle;
    }
  } catch (e) {
    // si falla, el cliente puede seguir escribiendo la dirección a mano
  }
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
    ${resumenActual.cumpleMinimo ? `<div class="fila-total ahorro"><span>Ahorrás (${Math.round(porcentajeDescuento() * 100)}%)</span><span>-${formatoMoneda(resumenActual.descuentoMonto)}</span></div>` : ""}
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
let categoriasAbiertas = {}; // { [categoria]: boolean } — recuerda qué secciones cerró el usuario
let pasosSeleccionados = {}; // { [productoId]: paso } — paso de +/- elegido para productos con selector
let selectoresPasoAbiertos = {}; // { [productoId]: boolean } — si el selector de paso está desplegado

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
  return categoria === "bolson";
}

const CATEGORIAS_CATALOGO = [
  { clave: "bolson", titulo: "Bolsones" },
  { clave: "verduleria", titulo: "Verdulería" },
  { clave: "condimento", titulo: "Condimentos" },
  { clave: "almacen", titulo: "Almacén" },
];

document.addEventListener("click", (ev) => {
  document.querySelectorAll(".detalle-selector-paso[open]").forEach((detalle) => {
    if (!detalle.contains(ev.target)) {
      detalle.open = false;
      selectoresPasoAbiertos[detalle.dataset.id] = false;
    }
  });
});

function renderCategoriasNav(categoriasPresentes) {
  if (!categoriasNav) return;
  if (categoriasPresentes.length <= 1) {
    categoriasNav.innerHTML = "";
    return;
  }
  categoriasNav.innerHTML = categoriasPresentes.map(({ clave, titulo }) => `
    <button type="button" class="categoria-nav-pill" data-ir-a="${clave}">${titulo}</button>
  `).join("");

  categoriasNav.querySelectorAll("[data-ir-a]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const clave = btn.dataset.irA;
      const detalle = document.getElementById(`categoria-${clave}`);
      if (!detalle) return;
      if (!detalle.open) {
        detalle.open = true;
        categoriasAbiertas[clave] = true;
      }
      const buscadorEl = document.querySelector(".buscador");
      const offset = (buscadorEl?.getBoundingClientRect().bottom || 0) + 8;
      const destino = detalle.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: destino, behavior: "smooth" });
    });
  });
}

function renderProductos() {
  const hayBusqueda = !!(inputBuscar.value || "").trim();
  const texto = slugify(inputBuscar.value || "");
  const filtrados = productos.filter((p) => slugify(p.nombre).includes(texto));

  if (filtrados.length === 0) {
    listaProductos.innerHTML = `<div class="sin-resultados">No encontramos productos con ese nombre.</div>`;
    return;
  }

  const grupos = { bolson: [], verduleria: [], almacen: [], condimento: [] };
  filtrados.forEach((p) => {
    const cat = esCategoriaBolson(p.categoria) ? "bolson" :
      p.categoria === "almacen" ? "almacen" :
      p.categoria === "condimento" ? "condimento" : "verduleria";
    grupos[cat].push(p);
  });

  let html = "";
  const categoriasPresentes = [];
  CATEGORIAS_CATALOGO.forEach(({ clave, titulo }) => {
    if (!grupos[clave].length) return;
    categoriasPresentes.push({ clave, titulo });
    const abierto = hayBusqueda || categoriasAbiertas[clave] !== false;
    html += `
      <details class="categoria-grupo" id="categoria-${clave}" data-categoria="${clave}" ${abierto ? "open" : ""}>
        <summary class="categoria-titulo">${titulo}<span class="categoria-flecha">▾</span></summary>
        <div class="categoria-productos">${grupos[clave].map(renderFilaProducto).join("")}</div>
      </details>
    `;
  });
  listaProductos.innerHTML = html;
  renderCategoriasNav(categoriasPresentes);

  listaProductos.querySelectorAll(".categoria-grupo").forEach((detalle) => {
    detalle.addEventListener("toggle", () => {
      categoriasAbiertas[detalle.dataset.categoria] = detalle.open;
    });
  });

  listaProductos.querySelectorAll(".detalle-selector-paso").forEach((detalle) => {
    detalle.addEventListener("toggle", () => {
      selectoresPasoAbiertos[detalle.dataset.id] = detalle.open;
    });
  });

  // Listeners de +/-
  listaProductos.querySelectorAll("[data-accion]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const accion = btn.dataset.accion;
      const producto = productos.find((x) => x.id === id);
      const paso = pasosSeleccionados[id] || pasoDe(producto);
      const actual = carrito[id] || 0;
      let nuevo = accion === "sumar" ? actual + paso : actual - paso;
      if (nuevo < 0) nuevo = 0;
      nuevo = Math.round(nuevo * 100) / 100;
      if (nuevo === 0) delete carrito[id];
      else carrito[id] = nuevo;
      renderProductos();
      actualizarBarraCarrito();
    });
  });

  // Listeners del selector de paso (100g / 500g / 1kg)
  listaProductos.querySelectorAll("[data-accion-paso]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const nuevoPaso = parseFloat(btn.dataset.pasoValor);
      if (pasosSeleccionados[id] !== nuevoPaso) {
        delete carrito[id];
      }
      pasosSeleccionados[id] = nuevoPaso;
      renderProductos();
      actualizarBarraCarrito();
    });
  });
}

const OPCIONES_PASO_KILO = [
  { valor: 0.1, etiqueta: "100g" },
  { valor: 0.25, etiqueta: "250g" },
  { valor: 0.5, etiqueta: "500g" },
  { valor: 1, etiqueta: "1kg" },
];

function opcionesPasoFraccionable(etiquetaUnidad) {
  return [
    { valor: 0.25, etiqueta: `1/4 ${etiquetaUnidad}` },
    { valor: 0.5, etiqueta: `1/2 ${etiquetaUnidad}` },
    { valor: 1, etiqueta: etiquetaUnidad === "atado" ? "Atado" : "1 unidad" },
  ];
}

function renderFilaProducto(p) {
  const cantidad = carrito[p.id] || 0;
  const tieneContenido = esCategoriaBolson(p.categoria) && p.contenido;
  const unidadVenta = p.unidadVenta || "kg";
  const fraccionable = esFraccionable(p);
  const tieneSelectorPaso = !esCategoriaBolson(p.categoria) && (fraccionable || !esUnidadEntera(unidadVenta));
  const opcionesPaso = tieneSelectorPaso ? (fraccionable ? opcionesPasoFraccionable(unidadVenta === "atado" ? "atado" : "unidad") : OPCIONES_PASO_KILO) : null;
  if (tieneSelectorPaso && pasosSeleccionados[p.id] === undefined) {
    pasosSeleccionados[p.id] = opcionesPaso[0].valor;
  }

  const opcionActual = opcionesPaso?.find((op) => op.valor === pasosSeleccionados[p.id]);

  const selectorPaso = opcionesPaso ? `
    <details class="detalle-selector-paso" data-id="${p.id}" ${selectoresPasoAbiertos[p.id] ? "open" : ""}>
      <summary>x ${opcionActual.etiqueta}</summary>
      <div class="selector-paso">
        ${opcionesPaso.map((op) => `
          <button type="button" class="paso-opcion ${pasosSeleccionados[p.id] === op.valor ? "activo" : ""}" data-id="${p.id}" data-accion-paso data-paso-valor="${op.valor}">${op.etiqueta}</button>
        `).join("")}
      </div>
    </details>
  ` : `<div class="texto-paso-fijo">x ${textoPasoFijo(p)}</div>`;

  return `
    <div class="producto">
      <div class="producto-fila">
        <div class="producto-info">
          <div class="producto-nombre">${p.nombre}</div>
          <div class="producto-precio">${formatoMoneda(p.precioPorKg / factorConversionPrecio(unidadVenta))} ${sufijoPrecioDe(unidadVenta)}${p.pesoAproximadoGramos ? ` (aprox. ${textoPesoAproximado(p.pesoAproximadoGramos)})` : ""}</div>
        </div>
        <div class="producto-cantidad">
          ${selectorPaso}
          <div class="producto-cantidad-botones">
            <button class="btn-qty" data-id="${p.id}" data-accion="restar" ${cantidad <= 0 ? "disabled" : ""}>−</button>
            <div class="qty-valor">${cantidad > 0 ? formatoCantidad(p, cantidad) : "—"}</div>
            <button class="btn-qty" data-id="${p.id}" data-accion="sumar">+</button>
          </div>
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
      categoria: p?.categoria || "verduleria",
      precioPorKg: p?.precioPorKg || 0,
      unidadVenta: p?.unidadVenta || "kg",
      kg: cantidad,
      kgEquivalente: kgEquivalente(p, cantidad),
      subtotal
    };
  });
  const pesoTotalKg = items.reduce((acc, it) => acc + it.kgEquivalente, 0);
  const subtotal = items.reduce((acc, it) => acc + it.subtotal, 0);
  const subtotalElegibleDescuento = items.reduce((acc, it) => acc + (esCategoriaBolson(it.categoria) ? 0 : it.subtotal), 0);
  const cumpleMinimo = subtotalElegibleDescuento >= montoMinimoDescuento();
  const descuentoMonto = cumpleMinimo ? subtotalElegibleDescuento * porcentajeDescuento() : 0;
  const total = subtotal - descuentoMonto;
  return { items, pesoTotalKg, subtotal, subtotalElegibleDescuento, cumpleMinimo, descuentoMonto, total };
}

function actualizarBarraCarrito() {
  const { items, total, cumpleMinimo, pesoTotalKg, subtotalElegibleDescuento } = calcularCarrito();

  const porcentajeTexto = Math.round(porcentajeDescuento() * 100);
  if (cumpleMinimo) {
    barraDescuento.className = "barra-descuento lograda";
    barraDescuento.textContent = `¡${porcentajeTexto}% de descuento aplicado por superar los ${formatoMoneda(montoMinimoDescuento())}! 🎉`;
  } else {
    const faltan = montoMinimoDescuento() - subtotalElegibleDescuento;
    barraDescuento.className = "barra-descuento falta";
    barraDescuento.textContent = `Te faltan ${formatoMoneda(faltan)} para el ${porcentajeTexto}% de descuento`;
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
  el("direccion-calle").value = "";
  el("direccion-piso").value = "";
  el("direccion-telefono").value = "";
  el("direccion-notas").value = "";
  el("direccion-buscando").classList.add("oculto");
  el("direccion-no-encontrada").classList.add("oculto");

  renderTotalesModal();

  modalConfirmarEnviar.disabled = false;
  modalConfirmarEnviar.textContent = "Enviar pedido";
  modalConfirmarPedido.classList.remove("oculto");
  document.body.classList.add("body-bloqueado");

  modalConfirmarEnviar.onclick = () => {
    if (!tipoEntregaSeleccionado) {
      mostrarAviso("Elegí cómo querés recibir tu pedido.");
      return;
    }
    if (tipoEntregaSeleccionado === "retiro" && !momentoSeleccionado) {
      mostrarAviso("Elegí en qué momento del día pasás a buscarlo.");
      return;
    }
    if (tipoEntregaSeleccionado === "envio") {
      if (!tiendaInfo?.ubicacion) {
        mostrarAviso("Este local todavía no tiene envío a domicilio configurado.");
        return;
      }
      if (!pinClienteActual) {
        mostrarAviso("Marcá tu ubicación en el mapa.");
        return;
      }
      const direccion = el("direccion-calle").value.trim();
      const telefono = el("direccion-telefono").value.trim();
      if (!direccion || !telefono) {
        mostrarAviso("Completá los datos de entrega.");
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
    nombre: cliente.nombre,
    apellido: cliente.apellido,
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
      porcentajeDescuentoAplicado: resumen.cumpleMinimo ? porcentajeDescuento() : null,
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
    mostrarAviso("No pudimos confirmar el pedido: " + e.message);
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
  const esEnvio = p.tipoEntrega === "envio" && p.direccionEntrega;
  const costoEnvio = esEnvio ? (p.costoEnvio || 0) : 0;
  const totalPedido = p.total - costoEnvio;

  const lineasWhatsApp = [
    "Hola! Te paso mi pedido para que lo confirmes:",
    "",
    itemsTextoWhatsApp,
    "",
  ];
  if (esEnvio) {
    lineasWhatsApp.push(`Total pedido: ${formatoMoneda(totalPedido)}`);
    lineasWhatsApp.push(`Total envío: ${formatoMoneda(costoEnvio)}${p.distanciaKm ? ` (${p.distanciaKm.toFixed(1)} km)` : ""}`);
    lineasWhatsApp.push(`TOTAL: ${formatoMoneda(p.total)}`);
    if (tiendaInfo?.alias) lineasWhatsApp.push(`Alias: ${tiendaInfo.alias}`);
    const d = p.direccionEntrega;
    lineasWhatsApp.push("");
    lineasWhatsApp.push(`Envío a: ${d.direccion}${d.pisoDepto ? ", " + d.pisoDepto : ""}`);
    if (p.ubicacionEntrega) lineasWhatsApp.push(`Ver ubicación: https://maps.google.com/?q=${p.ubicacionEntrega.lat},${p.ubicacionEntrega.lng}`);
    lineasWhatsApp.push(`A nombre de: ${d.nombre} ${d.apellido} — Tel: ${d.telefono}`);
    if (d.notas) lineasWhatsApp.push(`Notas: ${d.notas}`);
  } else {
    lineasWhatsApp.push(`Total: ${formatoMoneda(p.total)}`);
    if (tiendaInfo?.alias) lineasWhatsApp.push(`Alias: ${tiendaInfo.alias}`);
    if (momentoRetiro && MOMENTOS_TEXTO[momentoRetiro]) {
      lineasWhatsApp.push(`Paso a buscarlo por la ${MOMENTOS_TEXTO[momentoRetiro]}`);
    }
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
        ${p.descuentoAplicado ? `<div class="fila-total ahorro"><span>Ahorraste (${Math.round((p.porcentajeDescuentoAplicado ?? 0.10) * 100)}%)</span><span>-${formatoMoneda(p.descuentoMonto)}</span></div>` : ""}
        ${p.costoEnvio ? `<div class="fila-total"><span>Envío</span><span>${formatoMoneda(p.costoEnvio)}</span></div>` : ""}
        <div class="fila-total a-pagar"><span>Total a pagar</span><span>${formatoMoneda(p.total)}</span></div>
      </div>
      <div class="nota-pago">${notaPago}</div>
    </div>
  `;
}
