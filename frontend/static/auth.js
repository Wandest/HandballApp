// DATEI: frontend/static/auth.js (KORRIGIERT: Login-Endpunkt auf /auth/token)

/**
 * Enthält die gesamte Login- und Registrierungslogik für index.html.
 * Inklusive Fix für das View-Wechsel-Problem.
 */

// --- View Management & Global State ---
const checkView = document.getElementById('username-check-view');
const loginView = document.getElementById('login-view');
const registerView = document.getElementById('register-view');

const usernameInput = document.getElementById('username-input');
const usernameRegInput = document.getElementById('username-reg');
const usernameIcon = document.getElementById('username-icon');
const emailRegInput = document.getElementById('email-reg');
const emailIcon = document.getElementById('email-icon');
const matchIcon = document.getElementById('match-icon');
const usernameRegStatusDiv = document.getElementById('username-reg-status');
const passwordRequirementsDiv = document.getElementById('password-requirements');
const termsCheckbox = document.getElementById('terms-checkbox'); 
const messageCheckDiv = document.getElementById('message-check');
const messageLoginDiv = document.getElementById('message-login');
const messageRegDiv = document.getElementById('message-reg');
const checkHeader = document.getElementById('check-header');
const checkInfo = document.getElementById('check-info');

let currentIdentifier = ''; 
let isUsernameAvailable = false;
let isEmailAvailable = false;
let arePasswordsValid = false; 
let loginMode = 'trainer'; // Standard-Modus ist Trainer

// --- Hilfsfunktion: Button-Status aktualisieren ---
function updateRegisterButtonState() {
    const button = document.getElementById('register-button');
    if (button) {
         button.disabled = !(arePasswordsValid && isUsernameAvailable && isEmailAvailable && termsCheckbox.checked);
    }
}

// --- View-Steuerung ---
function showView(viewId, isPlayer = false) {
    checkView.style.display = 'none';
    loginView.style.display = 'none';
    registerView.style.display = 'none';
    document.getElementById(viewId).style.display = 'block';
    
    if (viewId === 'login-view') {
        const headerText = isPlayer ? 'Spieler-Login' : 'Trainer-Login';
        document.getElementById('login-header').textContent = headerText;
        
        if (isPlayer) {
             document.getElementById('password-login').placeholder = 'Passwort für ' + currentIdentifier;
        } else {
             document.getElementById('password-login').placeholder = 'Passwort';
        }
    }
    
    messageCheckDiv.textContent = '';
    messageLoginDiv.textContent = '';
    messageRegDiv.textContent = '';
}

function showUsernameCheckView() {
    showView('username-check-view');
    document.getElementById('password-login').value = '';
    document.getElementById('register-form').reset();
    
    // Stellt sicher, dass der aktuelle Modus visuell aktiv ist
    document.getElementById('mode-trainer').classList.remove('active');
    document.getElementById('mode-player').classList.remove('active');
    document.getElementById(`mode-${loginMode}`).classList.add('active');
}
// MUSS GLOBAL SEIN, da es von index.html aufgerufen wird.
window.showUsernameCheckView = showUsernameCheckView; 

function showLoginView(isPlayer = false) {
    showView('login-view', isPlayer);
}

function showRegisterView() {
    if (usernameInput.value.trim() !== '') {
        const checkedIdentifier = usernameInput.value.trim();
        usernameRegInput.value = checkedIdentifier; 
        currentIdentifier = checkedIdentifier;
    }

    showView('register-view');
    document.getElementById('register-header').textContent = `Registrieren für ${currentIdentifier}`;
    
    checkRegistrationUsernameAvailability(true);
    checkEmailAvailability(true);
    validatePassword();
}

// --- Login Modus Wechsel ---
function switchLoginMode(mode) {
    loginMode = mode;
    document.getElementById('mode-trainer').classList.remove('active');
    document.getElementById('mode-player').classList.remove('active');
    document.getElementById(`mode-${mode}`).classList.add('active');
    
    // UI anpassen
    if (mode === 'trainer') {
        checkHeader.textContent = 'Trainer-Login';
        checkInfo.innerHTML = '(Trainer: Benutzername oder E-Mail / Spieler: Nur E-Mail)';
        usernameInput.placeholder = 'Benutzername oder E-Mail';
        document.getElementById('check-button').textContent = 'Weiter';
    } else {
        checkHeader.textContent = 'Spieler-Login';
        checkInfo.innerHTML = '(Nur E-Mail-Adresse erlaubt)';
        usernameInput.placeholder = 'E-Mail-Adresse';
        document.getElementById('check-button').textContent = 'Login';
    }
    
    showUsernameCheckView(); // Reset zur Identifikationsprüfung
}
window.switchLoginMode = switchLoginMode; // Global machen

