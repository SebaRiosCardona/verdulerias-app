import { firebaseConfig, SUPERADMIN_PASSWORD } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const CLAVE_SESION_SUPERADMIN = "verduleria_superadmin";
const TIENDA_ORIGEN_CATALOGO = "demo"; // de acá se copian los productos base

const el = (id) => document.getElementById(id);

function slugify(texto) {
  const RANGO_DIACRITICOS = new RegExp("[̀-ͯ]", "g");
  return texto
    .toString()
    .normalize("NFD").replace(RANGO_DIACRITICOS, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const pantallaCarga = el("pantalla-carga");
const vistaLoginSuperadmin = el("vista-login-superadmin");
const vistaPanel = el("vista-panel");
const formLoginSuperadmin = el("form-login-superadmin");
const inputPasswordSuperadmin = el("input-password-superadmin");
const errorLoginSuperadmin = el("error-login-superadmin");
const btnSalirSuperadmin = el("btn-salir-superadmin");

const ntNombre = el("nt-nombre");
const ntSlug = el("nt-slug");
const ntPassword = el("nt-password");
const ntTelefono = el("nt-telefono");
const ayudaSlug = el("ayuda-slug");
const btnCrearTienda = el("btn-crear-tienda");
const mensajeResultado = el("mensaje-resultado");
const listaTiendas = el("lista-tiendas");

const modalEliminar = el("modal-eliminar");
const modalEliminarNombre = el("modal-eliminar-nombre");
const modalEliminarInput = el("modal-eliminar-input");
const modalEliminarCancelar = el("modal-eliminar-cancelar");
const modalEliminarConfirmar = el("modal-eliminar-confirmar");

const modalEditar = el("modal-editar");
const edNombre = el("ed-nombre");
const edPassword = el("ed-password");
const edTelefono = el("ed-telefono");
const modalEditarCancelar = el("modal-editar-cancelar");
const modalEditarGuardar = el("modal-editar-guardar");

const EYE_OPEN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

const btnTogglePasswordSuperadmin = el("toggle-password-superadmin");
btnTogglePasswordSuperadmin.innerHTML = EYE_CLOSED;
btnTogglePasswordSuperadmin.addEventListener("click", () => {
  if (inputPasswordSuperadmin.type === "password") {
    inputPasswordSuperadmin.type = "text";
    btnTogglePasswordSuperadmin.innerHTML = EYE_OPEN;
  } else {
    inputPasswordSuperadmin.type = "password";
    btnTogglePasswordSuperadmin.innerHTML = EYE_CLOSED;
  }
});

let slugEditadoManualmente = false;
let tiendasCache = [];

init();

async function init() {
  try {
    await signInAnonymously(auth);
    onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      pantallaCarga.classList.add("oculto");
      const sesion = sessionStorage.getItem(CLAVE_SESION_SUPERADMIN);
      if (sesion === "ok") {
        mostrarPanel();
      } else {
        vistaLoginSuperadmin.classList.remove("oculto");
      }
    });
  } catch (e) {
    pantallaCarga.classList.add("oculto");
    alert("Error al conectar: " + e.message);
  }
}

formLoginSuperadmin.addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (inputPasswordSuperadmin.value === SUPERADMIN_PASSWORD) {
    sessionStorage.setItem(CLAVE_SESION_SUPERADMIN, "ok");
    vistaLoginSuperadmin.classList.add("oculto");
    mostrarPanel();
  } else {
    errorLoginSuperadmin.textContent = "Contraseña incorrecta.";
    errorLoginSuperadmin.classList.remove("oculto");
  }
});

btnSalirSuperadmin.addEventListener("click", () => {
  sessionStorage.removeItem(CLAVE_SESION_SUPERADMIN);
  location.reload();
});

async function mostrarPanel() {
  vistaPanel.classList.remove("oculto");
  await cargarTiendas();
  renderListaTiendas();
}

// ---------------------------------------------------------------
// Autogenerar el slug a partir del nombre (mientras no lo editen a mano)
// ---------------------------------------------------------------
ntNombre.addEventListener("input", () => {
  if (!slugEditadoManualmente) {
    ntSlug.value = slugify(ntNombre.value);
  }
  actualizarAyudaSlug();
});
ntSlug.addEventListener("input", () => {
  slugEditadoManualmente = true;
  actualizarAyudaSlug();
});

function actualizarAyudaSlug() {
  const slug = slugify(ntSlug.value);
  ayudaSlug.textContent = slug
    ? `Link de cliente: index.html?tienda=${slug}`
    : "";
}

