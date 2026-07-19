import { firebaseConfig, SUPERADMIN_PASSWORD } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc
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
const ayudaSlug = el("ayuda-slug");
const btnCrearTienda = el("btn-crear-tienda");
const mensajeResultado = el("mensaje-resultado");
const listaTiendas = el("lista-tiendas");

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
      activa: true
    });

    await copiarCatalogoDemo(slug);

    mostrarMensaje(`"${nombre}" creada con éxito. Cliente: index.html?tienda=${slug} · Admin: admin.html?tienda=${slug}`, false);

    ntNombre.value = "";
    ntSlug.value = "";
    ntPassword.value = "";
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
      <div class="tienda-header">
        <div>
          <div class="tienda-nombre">${t.nombre}</div>
          <div class="tienda-slug">?tienda=${t.id}</div>
        </div>
        <span class="badge-estado ${t.activa !== false ? "activa" : "inactiva"}">${t.activa !== false ? "ACTIVA" : "INACTIVA"}</span>
      </div>
      <div class="tienda-links">
        <a href="index.html?tienda=${t.id}" target="_blank">Ver catálogo</a>
        <a href="admin.html?tienda=${t.id}" target="_blank">Panel admin</a>
        <button class="btn-toggle-estado" data-accion="toggle-activa">${t.activa !== false ? "Desactivar" : "Activar"}</button>
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
  });
}