// --- 1. USERNAME CHECK FORM (Hybrider Check) ---
document.getElementById('username-check-form').addEventListener('submit', async function(event) {
    event.preventDefault();

    currentIdentifier = usernameInput.value.trim();
    
    const usernameRegex = /^[a-zA-Z0-9]+$/;
    const isEmail = currentIdentifier.includes('@');
    
    // Modus-Validierung (Wiederholung)
    if (loginMode === 'player' && !isEmail) {
         messageCheckDiv.textContent = '❌ Im Spieler-Modus muss eine E-Mail-Adresse verwendet werden.';
         messageCheckDiv.className = 'message error';
         return;
    }
    if (loginMode === 'trainer' && !isEmail && !usernameRegex.test(currentIdentifier)) {
         messageCheckDiv.textContent = '❌ Der Benutzername darf nur Buchstaben und Zahlen enthalten.';
         messageCheckDiv.className = 'message error';
         return; 
    }
    
    messageCheckDiv.textContent = 'Prüfe Identifikation...';
    messageCheckDiv.className = 'message';

    try {
        const response = await fetch('/auth/check-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentIdentifier }),
        });

        const data = await response.json();
        
        if (data.exists) {
            // FALL 1: Benutzer gefunden (Trainer oder Spieler)
            messageCheckDiv.textContent = '';
            
            // FIX: Verwende den aktuellen loginMode, da das Backend den user_type nicht liefert.
            const isPlayer = loginMode === 'player';
            showLoginView(isPlayer); 
            
        } else {
            // FALL 2: Nichts gefunden
            messageCheckDiv.textContent = '';
            
            if (loginMode === 'player') {
                 messageCheckDiv.textContent = '❌ Spieler-Account nicht gefunden. Bitte warten Sie auf eine Einladung durch Ihren Trainer.';
                 messageCheckDiv.className = 'message error';
            } else {
                 usernameRegInput.value = currentIdentifier;
                 showRegisterView();
            }
        }

    } catch (error) {
        messageCheckDiv.textContent = '❌ Serverfehler beim Prüfen der Identifikation.';
        messageCheckDiv.className = 'message error';
        console.error('Error:', error);
    }
});

// --- 2. REGISTRIERUNG: E-MAIL VERFÜGBARKEIT SPRÜFUNG ---
async function checkEmailAvailability() {
    const email = emailRegInput.value;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (email.length < 5 || !emailRegex.test(email)) {
         isEmailAvailable = false;
         emailIcon.innerHTML = email.length > 0 ? '<span style="color: #FF6666;">❌</span>' : '';
         updateRegisterButtonState();
         return;
    }

    emailIcon.innerHTML = '<span style="color: lightgray;">...</span>';

    try {
        const response = await fetch('/auth/check-email-availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email }),
        });
        const data = await response.json();

        if (data.available) {
            isEmailAvailable = true;
            emailIcon.innerHTML = '<span style="color: #38E838;">&#10003;</span>';
        } else {
            isEmailAvailable = false;
            emailIcon.innerHTML = '<span style="color: #FF6666;">❌</span>';
        }
    } catch (error) {
        isEmailAvailable = false;
        emailIcon.innerHTML = '<span style="color: #FF6666;">!</span>';
    }
    updateRegisterButtonState();
}
window.checkEmailAvailability = checkEmailAvailability;