// ---------------------------------------------------------------
// Crear verdulería nueva
// ---------------------------------------------------------------
btnCrearTienda.addEventListener("click", async () => {
  const nombre = ntNombre.value.trim();
  const slug = slugify(ntSlug.value);
  const adminPassword = ntPassword.value.trim();
  const telefonoContacto = ntTelefono.value.replace(/\D/g, "");

  mensajeResultado.innerHTML = "";

  if (!nombre || !slug || !adminPassword) {
    mostrarMensaje("Completá nombre, link y contraseña de admin.", true);
    return;
  }

  btnCrearTienda.disabled = true;
  btnCrearTienda.textContent = "Creando...";

  try {
    const tiendaRef = doc(db, "verdulerias", slug);
    const existente = await getDoc(tiendaRef);
    if (existente.exists()) {
      mostrarMensaje(`Ya existe una verdulería con el link "${slug}". Elegí otro.`, true);
      return;
    }

    await setDoc(tiendaRef, {
      nombre,
      slug,
      adminPassword,
      telefonoContacto,
      activa: true
    });

    await copiarCatalogoDemo(slug);

    mostrarMensaje(`"${nombre}" creada con éxito. Cliente: index.html?tienda=${slug} · Admin: admin.html?tienda=${slug}`, false);

    ntNombre.value = "";
    ntSlug.value = "";
    ntPassword.value = "";
    ntTelefono.value = "";
    slugEditadoManualmente = false;
    ayudaSlug.textContent = "";

    await cargarTiendas();
    renderListaTiendas();
  } catch (e) {
    mostrarMensaje("Error al crear la verdulería: " + e.message, true);
  } finally {
    btnCrearTienda.disabled = false;
    btnCrearTienda.textContent = "Crear verdulería (con catálogo de ejemplo)";
  }
});

async function copiarCatalogoDemo(nuevoTiendaId) {
  const productosOrigenSnap = await getDocs(collection(db, "verdulerias", TIENDA_ORIGEN_CATALOGO, "productos"));
  for (const productoDoc of productosOrigenSnap.docs) {
    const datos = productoDoc.data();
    const nuevoProductoRef = doc(collection(db, "verdulerias", nuevoTiendaId, "productos"));
    await setDoc(nuevoProductoRef, datos);
  }
}

function mostrarMensaje(texto, esError) {
  mensajeResultado.innerHTML = `<div class="${esError ? "mensaje-error" : "mensaje-ok"}">${texto}</div>`;
}

// ---------------------------------------------------------------
// Listado de verdulerías existentes
// ---------------------------------------------------------------
async function cargarTiendas() {
  const snap = await getDocs(collection(db, "verdulerias"));
  tiendasCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
}

function renderListaTiendas() {
  if (tiendasCache.length === 0) {
    listaTiendas.innerHTML = `<p style="color:var(--gris);text-align:center;">Todavía no hay verdulerías creadas.</p>`;
    return;
  }

  listaTiendas.innerHTML = tiendasCache.map((t) => `
    <div class="tienda-card" data-id="${t.id}">
      <div class="tienda-acciones-superiores">
        <button class="btn-editar-tienda" data-accion="editar" title="Editar verdulería" aria-label="Editar verdulería">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
        </button>
        <button class="btn-eliminar-tienda" data-accion="eliminar" title="Eliminar verdulería" aria-label="Eliminar verdulería">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
        </button>
      </div>
      <div class="tienda-header">
        <div>
          <div class="tienda-nombre">${t.nombre}</div>
          <div class="tienda-slug">Query parameters: ?tienda=${t.id}</div>
          <div class="tienda-clave">Contraseña: <strong>${t.adminPassword || "—"}</strong></div>
          <div class="tienda-clave">WhatsApp: <strong>${t.telefonoContacto || "—"}</strong></div>
        </div>
        <div class="estado-switch-wrap">
          <button class="estado-switch ${t.activa !== false ? "activa" : ""}" data-accion="toggle-activa" role="switch" aria-checked="${t.activa !== false}" title="${t.activa !== false ? "Desactivar" : "Activar"}"></button>
          <span class="estado-switch-label ${t.activa !== false ? "activa" : ""}">${t.activa !== false ? "ACTIVA" : "INACTIVA"}</span>
        </div>
      </div>
      <div class="tienda-links">
        <a href="index.html?tienda=${t.id}" target="_blank">Ver catálogo</a>
        <a href="admin.html?tienda=${t.id}" target="_blank">Panel admin</a>
      </div>
    </div>
  `).join("");

  listaTiendas.querySelectorAll(".tienda-card").forEach((card) => {
    const id = card.dataset.id;
    const tienda = tiendasCache.find((t) => t.id === id);
    card.querySelector('[data-accion="toggle-activa"]').addEventListener("click", async () => {
      const estabaActiva = tienda.activa !== false;
      const nuevoValor = !estabaActiva;
      await updateDoc(doc(db, "verdulerias", id), { activa: nuevoValor });
      tienda.activa = nuevoValor;
      renderListaTiendas();
    });
    card.querySelector('[data-accion="editar"]').addEventListener("click", () => {
      abrirModalEditar(tienda);
    });
    card.querySelector('[data-accion="eliminar"]').addEventListener("click", () => {
      abrirModalEliminar(tienda);
    });
  });
}

