const gridContainer = document.getElementById('grid-container');
const linesLayer = document.getElementById('lines-layer');
const levelDisplay = document.getElementById('level-display');
const btnUndo = document.getElementById('btn-undo');
const btnRestart = document.getElementById('btn-restart');
const modal = document.getElementById('level-complete-modal');
const btnNextLevel = document.getElementById('btn-next-level');

// Game State
let level = 1;
let gridSize = 3; // Starts at 3x3
let cellElements = [];
let solutionPath = []; // The pre-generated valid path
let revealedClues = new Map(); // Map of cellIndex -> number
let playerPath = []; // Array of cell indices the player has dragged over
let isDragging = false;
let gameWon = false;

// -------------------------------------------------------------
// Audio System (Web Audio API for procedural sounds)
// -------------------------------------------------------------
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
    }
    // Resume audio context if suspended (browser auto-play policies)
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// frequency in Hz, type: 'sine' | 'square' | 'sawtooth' | 'triangle', duration in seconds, volume 0-1
function playTone(freq, type, duration, vol) {
    if (!audioCtx) return;

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);

    // Envelope for a satisfying "pluck" or "pop"
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.05); // quick fade in
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration); // smooth fade out

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration);
}

const sfx = {
    // Pitch goes up slightly as the path gets longer
    pop: (pathLength) => {
        const baseFreq = 300;
        const noteFreq = baseFreq * Math.pow(1.059463094359, pathLength % 24); // Pentatonic-ish scale climb
        playTone(noteFreq, 'sine', 0.2, 0.4);
    },
    error: () => {
        playTone(150, 'sawtooth', 0.15, 0.2);
    },
    winTick: () => { // tiny chime for the animation stagger
        playTone(800 + Math.random() * 200, 'sine', 0.1, 0.1);
    },
    winChord: () => { // Big chord at the end
        playTone(440, 'sine', 1.0, 0.3); // A4
        playTone(554.37, 'sine', 1.0, 0.3); // C#5
        playTone(659.25, 'sine', 1.0, 0.3); // E5
        playTone(880, 'sine', 1.5, 0.3); // A5
    }
};

// -------------------------------------------------------------
// Initialization & Level Generation
// -------------------------------------------------------------

function initLevel() {
    gameWon = false;
    modal.classList.add('hidden');
    levelDisplay.textContent = level;

    // Scale grid size based on level up to max 50
    if (level <= 5) gridSize = 3;
    else if (level <= 15) gridSize = 4;
    else if (level <= 25) gridSize = 5;
    else if (level <= 35) gridSize = 6;
    else if (level <= 45) gridSize = 7;
    else gridSize = 8;

    generatePuzzle();
    renderGrid();
    setupInteractions();
    updateUI();
}

function generatePuzzle() {
    const totalCells = gridSize * gridSize;
    solutionPath = [];

    // 1. Generate a random Hamiltonian path (visits every cell exactly once)
    const startX = Math.floor(Math.random() * gridSize);
    const startY = Math.floor(Math.random() * gridSize);
    const startIndex = startY * gridSize + startX;

    let visited = new Set();
    visited.add(startIndex);
    solutionPath.push(startIndex);

    if (!findPath(startIndex, visited, solutionPath)) {
        // Fallback: If it somehow fails (rare but possible in small grids with bad RNG), retry
        console.warn("Failed to generate path, retrying...");
        return generatePuzzle();
    }

    // 2. Select Clues to reveal
    revealedClues.clear();
    // Always reveal start (1) and end
    revealedClues.set(solutionPath[0], 1);
    revealedClues.set(solutionPath[totalCells - 1], totalCells);

    // Reveal intermediate clues based on difficulty (fewer clues = harder)
    const numIntermediateClues = Math.max(0, Math.floor(totalCells / 3) - Math.floor(level / 3));

    let availableIndices = [];
    for (let i = 1; i < totalCells - 1; i++) availableIndices.push(i);

    // Shuffle and pick
    for (let i = availableIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableIndices[i], availableIndices[j]] = [availableIndices[j], availableIndices[i]];
    }

    for (let i = 0; i < Math.min(numIntermediateClues, availableIndices.length); i++) {
        const pathIndex = availableIndices[i];
        revealedClues.set(solutionPath[pathIndex], pathIndex + 1);
    }

    // Reset player state
    playerPath = [];
}