// --- 3. REGISTRIERUNG: USERNAME VERFÜGBARKEITSPRÜFUNG ---
async function checkRegistrationUsernameAvailability(initialLoad = false) {
    const username = usernameRegInput.value;

    const usernameRegex = /^[a-zA-Z0-9]+$/;
    if (!usernameRegex.test(username)) {
        isUsernameAvailable = false;
        usernameIcon.innerHTML = '<span style="color: #FF6666;">!</span>';
        usernameRegStatusDiv.innerHTML = '<span style="color: #FF6666;">❌ Nur Buchstaben und Zahlen erlaubt!</span>';
        updateRegisterButtonState();
        return;
    }

    if (!initialLoad && username === currentIdentifier) {
        isUsernameAvailable = true;
        usernameIcon.innerHTML = '<span style="color: #38E838;">&#10003;</span>';
        usernameRegStatusDiv.innerHTML = '';
        updateRegisterButtonState();
        return;
    }
    
    usernameIcon.innerHTML = '<span style="color: lightgray;">...</span>';
    usernameRegStatusDiv.innerHTML = '<span style="color: lightgray;">Prüfe...</span>';
    currentIdentifier = username;

    try {
        const response = await fetch('/auth/check-availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username }),
        });
        const data = await response.json();

        if (data.available) {
            isUsernameAvailable = true;
            usernameIcon.innerHTML = '<span style="color: #38E838;">&#10003;</span>';
            usernameRegStatusDiv.innerHTML = '';
        } else {
            isUsernameAvailable = false;
            usernameIcon.innerHTML = '<span style="color: #FF6666;">❌</span>';
            let altHtml = '<span style="color: #FF6666;">❌ Schon vergeben. Vorschläge:</span> ';
            
            data.alternatives.forEach(alt => {
                altHtml += `<span class="alternative-link" onclick="setUsername('${alt}')">${alt}</span>`;
            });
            usernameRegStatusDiv.innerHTML = altHtml;
        }
    } catch (error) {
        isUsernameAvailable = false;
        usernameIcon.innerHTML = '<span style="color: #FF6666;">!</span>';
        usernameRegStatusDiv.innerHTML = '<span style="color: #FF6666;">Fehler bei der Prüfung.</span>';
        console.error('Error:', error);
    }
    updateRegisterButtonState();
}
window.checkRegistrationUsernameAvailability = checkRegistrationUsernameAvailability;

// --- 4. PASSWORD VALIDATION ---
const requirements = [
    { id: 'req-length', regex: /.{8,}/, msg: 'Mindestens 8 Zeichen' },
    { id: 'req-upper', regex: /[A-Z]/, msg: 'Mindestens 1 Großbuchstabe' },
    { id: 'req-lower', regex: /[a-z]/, msg: 'Mindestens 1 Kleinbuchstabe' },
    { id: 'req-digit', regex: /\d/, msg: 'Mindestens 1 Ziffer' },
    { id: 'req-special', regex: /[@$!%*?&]/, msg: 'Mindestens 1 Sonderzeichen' }
];

const confirmPasswordField = document.getElementById('confirm-password-reg');
const passwordField = document.getElementById('password-reg');

function validatePassword() {
    if (!passwordField || !confirmPasswordField) return; 

    const password = passwordField.value;
    let allValid = true;
    let htmlContent = ''; 

    requirements.forEach(req => {
        const isValid = req.regex.test(password);
        const statusIcon = isValid ? '&#10003;' : '☐';
        const statusColor = isValid ? '#38E838' : 'lightgray';
        
        htmlContent += `<p style="color: ${statusColor};"><span class="status-icon">${statusIcon}</span> ${req.msg}</p>`;

        if (!isValid) { allValid = false; }
    });
    
    passwordRequirementsDiv.innerHTML = htmlContent;


    const passwordsMatch = password === confirmPasswordField.value && password.length > 0;
    
    arePasswordsValid = allValid && passwordsMatch; 

    if (password.length > 0 && confirmPasswordField.value.length > 0) {
        matchIcon.innerHTML = passwordsMatch ? '<span style="color: #38E838;">&#10003;</span>' : '<span style="color: #FF6666;">❌</span>';
    } else {
        matchIcon.innerHTML = '';
    }

    updateRegisterButtonState(); 
}
window.validatePassword = validatePassword;

function setUsername(newUsername) {
    usernameRegInput.value = newUsername;
    checkRegistrationUsernameAvailability();
}
window.setUsername = setUsername;

window.updateRegisterButtonState = updateRegisterButtonState;