// ---------------------------------------------------------------
// Editar verdulería
// ---------------------------------------------------------------
let tiendaAEditar = null;

function abrirModalEditar(tienda) {
  tiendaAEditar = tienda;
  edNombre.value = tienda.nombre || "";
  edPassword.value = tienda.adminPassword || "";
  edTelefono.value = tienda.telefonoContacto || "";
  modalEditar.classList.remove("oculto");
  edNombre.focus();
}

function cerrarModalEditar() {
  tiendaAEditar = null;
  modalEditar.classList.add("oculto");
}

modalEditarCancelar.addEventListener("click", cerrarModalEditar);

modalEditarGuardar.addEventListener("click", async () => {
  if (!tiendaAEditar) return;
  const tienda = tiendaAEditar;

  const nombre = edNombre.value.trim();
  const adminPassword = edPassword.value.trim();
  const telefonoContacto = edTelefono.value.replace(/\D/g, "");

  if (!nombre || !adminPassword) {
    alert("Completá nombre y contraseña.");
    return;
  }

  modalEditarGuardar.disabled = true;
  modalEditarGuardar.textContent = "Guardando...";

  try {
    await updateDoc(doc(db, "verdulerias", tienda.id), { nombre, adminPassword, telefonoContacto });
    tienda.nombre = nombre;
    tienda.adminPassword = adminPassword;
    tienda.telefonoContacto = telefonoContacto;
    cerrarModalEditar();
    mostrarMensaje(`"${nombre}" actualizada con éxito.`, false);
    renderListaTiendas();
  } catch (e) {
    mostrarMensaje("Error al guardar los cambios: " + e.message, true);
  } finally {
    modalEditarGuardar.disabled = false;
    modalEditarGuardar.textContent = "Guardar cambios";
  }
});

// ---------------------------------------------------------------
// Eliminar verdulería (permanente)
// ---------------------------------------------------------------
let tiendaAEliminar = null;

function abrirModalEliminar(tienda) {
  tiendaAEliminar = tienda;
  modalEliminarNombre.textContent = tienda.nombre;
  modalEliminarInput.value = "";
  modalEliminarConfirmar.disabled = true;
  modalEliminar.classList.remove("oculto");
  modalEliminarInput.focus();
}

function cerrarModalEliminar() {
  tiendaAEliminar = null;
  modalEliminar.classList.add("oculto");
}

modalEliminarInput.addEventListener("input", () => {
  modalEliminarConfirmar.disabled = modalEliminarInput.value.trim() !== (tiendaAEliminar?.nombre || "");
});

modalEliminarCancelar.addEventListener("click", cerrarModalEliminar);

modalEliminarConfirmar.addEventListener("click", async () => {
  if (!tiendaAEliminar) return;
  const tienda = tiendaAEliminar;

  modalEliminarConfirmar.disabled = true;
  modalEliminarConfirmar.textContent = "Eliminando...";

  try {
    await eliminarTiendaCompleta(tienda.id);
    cerrarModalEliminar();
    mostrarMensaje(`"${tienda.nombre}" fue eliminada definitivamente.`, false);
    await cargarTiendas();
    renderListaTiendas();
  } catch (e) {
    mostrarMensaje("Error al eliminar la verdulería: " + e.message, true);
  } finally {
    modalEliminarConfirmar.textContent = "Eliminar definitivamente";
  }
});

async function eliminarTiendaCompleta(tiendaId) {
  const subcolecciones = ["productos", "clientes", "pedidos"];
  for (const nombreSub of subcolecciones) {
    const subSnap = await getDocs(collection(db, "verdulerias", tiendaId, nombreSub));
    for (const subDoc of subSnap.docs) {
      await deleteDoc(subDoc.ref);
    }
  }
  await deleteDoc(doc(db, "verdulerias", tiendaId));
}
