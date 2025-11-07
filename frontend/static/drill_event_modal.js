// DATEI: frontend/static/drill_event_modal.js
// +++ NEU: Logik für das Modal zur Anzeige des Trainingsplans +++

(function() {
    
    // DOM-Elemente
    var drillViewModal, drillViewModalTitle, drillViewEventTitle, drillViewSummary, drillViewList, drillViewMessage;
    
    // Cache (Zugriff auf die globalen Caches aus calendar.js)
    // Werden beim Aufruf von showDrillViewModal aktualisiert.

    // ==================================================
    // --- H I L F S F U N K T I O N E N ---
    // ==================================================

    function getDrillsByIds(ids) {
        if (!ids || ids.length === 0) return [];
        
        const allDrillsCache = window.allDrillsCache || [];
        if (allDrillsCache.length === 0) {
             return [];
        }
        
        const drillMap = new Map();
        allDrillsCache.forEach(drill => {
            drillMap.set(drill.id, drill);
        });

        return ids.map(id => drillMap.get(id)).filter(drill => drill);
    }
    
    // ==================================================
    // --- M O D A L - L O G I K ---
    // ==================================================

    function showDrillViewModal(eventId, eventTitle) {
        if (!drillViewModal) return;
        
        const allEventsCache = window.allEventsCache || [];
        
        const event = allEventsCache.find(e => e.id === eventId);
        if (!event || event.event_type !== 'Training') return;

        drillViewEventTitle.textContent = eventTitle;
        drillViewMessage.textContent = '';
        drillViewList.innerHTML = '';
        
        const assignedDrills = getDrillsByIds(event.planned_drill_ids);
        
        // Zusammenfassung berechnen
        let totalDuration = 0;
        assignedDrills.forEach(d => {
            totalDuration += d.duration_minutes || 0;
        });
        drillViewSummary.textContent = `Zugewiesene Übungen: ${assignedDrills.length} | Geschätzte Dauer: ${totalDuration} min`;
        
        if (assignedDrills.length === 0) {
            drillViewList.innerHTML = '<p style="opacity: 0.6; text-align: center;">Keine Übungen zugewiesen.</p>';
        } else {
            renderDrillViewList(assignedDrills);
        }

        drillViewModal.style.display = 'block';
    }
    window.showDrillViewModal = showDrillViewModal;


    function renderDrillViewList(drills) {
        // Sicherstellen, dass das Drill Modal von drills.js geladen ist
        if (typeof window.openViewModal !== 'function') {
             drillViewMessage.textContent = "Fehler: Die Übungs-DB-Logik ist nicht geladen.";
             drillViewMessage.className = 'message error';
             return;
        }

        drills.forEach(drill => {
            const item = document.createElement('div');
            item.className = 'drill-view-item';
            
            const duration = drill.duration_minutes ? `${drill.duration_minutes} min` : 'N/A';
            const category = drill.category_name || 'Ohne Kategorie';
            
            // JSON für die Übergabe an das Drill-Modal escapen
            const drillJsonString = JSON.stringify(drill).replace(/'/g, "\\'");

            item.innerHTML = `
                <strong>${drill.title}</strong>
                <span>Kategorie: ${category} | Dauer: ${duration}</span>
                <button class="btn btn-secondary btn-inline" 
                        onclick="window.openViewModal(JSON.parse(decodeURIComponent('${encodeURIComponent(drillJsonString)}')))">
                    Details ansehen
                </button>
            `;
            drillViewList.appendChild(item);
        });
    }

    function closeDrillViewModal() {
        if (drillViewModal) drillViewModal.style.display = 'none';
    }
    window.closeDrillViewModal = closeDrillViewModal;
    
    // ==================================================
    // --- I N I T I A L I S I E R U N G ---
    // ==================================================

    function initDrillEventModal() {
        drillViewModal = document.getElementById('drill-view-modal');
        drillViewModalTitle = document.getElementById('drill-view-modal-title');
        drillViewEventTitle = document.getElementById('drill-view-event-title');
        drillViewSummary = document.getElementById('drill-view-summary');
        drillViewList = document.getElementById('drill-view-list');
        drillViewMessage = document.getElementById('drill-view-message');
        
        // Modal-Schließen Event
        if(drillViewModal) {
            drillViewModal.addEventListener('click', function(event) {
                if (event.target === drillViewModal || event.target.closest('.close-btn')) {
                    closeDrillViewModal();
                }
            });
        }
    }

    document.addEventListener('DOMContentLoaded', initDrillEventModal);
    
})(); // ENDE IIFE