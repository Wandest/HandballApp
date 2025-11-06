// DATEI: frontend/static/video_cutter.js

/**
 * Verantwortlichkeit: Enthält die gesamte Logik zur Steuerung des YouTube-Players
 * und zur Wiedergabe von Video-Clips (Playlist). Wird von player_stats.js und trainer_stats.js importiert.
 */

// Globale Variablen für den Player (müssen außerhalb der Kapselung verfügbar sein)
var cutterPlayer = null; 
var cutterPlayerReady = false; 

// Initialisierung der YouTube API (muss global sein)
function onYouTubeIframeAPIReady() {
    cutterPlayerReady = true; 
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;


(function() {
    
    // Private Variablen
    var activePlaylistItem = null; 
    var lastLoadedVideoId = null; 

    // DOM-Elemente
    var cutterVideoTitle;
    var cutterYouTubePlayerEl;


    // ==================================================
    // --- H I L F S F U N K T I O N E N ---
    // ==================================================
    
    // YouTube Video-ID Extraktion
    function getYouTubeId(url) {
        if (!url) return null;
        // Unterstützt Standard-URLs, Kurzlinks und Embeds
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }
    
    // Konvertiert MM:SS oder HH:MM:SS in Sekunden
    function timeToSeconds(timeStr) {
        if (!timeStr) return 0;
        const parts = timeStr.split(':').map(Number);
        let seconds = 0;
        if (parts.length === 3) { // HH:MM:SS
            seconds += parts[0] * 3600;
            seconds += parts[1] * 60;
            seconds += parts[2];
        } else if (parts.length === 2) { // MM:SS
            seconds += parts[0] * 60;
            seconds += parts[1];
        }
        return seconds;
    }
    
    // Globale Toast-Funktion, falls nicht bereits vorhanden
    function showToast(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        } else {
            console.warn("showToast not global:", message);
        }
    }


    // ==================================================
    // --- Ö F F E N T L I C H E   F U N K T I O N E N ---
    // ==================================================
    
    /**
     * Initialisiert die DOM-Elemente einmalig. Muss VOR playCut aufgerufen werden.
     */
    function initVideoCutter() {
        cutterVideoTitle = document.getElementById('cutter-video-title');
        cutterYouTubePlayerEl = document.getElementById('cutter-youtube-player'); 
    }
    window.initVideoCutter = initVideoCutter;


    /**
     * Erstellt den Player neu oder springt zur Szene.
     * @param {object} item - Das ActionPlaylistResponse-Objekt aus dem Backend.
     */
    function playCut(item) {
        if (!item || !cutterVideoTitle || !cutterYouTubePlayerEl) return;
        
        const videoId = getYouTubeId(item.game_video_url);
        if (!videoId) {
            showToast("Keine gültige Video-URL für dieses Spiel.", "error");
            return;
        }

        // 1. Player laden/erstellen, falls nötig
        if (videoId !== lastLoadedVideoId) {
            if (cutterPlayerReady) {
                // Erstelle Player
                if (cutterPlayer) {
                    cutterPlayer.destroy();
                }
                cutterYouTubePlayerEl.innerHTML = ''; 
                cutterPlayer = new YT.Player('cutter-youtube-player', {
                    height: '100%',
                    width: '100%',
                    videoId: videoId,
                    playerVars: { 'playsinline': 1, 'controls': 1 },
                });
            } else {
                showToast("YouTube-Player wird noch geladen...", "error");
                // Versuche es später erneut
                setTimeout(() => playCut(item), 500);
                return;
            }
            lastLoadedVideoId = videoId;
            cutterVideoTitle.textContent = `Spiel: vs. ${item.game_opponent}`;
        }
        
        // 2. Zur Startzeit springen und abspielen
        const startTime = timeToSeconds(item.video_timestamp);
        
        if (cutterPlayer && typeof cutterPlayer.seekTo === 'function') {
            cutterPlayer.seekTo(startTime, true);
            cutterPlayer.playVideo();
            
            // 3. Playlist-Eintrag hervorheben
            if (activePlaylistItem) {
                activePlaylistItem.classList.remove('active');
            }
            activePlaylistItem = document.getElementById(`playlist-item-${item.id}`);
            if (activePlaylistItem) {
                activePlaylistItem.classList.add('active');
            }
        } else if (cutterPlayer && cutterPlayer.loadVideoById) {
             // Warte auf Ready-State, falls der Player noch lädt
             cutterPlayer.addEventListener('onReady', () => {
                 cutterPlayer.seekTo(startTime, true);
                 cutterPlayer.playVideo();
             });
        }
    }
    window.playCut = playCut;


    // Stellt die Initialisierung sicher, sobald das DOM geladen ist
    document.addEventListener('DOMContentLoaded', initVideoCutter);
    
})(); // ENDE IIFE