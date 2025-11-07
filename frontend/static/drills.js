// DATEI: frontend/static/drills.js
// +++ NEU: Logik für "Ansehen"-Modal (openViewModal) inkl. YouTube-Embed +++

(function() {
    
    // Globale Variablen
    var selectedTeamId = localStorage.getItem('selected_team_id');
    var selectedTeamName = localStorage.getItem('selected_team_name');
    var allDrillsCache = [];
    var allCategoriesCache = [];
    var currentFilterCategoryId = 'all'; // Standard: Zeige alle

    // DOM-Elemente
    var drillsTeamName, drillListContainer;
    var categoryListContainer, addCategoryForm, categoryNameInput, categoryMessage;
    
    // Modal-Elemente (Erstellen/Bearbeiten)
    var drillModal, drillModalTitle, drillForm, drillIdInput, drillTitleInput, drillCategorySelect, drillDurationInput, drillMediaUrlInput, drillDescriptionInput, drillMessage;
    
    // NEU: Modal-Elemente (Ansehen)
    var viewDrillModal, viewDrillTitle, viewDrillMeta, viewDrillVideoContainer, viewDrillIframe, viewDrillLinkContainer, viewDrillLink, viewDrillDescription;


    // ==================================================
    // --- H I L F S F U N K T I O N E N ---
    // ==================================================

    function showToast(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        } else {
            console.warn("showToast not global:", message);
        }
    }
    
    function logout() {
        if (typeof window.logout === 'function') {
            window.logout();
        } else {
             window.location.href = "/";
        }
    }
    
    function checkVerification() {
         if (typeof window.checkVerification === 'function') {
            return window.checkVerification();
        }
        return true; 
    }
    
    // NEU: YouTube Video-ID Extraktion (aus video_cutter.js kopiert)
    function getYouTubeId(url) {
        if (!url) return null;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }
    
    // ==================================================
    // --- K A T E G O R I E N (Laden & Erstellen) ---
    // ==================================================

    async function loadCategories() {
        if (!selectedTeamId || !categoryListContainer) return;
        
        categoryListContainer.innerHTML = '<p style="opacity: 0.6; font-size: 0.9em;">Lade...</p>';
        drillCategorySelect.innerHTML = '<option value="">(Keine Kategorie)</option>'; 

        try {
            const response = await fetch(`/drills/categories/list/${selectedTeamId}`);
            if (response.status === 401) { logout(); return; }
            if (!response.ok) throw new Error('Kategorien konnten nicht geladen werden.');
            
            allCategoriesCache = await response.json();
            
            categoryListContainer.innerHTML = ''; 
            
            const allItem = document.createElement('li');
            allItem.className = 'category-item active'; 
            allItem.textContent = 'Alle Übungen';
            allItem.id = 'category-filter-all';
            allItem.onclick = () => filterDrillsByCategory('all');
            categoryListContainer.appendChild(allItem);

            if (allCategoriesCache.length > 0) {
                allCategoriesCache.forEach(cat => {
                    // 1. Zum Filter-Menü hinzufügen
                    const item = document.createElement('li');
                    item.className = 'category-item';
                    item.textContent = cat.name;
                    item.id = `category-filter-${cat.id}`;
                    item.onclick = () => filterDrillsByCategory(cat.id);
                    
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'category-delete-btn';
                    deleteBtn.innerHTML = '&times;';
                    deleteBtn.title = 'Kategorie löschen';
                    deleteBtn.onclick = (e) => {
                        e.stopPropagation(); 
                        deleteCategory(cat.id, cat.name);
                    };
                    item.appendChild(deleteBtn);
                    categoryListContainer.appendChild(item);
                    
                    // 2. Zum Modal-Dropdown hinzufügen
                    const option = document.createElement('option');
                    option.value = cat.id;
                    option.textContent = cat.name;
                    drillCategorySelect.appendChild(option);
                });
            }

        } catch (error) {
            categoryMessage.textContent = `❌ ${error.message}`;
            categoryMessage.className = 'message error';
        }
    }

    async function handleAddCategory(event) {
        event.preventDefault();
        if (!checkVerification() || !selectedTeamId) return;
        
        const categoryName = categoryNameInput.value.trim();
        if (!categoryName) {
            categoryMessage.textContent = '❌ Name darf nicht leer sein.';
            categoryMessage.className = 'message error';
            return;
        }
        
        categoryMessage.textContent = 'Speichere Kategorie...';
        categoryMessage.className = 'message';
        
        try {
            const response = await fetch('/drills/categories/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: categoryName, team_id: parseInt(selectedTeamId) })
            });
            
            if (response.status === 401) { logout(); return; }
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'Fehler beim Erstellen.');
            
            categoryMessage.textContent = '✅ Kategorie erstellt.';
            categoryMessage.className = 'message success';
            addCategoryForm.reset();
            loadCategories(); 

        } catch (error) {
            categoryMessage.textContent = `❌ ${error.message}`;
            categoryMessage.className = 'message error';
        }
    }
    
    async function deleteCategory(categoryId, categoryName) {
        if (!checkVerification()) return;
        if (!confirm(`Sicher, dass die Kategorie "${categoryName}" gelöscht werden soll? (Übungen in dieser Kategorie verlieren die Zuordnung).`)) return;

        try {
            const response = await fetch(`/drills/categories/delete/${categoryId}`, {
                method: 'DELETE'
            });
            
            if (response.status === 401) { logout(); return; }
            if (response.status === 204) {
                 showToast("Kategorie gelöscht.", "success");
                 loadCategories(); 
                 loadDrills(); 
            } else {
                 const data = await response.json();
                 throw new Error(data.detail || 'Fehler beim Löschen.');
            }
        } catch (error) {
            showToast(`❌ ${error.message}`, "error");
        }
    }


    // ==================================================
    // --- Ü B U N G E N (CRUD & Modal) ---
    // ==================================================

    function closeDrillModal() {
        drillModal.style.display = 'none';
        drillForm.reset();
        drillIdInput.value = '';
    }
    window.closeDrillModal = closeDrillModal;

    function openDrillModal(drill) {
        drillForm.reset();
        drillMessage.textContent = '';
        drillMessage.className = 'message';
        
        if (drill) {
            // Bearbeiten-Modus
            drillModalTitle.textContent = 'Übung bearbeiten';
            drillIdInput.value = drill.id;
            drillTitleInput.value = drill.title;
            drillCategorySelect.value = drill.category_id || '';
            drillDurationInput.value = drill.duration_minutes || '';
            drillMediaUrlInput.value = drill.media_url || '';
            drillDescriptionInput.value = drill.description || '';
        } else {
            // Erstellen-Modus
            drillModalTitle.textContent = 'Neue Übung erstellen';
            drillIdInput.value = '';
            if (currentFilterCategoryId !== 'all') {
                drillCategorySelect.value = currentFilterCategoryId;
            }
        }
        
        drillModal.style.display = 'block';
    }
    window.openDrillModal = openDrillModal; 

    // NEU: "Ansehen"-Modal öffnen
    function openViewModal(drill) {
        if (!drill) return;
        
        viewDrillTitle.textContent = drill.title;
        viewDrillDescription.textContent = drill.description || 'Keine Beschreibung vorhanden.';
        
        const categoryName = drill.category_name || 'Ohne Kategorie';
        const duration = drill.duration_minutes ? `${drill.duration_minutes} min` : 'Keine Dauer';
        viewDrillMeta.textContent = `Kategorie: ${categoryName} | Dauer: ${duration}`;
        
        // Video/Link-Handling
        const youtubeId = getYouTubeId(drill.media_url);
        
        if (youtubeId) {
            // Es ist ein YouTube-Link -> Iframe einbetten
            viewDrillIframe.src = `https://www.youtube.com/embed/${youtubeId}`;
            viewDrillVideoContainer.style.display = 'block';
            viewDrillLinkContainer.style.display = 'none';
        } else if (drill.media_url) {
            // Es ist ein anderer Link
            viewDrillLink.href = drill.media_url;
            viewDrillLinkContainer.style.display = 'block';
            viewDrillVideoContainer.style.display = 'none';
            viewDrillIframe.src = ''; // Iframe leeren
        } else {
            // Kein Medium
            viewDrillVideoContainer.style.display = 'none';
            viewDrillLinkContainer.style.display = 'none';
            viewDrillIframe.src = ''; // Iframe leeren
        }
        
        viewDrillModal.style.display = 'block';
    }
    window.openViewModal = openViewModal; // Global machen
    
    // NEU: "Ansehen"-Modal schließen (wichtig, um Video zu stoppen)
    function closeViewModal() {
        viewDrillModal.style.display = 'none';
        viewDrillIframe.src = ''; // Stoppt das YouTube-Video
    }
    window.closeViewModal = closeViewModal; // Global machen


    async function handleSaveDrill(event) {
        event.preventDefault();
        if (!checkVerification() || !selectedTeamId) return;

        const drillId = drillIdInput.value;
        const isUpdate = !!drillId;
        
        const url = isUpdate ? `/drills/update/${drillId}` : '/drills/add';
        const method = isUpdate ? 'PUT' : 'POST';

        const payload = {
            title: drillTitleInput.value,
            description: drillDescriptionInput.value || null,
            duration_minutes: parseInt(drillDurationInput.value) || null,
            media_url: drillMediaUrlInput.value || null,
            category_id: parseInt(drillCategorySelect.value) || null,
            team_id: parseInt(selectedTeamId) 
        };

        drillMessage.textContent = 'Speichere Übung...';
        drillMessage.className = 'message';
        
        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (response.status === 401) { logout(); return; }
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'Fehler beim Speichern.');

            showToast(`✅ Übung "${data.title}" gespeichert.`, "success");
            closeDrillModal();
            loadDrills(); 

        } catch (error) {
            drillMessage.textContent = `❌ ${error.message}`;
            drillMessage.className = 'message error';
        }
    }
    
    async function deleteDrill(drillId, drillTitle) {
        if (!checkVerification()) return;
        if (!confirm(`Sicher, dass die Übung "${drillTitle}" gelöscht werden soll?`)) return;
        
        try {
            const response = await fetch(`/drills/delete/${drillId}`, {
                method: 'DELETE'
            });
            
            if (response.status === 401) { logout(); return; }
            if (response.status === 204) {
                 showToast("Übung gelöscht.", "success");
                 loadDrills(); 
            } else {
                 const data = await response.json();
                 throw new Error(data.detail || 'Fehler beim Löschen.');
            }
        } catch (error) {
            showToast(`❌ ${error.message}`, "error");
        }
    }
    window.deleteDrill = deleteDrill; 

    // ==================================================
    // --- Ü B U N G E N (Laden & Filtern) ---
    // ==================================================
    
    async function loadDrills() {
        if (!selectedTeamId || !drillListContainer) return;
        
        drillListContainer.innerHTML = '<p style="opacity: 0.6;">Lade Übungen...</p>';
        
        try {
            const response = await fetch(`/drills/list/${selectedTeamId}`);
            if (response.status === 401) { logout(); return; }
            if (!response.ok) throw new Error('Übungen konnten nicht geladen werden.');
            
            allDrillsCache = await response.json();
            renderDrills(currentFilterCategoryId); 

        } catch (error) {
            drillListContainer.innerHTML = `<p class="error">❌ ${error.message}</p>`;
        }
    }
    
    function filterDrillsByCategory(categoryId) {
        currentFilterCategoryId = categoryId;
        
        document.querySelectorAll('.category-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeTab = document.getElementById(`category-filter-${categoryId}`);
        if (activeTab) {
            activeTab.classList.add('active');
        }
        
        renderDrills(categoryId);
    }
    window.filterDrillsByCategory = filterDrillsByCategory; 

    function renderDrills(categoryId) {
        drillListContainer.innerHTML = '';
        
        let filteredDrills = allDrillsCache;
        
        if (categoryId !== 'all') {
            filteredDrills = allDrillsCache.filter(drill => drill.category_id === categoryId);
        }
        
        if (filteredDrills.length === 0) {
            drillListContainer.innerHTML = '<p style="opacity: 0.6;">Keine Übungen für diese Kategorie gefunden.</p>';
            return;
        }

        filteredDrills.forEach(drill => {
            const card = document.createElement('div');
            card.className = 'drill-card';
            
            const categoryName = drill.category_name || 'Ohne Kategorie';
            const duration = drill.duration_minutes ? `${drill.duration_minutes} min` : 'Keine Dauer';
            
            let mediaLink = '';
            if (drill.media_url) {
                if (getYouTubeId(drill.media_url)) {
                    mediaLink = `▶️ Enthält Video`;
                } else {
                    mediaLink = `🔗 Enthält Link`;
                }
            }

            card.innerHTML = `
                <div class="drill-card-content">
                    <h4>${drill.title}</h4>
                    <p>${drill.description || 'Keine Beschreibung.'}</p>
                    <p class="drill-meta">${categoryName} | ${duration}</p>
                    <p style="color: #ffcc00; font-weight: bold;">${mediaLink}</p>
                </div>
                <div class="drill-card-actions">
                    <button class="btn btn-info" onclick="openViewModal(JSON.parse(decodeURIComponent('${encodeURIComponent(JSON.stringify(drill))}')))">Ansehen</button>
                    <button class="btn btn-secondary" onclick="openDrillModal(JSON.parse(decodeURIComponent('${encodeURIComponent(JSON.stringify(drill))}')))">Bearbeiten</button>
                    <button class="btn btn-danger" onclick="deleteDrill(${drill.id}, '${drill.title.replace(/'/g, "\\'")}')">Löschen</button>
                </div>
            `;
            drillListContainer.appendChild(card);
        });
    }


    // ==================================================
    // --- I N I T I A L I S I E R U N G ---
    // ==================================================
    function initDrillsDb() {
        // DOM-Zuweisung
        drillsTeamName = document.getElementById('drills-team-name');
        drillListContainer = document.getElementById('drill-list-container');
        categoryListContainer = document.getElementById('drill-categories-list');
        addCategoryForm = document.getElementById('add-category-form');
        categoryNameInput = document.getElementById('category-name');
        categoryMessage = document.getElementById('category-message');
        
        // Modal-DOM (Erstellen/Bearbeiten)
        drillModal = document.getElementById('drill-modal');
        drillModalTitle = document.getElementById('drill-modal-title');
        drillForm = document.getElementById('drill-form');
        drillIdInput = document.getElementById('drill-id');
        drillTitleInput = document.getElementById('drill-title');
        drillCategorySelect = document.getElementById('drill-category');
        drillDurationInput = document.getElementById('drill-duration');
        drillMediaUrlInput = document.getElementById('drill-media-url');
        drillDescriptionInput = document.getElementById('drill-description');
        drillMessage = document.getElementById('drill-message');

        // Modal-DOM (Ansehen)
        viewDrillModal = document.getElementById('view-drill-modal');
        viewDrillTitle = document.getElementById('view-drill-title');
        viewDrillMeta = document.getElementById('view-drill-meta');
        viewDrillVideoContainer = document.getElementById('view-drill-video-container');
        viewDrillIframe = document.getElementById('view-drill-iframe');
        viewDrillLinkContainer = document.getElementById('view-drill-link-container');
        viewDrillLink = document.getElementById('view-drill-link');
        viewDrillDescription = document.getElementById('view-drill-description');
        
        console.log("initDrillsDb() wird aufgerufen.");
        
        if (selectedTeamId && selectedTeamName) {
            drillsTeamName.textContent = selectedTeamName;
            loadCategories().then(() => {
                loadDrills();
            });
        } else {
            drillsTeamName.textContent = "(Team wählen)";
            drillListContainer.innerHTML = '<p style="opacity: 0.6;">Bitte im Team Management ein Team auswählen.</p>';
            categoryListContainer.innerHTML = '<p style="opacity: 0.6; font-size: 0.9em;">Team wählen.</p>';
        }

        // Event Listeners
        if (addCategoryForm) {
            addCategoryForm.addEventListener('submit', handleAddCategory);
        }
        if (drillForm) {
            drillForm.addEventListener('submit', handleSaveDrill);
        }
        
        // Modal-Schließen
        window.addEventListener('click', function(event) {
            if (event.target == drillModal) {
                closeDrillModal();
            }
            if (event.target == viewDrillModal) {
                closeViewModal();
            }
        });
    }

    document.addEventListener('DOMContentLoaded', initDrillsDb);
    
})(); // ENDE IIFE