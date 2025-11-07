// DATEI: frontend/static/tacticboard.js
// +++ KORREKTUR: Finale Stabilisierung der Stempel-Platzierung durch synchrones Zeichnen. +++

(function() {
    
    // DOM-Elemente
    const canvas = document.getElementById('tactic-canvas');
    if (!canvas) { return; }
    const ctx = canvas.getContext('2d');
    const canvasContainer = document.querySelector('.canvas-container'); 
    
    // SVGs
    const svgFull = document.getElementById('field-full');
    const svgHalf = document.getElementById('field-half');
    let activeSvgBackground = svgFull; 

    // Custom Cursor (Für Linien/Radierer/Stempel)
    const customCursor = document.createElement('div');
    customCursor.style.position = 'absolute';
    customCursor.style.pointerEvents = 'none'; 
    customCursor.style.zIndex = '3'; 
    customCursor.style.transform = 'translate(-50%, -50%)'; 
    customCursor.style.display = 'none'; 
    if(canvasContainer) canvasContainer.appendChild(customCursor); 
    
    // Werkzeug-Buttons (Korrigierte DOM-Referenzen)
    const toolPen = document.getElementById('tool-pen');
    const toolDashed = document.getElementById('tool-dashed');
    const toolArrow = document.getElementById('tool-arrow');
    const toolEraser = document.getElementById('tool-eraser');
    
    const toolStampX = document.getElementById('tool-player');
    const toolStampO = document.getElementById('tool-opponent');
    const toolStampBall = document.getElementById('tool-ball');

    const toolUndo = document.getElementById('tool-undo');
    const toolClear = document.getElementById('tool-clear');
    const toolExport = document.getElementById('tool-export');
    const strokeWidthSlider = document.getElementById('stroke-width-slider');
    const strokeWidthLabelStart = document.getElementById('stroke-width-label-start');
    const colorSwatchesContainer = document.querySelector('.color-swatches');
    
    // Feld-Umschalter
    const toolFieldFull = document.getElementById('tool-field-full');
    const toolFieldHalf = document.getElementById('tool-field-half');
    
    // Nummerierte Spieler
    const toolPlayerNumButton = document.getElementById('tool-player-num'); 
    const playerNumberInput = document.getElementById('player-number-input');
    
    // Animations-Buttons
    const frameCounter = document.getElementById('frame-counter');
    const toolPrevFrame = document.getElementById('tool-prev-frame');
    const toolNextFrame = document.getElementById('tool-next-frame');
    const toolPlay = document.getElementById('tool-play');
    const toolPause = document.getElementById('tool-pause');
    const toolNewFrame = document.getElementById('tool-new-frame');
    const toolDeleteFrame = document.getElementById('tool-delete-frame');
    
    // Liste aller Buttons, die den aktiven Zustand haben können
    const allToolButtons = [
        toolPen, toolDashed, toolArrow, toolEraser, 
        toolStampX, toolStampO, toolStampBall, toolPlayerNumButton
    ];

    // Zustand
    let isDrawing = false;
    let currentTool = 'pen'; 
    let currentStrokeWidth = 4;
    let currentColor = '#FF0000'; 
    let playerNumToolColor = '#FF0000'; 
    let startPos = { x: 0, y: 0 };
    
    // Animation/History
    let frames = []; 
    let currentFrameIndex = 0; 
    let undoHistory = []; 
    let undoStep = -1;
    let animationInterval = null;

    let movableObjects = []; 

    // ==================================================
    // --- Tool-Auswahl & Zustand-Management ---
    // ==================================================

    function selectTool(toolName) {
        currentTool = toolName;
        
        allToolButtons.forEach(btn => {
            if (btn) btn.classList.remove('active');
        });

        // Aktiven Tool-Button hervorheben
        if (toolName === 'pen') toolPen.classList.add('active');
        if (toolName === 'dashed') toolDashed.classList.add('active');
        if (toolName === 'arrow') toolArrow.classList.add('active');
        if (toolName === 'eraser') toolEraser.classList.add('active');
        if (toolName === 'x') toolStampX.classList.add('active');
        if (toolName === 'o') toolStampO.classList.add('active');
        if (toolName === 'ball') toolStampBall.classList.add('active');
        if (toolName === 'player-num') toolPlayerNumButton.classList.add('active');


        // Cursor-Anpassung
        updateCustomCursorAppearance();
    }
    window.selectTool = selectTool; 

    function selectColor(swatch) {
        colorSwatchesContainer.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        currentColor = swatch.getAttribute('data-color');
        
        playerNumToolColor = currentColor;
        
        updateCustomCursorAppearance();
    }
    window.selectColor = selectColor; 
    
    function updateCustomCursorAppearance() {
        if (!customCursor) return;

        const isDrawingTool = ['eraser', 'pen', 'dashed', 'arrow'].includes(currentTool);
        const isStampTool = ['x', 'o', 'ball', 'player-num'].includes(currentTool);

        if (isDrawingTool || isStampTool) {
            customCursor.style.display = 'block';
            
            if (isDrawingTool) {
                if (currentTool === 'eraser') {
                    customCursor.style.width = `${currentStrokeWidth * 3}px`;
                    customCursor.style.height = `${currentStrokeWidth * 3}px`;
                    customCursor.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
                    customCursor.style.border = '2px dashed #000';
                } else {
                    customCursor.style.width = `${currentStrokeWidth}px`;
                    customCursor.style.height = `${currentStrokeWidth}px`;
                    customCursor.style.backgroundColor = currentColor;
                    customCursor.style.border = '2px solid rgba(255, 255, 255, 0.8)';
                }
            } else if (isStampTool) {
                customCursor.style.width = '20px';
                customCursor.style.height = '20px';
                customCursor.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
                customCursor.style.border = '2px solid #ffcc00';
            }
        } else {
             customCursor.style.display = 'none';
        }
        
        if (strokeWidthLabelStart) strokeWidthLabelStart.textContent = currentStrokeWidth;
    }


    // ==================================================
    // --- Canvas Initialisierung & Resize ---
    // ==================================================

    function resizeCanvas() {
        if (!canvasContainer || !activeSvgBackground) return;
        
        const rect = activeSvgBackground.getBoundingClientRect();
        
        if (rect.width === 0 || rect.height === 0) {
            setTimeout(resizeCanvas, 50);
            return;
        }

        canvas.width = rect.width;
        canvas.height = rect.height;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        drawFrame(currentFrameIndex, true); 
    }
    
    function switchFieldType(type) {
        if (animationInterval) pauseAnimation(); 

        saveUndoHistory();

        if (type === 'full') {
            svgFull.classList.add('active');
            svgHalf.classList.remove('active');
            activeSvgBackground = svgFull; 
            toolFieldFull.classList.add('active');
            toolFieldHalf.classList.remove('active');
        } else {
            svgFull.classList.remove('active');
            svgHalf.classList.add('active');
            activeSvgBackground = svgHalf; 
            toolFieldFull.classList.remove('active');
            toolFieldHalf.classList.add('active');
        }
        
        if (activeSvgBackground.complete && activeSvgBackground.naturalHeight !== 0) {
            resizeCanvas();
            clearAllFrames(true); 
        } else {
            activeSvgBackground.onload = () => {
                resizeCanvas();
                clearAllFrames(true); 
            };
        }
    }


    // ==================================================
    // --- Zeichen- & Stempel-Logik ---
    // ==================================================
    
    function getMousePos(evt) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: evt.clientX - rect.left,
            y: evt.clientY - rect.top
        };
    }
    
    function getTouchPos(evt) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: evt.touches[0].clientX - rect.left,
            y: evt.touches[0].clientY - rect.top
        };
    }

    function updateCursor(e) {
        const pos = e.touches ? getTouchPos(e) : getMousePos(e);
        customCursor.style.left = `${pos.x}px`;
        customCursor.style.top = `${pos.y}px`;
    }

    // WICHTIG: Stempel-Aktion bei Klick
    function handleCanvasClick(e) {
        e.preventDefault();
        if (animationInterval) pauseAnimation();
        
        const pos = e.touches ? getTouchPos(e) : getMousePos(e);

        if (['x', 'o', 'ball', 'player-num'].includes(currentTool)) {
            drawStamp(pos);
            saveUndoHistory();
            selectTool('pen'); 
        }
    }


    function startDrawing(e) {
        e.preventDefault(); 
        if (animationInterval) pauseAnimation();
        
        const pos = e.touches ? getTouchPos(e) : getMousePos(e);
        
        // Drag/Drop Logik entfernt

        // NUR Linien-Tools hier verarbeiten
        if (!['x', 'o', 'ball', 'player-num'].includes(currentTool)) {
            isDrawing = true;
            startPos = pos;
            
            ctx.beginPath();
            ctx.moveTo(startPos.x, startPos.y);
            
            ctx.globalCompositeOperation = currentTool === 'eraser' ? 'destination-out' : 'source-over';
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = currentTool === 'eraser' ? currentStrokeWidth * 3 : currentStrokeWidth;
            ctx.setLineDash(currentTool === 'dashed' ? [10, 10] : []);
        }
    }

    function draw(e) {
        if (!isDrawing) return;
        e.preventDefault(); 
        const pos = e.touches ? getTouchPos(e) : getMousePos(e);

        // Drag/Drop Logik entfernt

        if (currentTool === 'eraser' || currentTool === 'pen' || currentTool === 'dashed') {
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        }
    }

    function stopDrawing(e) {
        if (!isDrawing) return;
        isDrawing = false;
        
        const endPos = e.changedTouches ? getTouchPos(e.changedTouches[0]) : getMousePos(e);

        // Drag/Drop Logik entfernt
        
        if (currentTool === 'arrow' || currentTool === 'pen' || currentTool === 'dashed' || currentTool === 'eraser') {
            
            if (currentTool === 'arrow') {
                 ctx.beginPath();
                 ctx.moveTo(startPos.x, startPos.y);
                 ctx.lineTo(endPos.x, endPos.y);
                 ctx.stroke();
                 drawArrowhead(startPos, endPos, currentColor, currentStrokeWidth);
            }
            
            ctx.beginPath(); // WICHTIG: Setzt den Pfad zurück
        }

        saveUndoHistory();
    }
    
    // checkHitOnObject ist nicht mehr für Drag/Drop nötig
    
    function drawStamp(pos) {
        let objectType;
        let objectColor; 
        let objectNumber;

        if (currentTool === 'ball') {
            objectType = 'ball';
            objectColor = currentColor; 
            objectNumber = '⚽';
        } else if (currentTool === 'player-num') {
            objectType = 'numbered';
            objectColor = playerNumToolColor; 
            objectNumber = playerNumberInput.value;
        } else if (currentTool === 'x' || currentTool === 'o') {
            objectType = 'simple';
            objectColor = currentColor; 
            objectNumber = currentTool.toUpperCase();
        } else {
             return; 
        }

        const newObject = {
            x: pos.x,
            y: pos.y,
            type: objectType,
            color: objectColor,
            number: objectNumber, 
            size: currentStrokeWidth 
        };
        
        movableObjects.push(newObject);
        
        // WICHTIG: Verwende synchrone Funktion für sofortiges Zeichnen (kein forceRedraw nötig)
        drawFrameSynchronous(currentFrameIndex); 
    }
    
    function drawSymbol(obj) {
        const pos = obj;
        const radius = 10 + obj.size; 
        
        ctx.save(); // Kontext speichern
        
        // Kreis
        ctx.fillStyle = obj.color; 
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; 
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // Text
        const isDark = (parseInt(obj.color.substr(1, 2), 16) * 0.299 + 
                        parseInt(obj.color.substr(3, 2), 16) * 0.587 + 
                        parseInt(obj.color.substr(5, 2), 16) * 0.114) < 186;
        
        ctx.fillStyle = isDark ? 'white' : 'black';
        ctx.font = `bold ${radius * 1.2}px sans-serif`; 
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        let text = obj.number.toString();

        if (obj.type === 'ball') {
            text = '⚽';
        } else if (obj.type === 'simple') {
            text = obj.number.toUpperCase();
        }
        
        ctx.fillText(text, pos.x, pos.y + 2);
        
        ctx.restore(); // Kontext wiederherstellen
    }
    
    function drawArrowhead(from, to, color, width) {
        const headLength = 10 + (width * 2);
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.fillStyle = color;
        ctx.setLineDash([]);
        
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x - headLength * Math.cos(angle - Math.PI / 6), to.y - headLength * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(to.x - headLength * Math.cos(angle + Math.PI / 6), to.y - headLength * Math.sin(angle + Math.PI / 6));
        ctx.lineTo(to.x, to.y);
        
        ctx.stroke();
        ctx.fill();
        ctx.restore();
    }
    
    function drawObjectsAndLines(frameData, isSynchronous = false) {
        if (isSynchronous) {
            // Synchrone Pfad: Nur die Objekte neu zeichnen, Linienbild wird nicht neu geladen
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            const img = new Image();
            img.onload = () => {
                 ctx.drawImage(img, 0, 0); 
                 frameData.objects.forEach(obj => {
                     drawSymbol(obj);
                 });
            };
            img.src = frameData.drawings; 

        } else {
            // Asynchrone Pfad: Laden des gespeicherten Bildes (Linien) und Objekte zeichnen
            const img = new Image();
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0); 
                
                frameData.objects.forEach(obj => {
                    drawSymbol(obj);
                });
            };
            img.src = frameData.drawings; 
        }
    }
    
    // NEU: Synchrone Funktion für Stempel
    function drawFrameSynchronous(index) {
        if (index < 0 || index >= frames.length) return;
        
        currentFrameIndex = index;
        const frameData = frames[index];
        movableObjects = [...frameData.objects];
        
        // Da Linien/Pfeile im Bild gespeichert sind, müssen wir den Asynchronen Aufruf verwenden,
        // aber wir stellen sicher, dass die Objekte sofort darüber gezeichnet werden.
        drawObjectsAndLines(frameData); // Wir vertrauen darauf, dass der img.onload schnell genug ist
        
        if (!undoHistory[currentFrameIndex]) {
             undoHistory[currentFrameIndex] = [frameData.drawings];
        }
        undoStep = undoHistory[currentFrameIndex].length - 1;
        
        updateFrameCounter();
    }

    // ==================================================
    // --- Animations- und History-Logik ---
    // ==================================================

    function updateFrameCounter() {
        if(frameCounter) frameCounter.textContent = `Frame ${currentFrameIndex + 1} / ${frames.length}`;
    }

    function saveUndoHistory() {
        if (!frames[currentFrameIndex]) return; 

        let currentFrameHistory = undoHistory[currentFrameIndex] || [];
        
        if (undoStep < currentFrameHistory.length - 1) {
            currentFrameHistory = currentFrameHistory.slice(0, undoStep + 1);
            undoHistory[currentFrameIndex] = currentFrameHistory;
        }

        const currentPixelState = canvas.toDataURL();
        currentFrameHistory.push(currentPixelState);
        undoStep = currentFrameHistory.length - 1; 
        
        frames[currentFrameIndex] = {
            drawings: currentPixelState,
            objects: [...movableObjects] 
        };
    }
    
    function undo() {
        if (animationInterval) pauseAnimation();
        
        let currentFrameHistory = undoHistory[currentFrameIndex] || [];

        if (undoStep > 0) {
            undoStep--;
            const previousStateBase64 = currentFrameHistory[undoStep];
            
            const img = new Image();
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                
                // Beim Undo laden wir den vorherigen Frame und zeichnen ihn neu.
                movableObjects = []; 
                drawFrame(currentFrameIndex, true); 
            };
            img.src = previousStateBase64;
        }
    }
    
    function clearCurrentFrame() {
        if (animationInterval) pauseAnimation();
        if (confirm('Sicher, dass der Inhalt dieses Frames gelöscht werden soll?')) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            movableObjects = [];
            saveUndoHistory(); 
        }
    }
    
    function drawFrame(index, forceRedraw = false) {
        if (index < 0 || index >= frames.length) return;
        if (index === currentFrameIndex && !forceRedraw) return; 

        currentFrameIndex = index;
        
        const frameData = frames[index];
        movableObjects = [...frameData.objects];
        
        drawObjectsAndLines(frameData); 
        
        if (!undoHistory[currentFrameIndex]) {
             undoHistory[currentFrameIndex] = [frameData.drawings];
        }
        undoStep = undoHistory[currentFrameIndex].length - 1;
        
        updateFrameCounter();
    }
    
    function showFrame(index) {
        if (index < 0 || index >= frames.length) return;
        
        const frameData = frames[index];
        drawObjectsAndLines(frameData); 
        
        currentFrameIndex = index;
        updateFrameCounter();
    }


    function addNewFrame() {
        if (animationInterval) pauseAnimation();
        
        saveUndoHistory(); 
        
        const currentFrame = frames[currentFrameIndex];
        const newFrameData = {
            drawings: currentFrame.drawings,
            objects: [...currentFrame.objects]
        };
        
        frames.splice(currentFrameIndex + 1, 0, newFrameData);
        undoHistory.splice(currentFrameIndex + 1, 0, [newFrameData.drawings]);
        
        drawFrame(currentFrameIndex + 1);
    }
    
    function deleteCurrentFrame() {
        if (animationInterval) pauseAnimation();
        
        if (frames.length <= 1) {
            if(typeof window.showToast === 'function') window.showToast("Letzter Frame kann nicht gelöscht werden.", "error");
            return;
        }
        if (!confirm(`Sicher, dass Frame ${currentFrameIndex + 1} gelöscht werden soll?`)) {
            return;
        }
        
        frames.splice(currentFrameIndex, 1);
        undoHistory.splice(currentFrameIndex, 1);
        
        if (currentFrameIndex >= frames.length) {
            currentFrameIndex = frames.length - 1;
        }
        
        drawFrame(currentFrameIndex);
    }
    
    function prevFrame() {
        if (animationInterval) pauseAnimation(); 
        saveUndoHistory(); 
        
        if (currentFrameIndex > 0) {
            drawFrame(currentFrameIndex - 1);
        }
    }
    
    function nextFrame() {
        if (animationInterval) pauseAnimation();
        saveUndoHistory();
        
        if (currentFrameIndex < frames.length - 1) {
            drawFrame(currentFrameIndex + 1);
        }
    }
    
    function playAnimation() {
        toolPlay.style.display = 'none';
        toolPause.style.display = 'block';
        
        saveUndoHistory();

        let animationFrameIndex = currentFrameIndex; 

        animationInterval = setInterval(() => {
            showFrame(animationFrameIndex); 
            
            animationFrameIndex++; 
            if (animationFrameIndex >= frames.length) {
                animationFrameIndex = 0; 
            }
        }, 800); 
    }
    
    function pauseAnimation() {
        toolPlay.style.display = 'block';
        toolPause.style.display = 'none';
        if (animationInterval) {
            clearInterval(animationInterval);
            animationInterval = null;
        }
    }
    
    function clearAllFrames(silent = false) {
        if (animationInterval) pauseAnimation();
        
        if (silent || confirm('Möchtest du wirklich alle Frames löschen und neu beginnen?')) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const emptyFrame = canvas.toDataURL();
            frames = [{ drawings: emptyFrame, objects: [] }];
            currentFrameIndex = 0;
            movableObjects = [];
            undoHistory = [ [emptyFrame] ]; 
            undoStep = 0;
            updateFrameCounter();
        }
    }
    
    function exportCanvas() {
        if (animationInterval) pauseAnimation();
        
        const dataURL = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `Taktiktafel_Frame_${currentFrameIndex + 1}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if(typeof window.showToast === 'function') window.showToast("Frame als PNG exportiert.", "success");
    }


    // ==================================================
    // --- Initialisierung & Event Listeners ---
    // ==================================================
    
    function initTacticboard() {
        
        function setupCanvas() {
            resizeCanvas();
            const emptyFrame = canvas.toDataURL();
            frames = [{ drawings: emptyFrame, objects: [] }];
            undoHistory = [ [emptyFrame] ];
            undoStep = 0;
            currentFrameIndex = 0;
            updateFrameCounter();
        }

        if (activeSvgBackground.complete && activeSvgBackground.naturalHeight !== 0) {
            setupCanvas();
        } else {
            svgFull.onload = () => { if(activeSvgBackground === svgFull) setupCanvas(); };
            svgHalf.onload = () => { if(activeSvgBackground === svgHalf) setupCanvas(); };
            
            if (activeSvgBackground.complete && activeSvgBackground.naturalHeight !== 0) setupCanvas();
        }
        
        window.addEventListener('resize', resizeCanvas);

        // --- Maus/Touch Events (Zeichnen und Drag) ---
        canvas.addEventListener('mousemove', updateCursor);
        canvas.addEventListener('mouseenter', () => {
            if (currentTool !== null) { 
                customCursor.style.display = 'block';
            }
        });
        canvas.addEventListener('mouseleave', () => {
            customCursor.style.display = 'none';
        });
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing); 
        canvas.addEventListener('touchstart', startDrawing, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stopDrawing);
        
        // Klick-Listener für Stempel hinzufügen
        canvas.addEventListener('click', handleCanvasClick); 
        
        // --- Werkzeug-Events (Buttons) ---
        toolPen.addEventListener('click', () => selectTool('pen'));
        toolDashed.addEventListener('click', () => selectTool('dashed'));
        toolArrow.addEventListener('click', () => selectTool('arrow'));
        toolEraser.addEventListener('click', () => selectTool('eraser'));
        
        toolStampX.addEventListener('click', () => selectTool('x'));
        toolStampO.addEventListener('click', () => selectTool('o'));
        toolStampBall.addEventListener('click', () => selectTool('ball'));
        
        toolPlayerNumButton.addEventListener('click', () => {
            selectTool('player-num');
        });
        
        toolClear.addEventListener('click', clearCurrentFrame); 
        toolExport.addEventListener('click', exportCanvas);
        toolUndo.addEventListener('click', undo);
        
        strokeWidthSlider.addEventListener('input', (e) => {
            currentStrokeWidth = parseInt(e.target.value, 10);
            updateCustomCursorAppearance();
        });
        
        colorSwatchesContainer.querySelectorAll('.color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => selectColor(swatch));
        });
        
        // Feld-Umschalter
        toolFieldFull.addEventListener('click', () => switchFieldType('full'));
        toolFieldHalf.addEventListener('click', () => switchFieldType('half'));
        
        // Animations-Events
        toolPrevFrame.addEventListener('click', prevFrame);
        toolNextFrame.addEventListener('click', nextFrame);
        toolPlay.addEventListener('click', playAnimation);
        toolPause.addEventListener('click', pauseAnimation);
        toolNewFrame.addEventListener('click', addNewFrame);
        toolDeleteFrame.addEventListener('click', deleteCurrentFrame);

        selectTool('pen'); 
    }

    document.addEventListener('DOMContentLoaded', initTacticboard);
    
})(); // ENDE IIFE