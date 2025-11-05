// DATEI: frontend/static/global.js

/**
 * Enthält globale Funktionen, die von allen Seiten benötigt werden (Logout, Toast, Verifizierung).
 * Wird in app_layout.html geladen.
 */

// --- Globale Navigations- und Token-Logik ---

function updateNavLinks() {
    document.querySelectorAll('.nav-link').forEach(link => {
        const url = new URL(link.href);
        if (url.pathname === window.location.pathname) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

function logout() {
    fetch('/auth/logout', { 
        method: 'POST' 
    })
    .finally(() => {
        // Cleanup localStorage
        localStorage.removeItem('is_verified');
        localStorage.removeItem('selected_team_id');
        localStorage.removeItem('selected_team_name');
        // Redirect to login page
        window.location.href = "/"; 
    });
}

// --- Globale Verifizierungs- und Toast-Logik ---

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast-message');
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    
    // Entferne die Show-Klasse nach 3 Sekunden
    setTimeout(() => {
        if (toast.classList.contains('show')) {
            toast.className = toast.className.replace('show', '').trim();
        }
    }, 3000);
}

function checkVerification() {
    // Ruft den Status aus dem localStorage ab, der von app_layout.html gesetzt wird.
    const currentIsVerified = localStorage.getItem('is_verified') === 'true';

    if (currentIsVerified) {
        return true;
    } else {
        showToast("Bitte verifiziere dein Konto, um diese Aktion auszuführen.", "error");
        return false;
    }
}

// Initialer Aufruf
document.addEventListener('DOMContentLoaded', () => {
    updateNavLinks();
    
    // Style-Fix für Buttons in Formularen
    document.querySelectorAll('form .btn').forEach(btn => {
        if (!btn.classList.contains('btn-inline') && !btn.classList.contains('btn-inline-delete')) {
            btn.classList.add('btn-full-width');
        }
    });
});