// DFS to find a path that visits all cells
function findPath(currentIndex, visited, path) {
    if (path.length === gridSize * gridSize) {
        return true; // Found a complete path
    }

    const x = currentIndex % gridSize;
    const y = Math.floor(currentIndex / gridSize);

    // Directions: Up, Right, Down, Left (Randomized for variety)
    const dirs = [
        { dx: 0, dy: -1 }, { dx: 1, dy: 0 },
        { dx: 0, dy: 1 }, { dx: -1, dy: 0 }
    ];

    // Shuffle directions
    for (let i = dirs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }

    for (const dir of dirs) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;

        if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
            const nextIndex = ny * gridSize + nx;
            if (!visited.has(nextIndex)) {
                visited.add(nextIndex);
                path.push(nextIndex);

                if (findPath(nextIndex, visited, path)) {
                    return true;
                }

                // Backtrack
                visited.delete(nextIndex);
                path.pop();
            }
        }
    }
    return false;
}

// -------------------------------------------------------------
// Rendering
// -------------------------------------------------------------

function renderGrid() {
    gridContainer.innerHTML = '';
    gridContainer.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;
    gridContainer.style.gridTemplateRows = `repeat(${gridSize}, 1fr)`;
    cellElements = [];

    const totalCells = gridSize * gridSize;

    for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.index = i;

        const span = document.createElement('span');

        if (revealedClues.has(i)) {
            cell.classList.add('clue');
            span.textContent = revealedClues.get(i);
        } else {
            // Put the correct number in hidden, but don't show it (handled by CSS)
            // Need to find what number this cell actually is in the solution
            const num = solutionPath.indexOf(i) + 1;
            span.textContent = num;
        }

        cell.appendChild(span);
        gridContainer.appendChild(cell);
        cellElements.push(cell);
    }

    drawLines();
}

function drawLines() {
    linesLayer.innerHTML = ''; // Clear SVG

    if (playerPath.length < 2) return;

    for (let i = 0; i < playerPath.length - 1; i++) {
        const startCell = cellElements[playerPath[i]];
        const endCell = cellElements[playerPath[i + 1]];

        // Get coordinates relative to the SVG container (which matches the grid container)
        // Because of the gap, we calculate center based on percentages or raw pixel coords
        // It's safer to use offsetLeft/Top of the cells relative to the grid container
        const rect1 = {
            x: startCell.offsetLeft + startCell.offsetWidth / 2,
            y: startCell.offsetTop + startCell.offsetHeight / 2
        };
        const rect2 = {
            x: endCell.offsetLeft + endCell.offsetWidth / 2,
            y: endCell.offsetTop + endCell.offsetHeight / 2
        };

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', rect1.x);
        line.setAttribute('y1', rect1.y);
        line.setAttribute('x2', rect2.x);
        line.setAttribute('y2', rect2.y);
        line.setAttribute('class', 'path-line');
        // Simple animation trick: delay drawing slightly for smoothness
        line.style.opacity = '0';
        linesLayer.appendChild(line);

        // Trigger reflow
        void line.offsetWidth;
        line.style.opacity = '1';
    }
}

function updateUI() {
    // Reset all cell visual states
    cellElements.forEach(c => {
        c.classList.remove('visited', 'current');
        // Remove error classes if any existed
    });

    // Apply player path states
    playerPath.forEach((cellIndex, arrIndex) => {
        const cell = cellElements[cellIndex];
        cell.classList.add('visited');
        // Ensure the span shows the correct number based on player's sequence
        const span = cell.querySelector('span');
        span.textContent = arrIndex + 1;

        if (arrIndex === playerPath.length - 1) {
            cell.classList.add('current');
        }
    });

    // Re-apply clue styling so they stay visible if not in path yet
    revealedClues.forEach((num, index) => {
        if (!playerPath.includes(index)) {
            cellElements[index].classList.add('clue');
            cellElements[index].querySelector('span').textContent = num;
        }
    });

    btnUndo.disabled = playerPath.length === 0;

    drawLines();
    checkWinCondition();
}

// -------------------------------------------------------------
// Interaction Logic
// -------------------------------------------------------------

function setupInteractions() {
    // Using pointer events for unified mouse/touch handling
    gridContainer.addEventListener('pointerdown', (e) => {
        initAudio(); // Initialize audio on first user interaction
        handlePointerDown(e);
    });
    // Bind to window to allow dragging outside cells smoothly
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
}

function handlePointerDown(e) {
    if (gameWon) return;

    const cell = e.target.closest('.cell');
    if (!cell) return;

    isDragging = true;
    const index = parseInt(cell.dataset.index);

    // If we click an empty board, ONLY allow starting from '1'
    if (playerPath.length === 0) {
        if (revealedClues.get(index) === 1) {
            playerPath.push(index);
            sfx.pop(1);
            updateUI();
        } else {
            sfx.error();
        }
    } else {
        // If cliking the LAST cell in the current path, just enter drag mode
        if (playerPath[playerPath.length - 1] === index) {
            // Do nothing, just ready to drag
        }
        // If clicking a VALID NEXT cell from current path end
        else if (isValidNextMove(index)) {
            playerPath.push(index);
            sfx.pop(playerPath.length);
            updateUI();
        }
        // If clicking a cell ALREADY in the path, truncate path back to there (undo via tap)
        else if (playerPath.includes(index)) {
            const cutIndex = playerPath.indexOf(index);
            playerPath = playerPath.slice(0, cutIndex + 1);
            sfx.pop(playerPath.length);
            updateUI();
        } else {
            sfx.error();
        }
    }
}