// --- HILFSFUNKTION: Login und Weiterleitung ---
async function loginAndRedirect(identifier, password, messageDiv) {
    try {
        // [KORREKTUR]: Verwendung des korrekten Endpunkts /auth/token
        const response = await fetch('/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: identifier, password: password }),
        });

        if (response.ok) {
            const data = await response.json();
            
            localStorage.setItem('logged_in_user_type', data.user_type);
            localStorage.setItem('logged_in_username', data.username);
            localStorage.setItem('is_verified', data.is_verified);
            
            messageDiv.innerHTML = `✅ Login erfolgreich. Weiterleitung...`;
            messageDiv.className = 'message success';
            
            window.location.href = data.redirect_url; // Nutzt den vom Backend gesendeten Pfad
            
        } else {
            let detail = 'Unbekannter Fehler';
            try {
                const data = await response.json();
                detail = data.detail || `Fehler-Status: ${response.status}`;
            } catch (e) {
                detail = `Server-Fehler: ${response.status} ${response.statusText}`;
            }

            if (messageDiv.id === 'message-reg') {
                messageDiv.innerHTML = `⚠️ Registrierung war erfolgreich, aber Auto-Login fehlgeschlagen: ${detail}. Bitte manuell einloggen.`;
                messageDiv.className = 'message error';
                // Wichtig: Spieler-Login wird über den /auth/login Endpunkt selbst entschieden
                showLoginView(false); 
                document.getElementById('password-login').value = password;
            } else {
                messageDiv.innerHTML = `❌ ${detail}`;
                messageDiv.className = 'message error';
            }
        }

    } catch (error) {
        messageDiv.textContent = '❌ Netzwerkfehler oder Server nicht erreichbar.';
        messageDiv.className = 'message error';
        console.error('Error:', error);
    }
}


// --- 5. REGISTRATION SUBMISSION ---
document.getElementById('register-form').addEventListener('submit', async function(event) {
    event.preventDefault();
    
    const registerButton = document.getElementById('register-button');
    if (registerButton.disabled) {
        messageRegDiv.textContent = '❌ Bitte stellen Sie sicher, dass alle Anforderungen erfüllt sind.';
        messageRegDiv.className = 'message error';
        return;
    }

    if (!isUsernameAvailable || !isEmailAvailable || !arePasswordsValid || !termsCheckbox.checked) {
        messageRegDiv.textContent = '❌ Validierungsfehler. Prüfen Sie alle Felder und akzeptieren Sie die AGB.';
        messageRegDiv.className = 'message error';
        return;
    }
    
    const email = document.getElementById('email-reg').value;
    const password = document.getElementById('password-reg').value;

    messageRegDiv.textContent = 'Registriere...';
    messageRegDiv.className = 'message';
    
    try {
        const response = await fetch('/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username: currentIdentifier, 
                email: email, 
                password: password 
            }),
        });

        if (response.ok) {
            messageRegDiv.textContent = '✅ Registrierung erfolgreich. Logge automatisch ein...';
            await loginAndRedirect(currentIdentifier, password, messageRegDiv);
            
        } else {
            const data = await response.json(); 
            let detail = data.detail || 'Unbekannter Fehler';

            if (data.detail && typeof data.detail === 'string') {
                if (data.detail.includes("value_error")) {
                     try {
                        detail = data.detail.split("value_error, msg='")[1].split("',")[0] || 'Validierungsfehler auf dem Server';
                     } catch (e) {
                        detail = "Passwortanforderungen nicht erfüllt.";
                     }
                }
            } else if (Array.isArray(data.detail) && data.detail[0].msg) {
                detail = data.detail[0].msg;
            }
            
            messageRegDiv.textContent = `❌ Fehler: ${detail}`;
            messageRegDiv.className = 'message error';
        }

    } catch (error) {
        messageRegDiv.textContent = '❌ Serverfehler bei der Registrierung (Netzwerk oder JSON-Parsing).';
        messageRegDiv.className = 'message error';
        console.error('Error:', error);
    }
});


// --- 6. LOGIN LOGIK ---
document.getElementById('login-form').addEventListener('submit', async function(event) {
    event.preventDefault();

    const password = document.getElementById('password-login').value;
    
    messageLoginDiv.textContent = 'Logge ein...';
    messageLoginDiv.className = 'message';
    
    await loginAndRedirect(currentIdentifier, password, messageLoginDiv);
});

// --- Initialisierung ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialisiere mit Trainer-Modus beim Laden der Seite
    switchLoginMode('trainer'); 
    
    // Verknüpfung für den Link
    window.showUsernameCheckView = showUsernameCheckView;
});