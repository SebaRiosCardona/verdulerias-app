// ============================================================
// CONFIGURACIÓN DE FIREBASE — proyecto "VerduleriaWeb"
// ============================================================
// Antes de usar: en Firebase Console activá Firestore Database
// (modo producción) y Authentication > Sign-in method > Anónimo.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBtv5crtCIPwIi4ntkF4ggcI5Sv8K8MD-U",
  authDomain: "verduleriaweb.firebaseapp.com",
  projectId: "verduleriaweb",
  storageBucket: "verduleriaweb.firebasestorage.app",
  messagingSenderId: "769719350730",
  appId: "1:769719350730:web:de3ab74f677ad0a1bacb33",
  measurementId: "G-QRFSEBDV96"
};

// Nombre de la tienda a usar cuando no viene ?tienda= en la URL.
// Útil para probar en local sin tener que armar el link completo.
export const TIENDA_POR_DEFECTO = "demo";

// Contraseña del super-admin (para crear/gestionar verdulerías más adelante).
// Cada verdulería además tiene su propio "adminPassword" guardado en su
// documento de Firestore (verdulerias/{tiendaId}.adminPassword).
export const SUPERADMIN_PASSWORD = "Seba1357";