function handlePointerMove(e) {
    if (!isDragging || gameWon || playerPath.length === 0) return;

    // Find what element is under the pointer right now
    const element = document.elementFromPoint(e.clientX, e.clientY);
    const cell = element ? element.closest('.cell') : null;

    if (cell) {
        const index = parseInt(cell.dataset.index);

        // If we dragged onto a valid next cell
        if (isValidNextMove(index)) {
            playerPath.push(index);
            sfx.pop(playerPath.length);
            updateUI();
        }
        // If we dragged backwards onto the PREVIOUS cell in path, pop the last one (smooth undo)
        else if (playerPath.length >= 2 && playerPath[playerPath.length - 2] === index) {
            playerPath.pop();
            sfx.pop(playerPath.length);
            updateUI();
        }
    }
}

function handlePointerUp() {
    isDragging = false;
}

function isValidNextMove(targetIndex) {
    if (playerPath.length === 0) return false;

    // Rule 1: Cannot overlap existing path
    if (playerPath.includes(targetIndex)) return false;

    const lastIndex = playerPath[playerPath.length - 1];

    // Rule 2: Must be orthogonally adjacent
    const lastX = lastIndex % gridSize;
    const lastY = Math.floor(lastIndex / gridSize);
    const targetX = targetIndex % gridSize;
    const targetY = Math.floor(targetIndex / gridSize);

    const isAdjacent = (Math.abs(lastX - targetX) === 1 && lastY === targetY) ||
        (Math.abs(lastY - targetY) === 1 && lastX === targetX);

    if (!isAdjacent) return false;

    // Rule 3: If target is a revealed clue, it MUST match the sequence number we are about to place
    const expectedNumber = playerPath.length + 1;
    if (revealedClues.has(targetIndex)) {
        if (revealedClues.get(targetIndex) !== expectedNumber) {
            // Trying to connect to a 5 when we are only at step 3 etc.
            return false;
        }
    }

    return true;
}

// -------------------------------------------------------------
// Game Loop & UI Actions
// -------------------------------------------------------------

function checkWinCondition() {
    const totalCells = gridSize * gridSize;

    if (playerPath.length === totalCells) {
        // Technically, because of isValidNextMove validating clues as we go,
        // if we connect all cells, and the first and last matched clues, it's a valid win.
        gameWon = true;
        isDragging = false;

        // Trigger celebrate animations
        cellElements.forEach((cell, i) => {
            setTimeout(() => {
                cell.classList.add('win-anim');
            }, i * 30); // Stagger animation along the path (since they are in order of grid, wait no, let's do path order)
        });

        // Actually stagger by path order for cooler effect
        playerPath.forEach((cellIndex, index) => {
            setTimeout(() => {
                cellElements[cellIndex].classList.add('win-anim');
                sfx.winTick();
            }, index * 40);
        });

        setTimeout(() => {
            sfx.winChord();
            if (level >= 50) {
                document.getElementById('modal-title').textContent = "You Won the Entire Game!";
                document.getElementById('modal-message').textContent = "You are a Zip Connect Master! You beat all 50 levels and the massive 8x8 grid. Take a bow.";
                btnNextLevel.textContent = "Play Again from Level 1";
            } else {
                document.getElementById('modal-title').textContent = `Level ${level} Complete!`;
                document.getElementById('modal-message').textContent = "Great job connecting all the numbers.";
                btnNextLevel.textContent = "Next Level";
            }
            modal.classList.remove('hidden');
        }, (totalCells * 40) + 400);
    }
}

btnUndo.addEventListener('click', () => {
    if (playerPath.length > 0 && !gameWon) {
        playerPath.pop();
        updateUI();
    }
});

btnRestart.addEventListener('click', () => {
    if (!gameWon) {
        playerPath = [];
        updateUI();
    }
});

btnNextLevel.addEventListener('click', () => {
    if (level >= 50) {
        level = 1;
    } else {
        level++;
    }
    initLevel();
});

// Since lines rely on element offsets, redraw if window resizes
window.addEventListener('resize', () => {
    if (playerPath.length > 0) {
        drawLines();
    }
});

// Start game
initLevel();
