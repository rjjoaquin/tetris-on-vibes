import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

// --- Config ---
const COLS = 10;
const ROWS = 20;
const CELL = 1; // world units per cell

// --- Tetrimino definitions ---
const SHAPES = {
  I: [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ],
  O: [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  T: [
    [0, 0],
    [1, 0],
    [2, 0],
    [1, 1],
  ],
  S: [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ],
  Z: [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
  J: [
    [0, 0],
    [0, 1],
    [1, 0],
    [2, 0],
  ],
  L: [
    [2, 0],
    [0, 0],
    [1, 0],
    [2, 1],
  ],
};

const COLORS = {
  I: "#d39b6a",
  O: "#c58c5d",
  T: "#b27a4d",
  S: "#a46f45",
  Z: "#996640",
  J: "#8c5d3a",
  L: "#7f5435",
};

// --- Helpers ---
function rotate(points) {
  // 90° clockwise around origin
  return points.map(([x, y]) => [y, -x]);
}
function translate(points, dx, dy) {
  return points.map(([x, y]) => [x + dx, y + dy]);
}
function randomPiece() {
  const keys = Object.keys(SHAPES);
  const k = keys[Math.floor(Math.random() * keys.length)];
  return { type: k, cells: SHAPES[k].map(([x, y]) => [x, y]), rot: 0 };
}
function makeEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}
function collides(board, piece, offX, offY) {
  const pts = translate(piece.cells, offX, offY);
  for (const [x, y] of pts) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
    if (board[y][x]) return true;
  }
  return false;
}
function merge(board, piece) {
  const next = board.map((row) => row.slice());
  for (const [x, y] of piece.cells) {
    if (y >= 0 && y < ROWS && x >= 0 && x < COLS) next[y][x] = piece.type;
  }
  return next;
}
function clearLines(board) {
  // Keep rows that are NOT full, then pad empties at the TOP
  const remaining = board.filter((row) => row.some((cell) => !cell));
  const cleared = ROWS - remaining.length;
  const pad = Array.from({ length: cleared }, () => Array(COLS).fill(null));
  return { board: [...remaining, ...pad], cleared };
}

// --- Camera fit helper ---
function FitCamera({ padding = 1.5 }) {
  const { camera, size } = useThree();
  // Reduce headroom on small screens so the board hugs the top (less empty space)
  const pad = size.width <= 768 ? 0.5 : padding;
  useEffect(() => {
    // Fit the entire board within view for any aspect ratio
    const fovRad = (camera.fov * Math.PI) / 180;
    const halfH = (ROWS * CELL) / 2 + pad;
    const halfW = (COLS * CELL) / 2 + pad;
    const aspect = size.width / size.height;
    const zForH = halfH / Math.tan(fovRad / 2);
    const zForW = halfW / (Math.tan(fovRad / 2) * aspect);
    const z = Math.max(10, zForH, zForW);
    camera.position.set(0, 0, z);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, pad]);
  return null;
}

// --- Game logic ---
function useGameLogic() {
  const [board, setBoard] = useState(makeEmptyBoard);
  const [piece, setPiece] = useState(() => {
    const p = randomPiece();
    p.cells = translate(p.cells, Math.floor(COLS / 2) - 2, ROWS - 2);
    return p;
  });
  const [nextPiece, setNextPiece] = useState(randomPiece);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [clearingRows, setClearingRows] = useState([]); // indices animating
  const [clearPhase, setClearPhase] = useState(0); // 0..1 animation progress
  const dropIntervalRef = useRef(800);

  const spawn = useCallback(
    (curBoard) => {
      const p = nextPiece;
      const start = translate(p.cells, Math.floor(COLS / 2) - 2, ROWS - 2);
      const newPiece = { ...p, cells: start, rot: 0 };
      setNextPiece(randomPiece());
      if (collides(curBoard, newPiece, 0, 0)) {
        setGameOver(true);
        return null;
      }
      return newPiece;
    },
    [nextPiece]
  );

  const animateClearAndCommit = useCallback(
    (mergedBoard) => {
      // Identify full rows
      const full = [];
      for (let y = 0; y < ROWS; y++)
        if (mergedBoard[y].every(Boolean)) full.push(y);
      if (!full.length) return false;

      setClearingRows(full);
      setClearPhase(0);

      const start = performance.now();
      const duration = 280; // ms
      const tick = () => {
        const p = Math.min(1, (performance.now() - start) / duration);
        setClearPhase(p);
        if (p < 1) {
          requestAnimationFrame(tick);
        } else {
          // Apply clear
          const { board: clearedBoard, cleared } = clearLines(mergedBoard);
          if (cleared)
            setScore((s) => s + ([0, 100, 300, 500, 800][cleared] || 0));
          setBoard(clearedBoard);
          setClearingRows([]);
          const nextP = spawn(clearedBoard);
          if (nextP) setPiece(nextP);
        }
      };
      requestAnimationFrame(tick);
      return true;
    },
    [spawn]
  );

  // --- Actions (desktop + mobile) ---
  const move = useCallback(
    (dx) => {
      if (gameOver || clearingRows.length || !piece) return;
      if (!collides(board, piece, dx, 0)) {
        setPiece((p) => ({ ...p, cells: translate(p.cells, dx, 0) }));
      }
    },
    [board, piece, gameOver, clearingRows.length]
  );

  const rotateCW = useCallback(() => {
    if (gameOver || clearingRows.length || !piece) return;
    const origin = piece.cells[0];
    const rotated = rotate(
      piece.cells.map(([x, y]) => [x - origin[0], y - origin[1]])
    );
    const candidate = translate(rotated, origin[0], origin[1]);
    const nextPieceState = {
      ...piece,
      cells: candidate,
      rot: (piece.rot + 1) % 4,
    };
    if (!collides(board, nextPieceState, 0, 0)) setPiece(nextPieceState);
  }, [board, piece, gameOver, clearingRows.length]);

  const softDrop = useCallback(() => {
    if (gameOver || clearingRows.length || !piece) return;
    if (!collides(board, piece, 0, -1)) {
      setPiece((prev) => ({ ...prev, cells: translate(prev.cells, 0, -1) }));
    } else {
      // lock
      const merged = merge(board, piece);
      setBoard(merged);
      setPiece(null);
      const started = animateClearAndCommit(merged);
      if (!started) {
        const nextP = spawn(merged);
        if (nextP) setPiece(nextP);
      }
    }
  }, [
    board,
    piece,
    gameOver,
    clearingRows.length,
    animateClearAndCommit,
    spawn,
  ]);

  const hardDrop = useCallback(() => {
    if (gameOver || clearingRows.length || !piece) return;
    let dy = 0;
    while (!collides(board, piece, 0, -(dy + 1))) dy++;
    const dropped = { ...piece, cells: translate(piece.cells, 0, -dy) };
    const merged = merge(board, dropped);
    setBoard(merged);
    setPiece(null);
    const started = animateClearAndCommit(merged);
    if (!started) {
      const nextP = spawn(merged);
      if (nextP) setPiece(nextP);
    }
  }, [
    board,
    piece,
    gameOver,
    clearingRows.length,
    animateClearAndCommit,
    spawn,
  ]);

  // gravity
  useEffect(() => {
    if (gameOver) return;
    const id = setInterval(() => softDrop(), dropIntervalRef.current);
    return () => clearInterval(id);
  }, [softDrop, gameOver]);

  // controls (desktop)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowDown") softDrop();
      else if (e.key === "ArrowUp") rotateCW();
      else if (e.key === " ") hardDrop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, softDrop, rotateCW, hardDrop]);

  return {
    board,
    piece,
    nextPiece,
    score,
    gameOver,
    clearingRows,
    clearPhase,
    move,
    rotateCW,
    softDrop,
    hardDrop,
  };
}

// --- Rendering ---
function WoodCube({ position, color, highlight = false, phase = 0 }) {
  // Simple squash/fade/glow animation for highlighted cells (clearing rows)
  const squash = highlight ? 1 - 0.4 * phase : 1;
  const glow = highlight ? 0.4 * (1 - phase) : 0;
  const opacity = highlight ? 1 - 0.3 * phase : 1;
  return (
    <mesh
      position={position}
      scale={[squash, squash, 1]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[CELL * 0.98, CELL * 0.98, CELL * 0.98]} />
      <meshStandardMaterial
        roughness={0.6}
        metalness={0.05}
        color={color}
        emissive={color}
        emissiveIntensity={glow}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

function Board({
  board,
  piece,
  clearingRows = [],
  clearPhase = 0,
  yNudge = 0,
}) {
  const rowsSet = useMemo(() => new Set(clearingRows), [clearingRows]);
  const cells = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = board[y][x];
      if (t) cells.push({ x, y, type: t, highlight: rowsSet.has(y) });
    }
  }
  if (piece) {
    piece.cells.forEach(([x, y]) =>
      cells.push({ x, y, type: piece.type, highlight: false })
    );
  }

  return (
    <group
      position={[
        -(COLS * CELL) / 2 + CELL / 2,
        -(ROWS * CELL) / 2 + CELL / 2 + yNudge,
        0,
      ]}
    >
      {/* base bar */}
      <mesh
        position={[(COLS * CELL) / 2 - CELL / 2, -CELL, -CELL / 2]}
        receiveShadow
      >
        <boxGeometry args={[COLS * CELL + 1, CELL / 2, CELL]} />
        <meshStandardMaterial color="#5e452f" roughness={0.8} />
      </mesh>
      {/* cells */}
      {cells.map((c, i) => (
        <WoodCube
          key={i}
          position={[c.x * CELL, c.y * CELL, 0]}
          color={COLORS[c.type]}
          highlight={c.highlight}
          phase={clearPhase}
        />
      ))}
      {/* thin frame */}
      <mesh
        position={[
          (COLS * CELL) / 2 - CELL / 2,
          (ROWS * CELL) / 2 - CELL / 2,
          -0.52,
        ]}
      >
        <boxGeometry args={[COLS * CELL + 0.2, ROWS * CELL + 0.2, 0.04]} />
        <meshStandardMaterial color="#3d2d21" roughness={1} />
      </mesh>
    </group>
  );
}

function NextPiecePreview({ nextPiece }) {
  // Render an orthographic preview centered via its bounding box
  const baseCells = SHAPES[nextPiece.type];
  const minX = Math.min(...baseCells.map(([x]) => x));
  const maxX = Math.max(...baseCells.map(([x]) => x));
  const minY = Math.min(...baseCells.map(([, y]) => y));
  const maxY = Math.max(...baseCells.map(([, y]) => y));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return (
    <group>
      {/* base plate for contrast */}
      <mesh position={[0, 0, -0.6]}>
        <boxGeometry args={[4.5 * CELL, 4.5 * CELL, 0.05]} />
        <meshStandardMaterial color="#2b2118" roughness={1} />
      </mesh>
      {baseCells.map(([x, y], i) => (
        <WoodCube
          key={i}
          position={[(x - cx) * CELL, (y - cy) * CELL, 0]}
          color={COLORS[nextPiece.type]}
        />
      ))}
    </group>
  );
}

function HUD({ score, gameOver, nextPiece }) {
  // Desktop-only HUD to keep mobile playfield unobstructed
  return (
    <div className="hidden md:block absolute top-4 left-4 z-20 p-3 rounded-2xl bg-black/50 text-white text-sm shadow-xl">
      <div className="font-semibold">Score: {score}</div>
      {gameOver && <div className="mt-1">Game over. Refresh to restart.</div>}
      <div className="mt-2 opacity-80">
        Controls: ← → move, ↑ rotate, ↓ soft drop, Space hard drop
      </div>
      <div className="mt-4">
        <div className="font-semibold mb-1">Next:</div>
        <Canvas
          orthographic
          camera={{ position: [0, 0, 10], zoom: 35 }}
          style={{ width: 120, height: 120 }}
        >
          <ambientLight intensity={0.6} />
          <NextPiecePreview nextPiece={nextPiece} />
        </Canvas>
      </div>
    </div>
  );
}

function TopBar({ score, visible, onHelp }) {
  // Mobile compact top bar that auto-hides
  return (
    <div
      className={`md:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-2 bg-black/50 text-white text-sm transition-opacity duration-300 ${
        visible
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      }`}
    >
      <div className="font-semibold">Score: {score}</div>
      <button
        className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-white shadow"
        onClick={onHelp}
        aria-label="Help"
      >
        ?
      </button>
    </div>
  );
}

function BottomSheet({ open, onClose, nextPiece }) {
  const startY = useRef(0);
  const endY = useRef(0);
  const handleStart = (e) => {
    startY.current = e.touches[0].clientY;
  };
  const handleEnd = (e) => {
    endY.current = e.changedTouches?.[0]?.clientY ?? startY.current;
    const dy = endY.current - startY.current;
    if (open && dy > 24) onClose();
  };

  return (
    <>
      {/* Peek grabber when closed */}
      {!open && (
        <div
          className="md:hidden fixed bottom-0 left-1/2 -translate-x-1/2 mb-1 z-50 pointer-events-auto"
          onClick={() => onClose(true)}
        >
          <div className="w-16 h-2 rounded-full bg-white/30 shadow" />
        </div>
      )}

      {/* Sheet */}
      <div
        className={`md:hidden fixed inset-x-0 bottom-0 z-40 bg-black/80 text-white rounded-t-2xl overflow-hidden backdrop-blur transition-transform duration-300 ${
          open ? "translate-y-0" : "translate-y-[calc(100%_-_16px)]"
        }`}
        style={{ height: "50vh" }}
        onTouchStart={handleStart}
        onTouchEnd={handleEnd}
        onClick={() => {
          if (!open) onClose(true);
        }}
      >
        {open && (
          <div className="flex items-center justify-center py-2">
            <div
              className="w-14 h-1.5 rounded-full bg-white/30"
              onClick={() => onClose(false)}
            />
          </div>
        )}
        <div
          className="px-4 pb-4 overflow-y-auto h-[calc(50vh-20px)]"
          style={{ display: open ? "block" : "none" }}
        >
          <div className="flex items-center justify-between">
            <div className="text-base font-semibold">How to play</div>
            {open && (
              <button
                className="px-3 py-1 rounded-xl bg-white/10"
                onClick={() => onClose(false)}
              >
                Close
              </button>
            )}
          </div>
          <ul className="mt-2 text-sm space-y-1 text-white/90 list-disc list-inside">
            <li>Swipe left/right to move</li>
            <li>Swipe down to soft drop</li>
            <li>Fast swipe down to hard drop</li>
            <li>Tap to rotate</li>
          </ul>
          <div className="mt-4">
            <div className="text-sm font-semibold mb-2">Next piece</div>
            <div className="w-full flex items-center justify-center">
              <Canvas
                orthographic
                camera={{ position: [0, 0, 10], zoom: 35 }}
                style={{ width: 140, height: 140 }}
              >
                <ambientLight intensity={0.6} />
                <NextPiecePreview nextPiece={nextPiece} />
              </Canvas>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function GestureLayer({
  onLeft,
  onRight,
  onRotate,
  onSoft,
  onHard,
  onInteract,
}) {
  // Fullscreen transparent layer that interprets touch gestures
  const startRef = useRef({ x: 0, y: 0, t: 0 });
  const lastStepRef = useRef({ x: 0, y: 0 });

  const H_STEP = 28; // px per horizontal move step
  const V_STEP = 28; // px per soft-drop step
  const TAP_MS = 200; // tap if released quickly with small movement
  const TAP_MOVE = 12; // px tolerance for a tap
  const HARD_DY = 120; // px total downward swipe for hard drop
  const HARD_V = 0.8; // px/ms velocity threshold for hard drop

  const onStart = (e) => {
    onInteract && onInteract();
    const t = e.touches[0];
    const s = { x: t.clientX, y: t.clientY, t: performance.now() };
    startRef.current = s;
    lastStepRef.current = { x: s.x, y: s.y };
  };

  const onMove = (e) => {
    onInteract && onInteract();
    // prevent page scroll while gesturing
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - lastStepRef.current.x;
    const dy = t.clientY - lastStepRef.current.y;

    // Horizontal discrete steps for left/right
    if (Math.abs(dx) >= H_STEP && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) onRight();
      else onLeft();
      lastStepRef.current.x = t.clientX; // step origin shifts so repeated swipes continue
    }

    // Vertical discrete steps for soft drop
    if (Math.abs(dy) >= V_STEP && Math.abs(dy) > Math.abs(dx)) {
      if (dy > 0) onSoft();
      lastStepRef.current.y = t.clientY;
    }
  };

  const onEnd = (e) => {
    onInteract && onInteract();
    const endT = performance.now();
    const s = startRef.current;
    const ex = lastStepRef.current.x;
    const ey = lastStepRef.current.y;
    const totalDx = ex - s.x;
    const totalDy = ey - s.y;
    const dt = endT - s.t;

    // Hard drop if strong downward swipe
    const v = Math.abs(totalDy) / Math.max(1, dt);
    if (totalDy > HARD_DY && v > HARD_V) {
      onHard();
      return;
    }

    // Rotate on tap (quick + minimal movement)
    if (dt <= TAP_MS && Math.hypot(totalDx, totalDy) <= TAP_MOVE) {
      onRotate();
    }
  };

  return (
    <div
      className="absolute inset-0 z-30 pointer-events-auto"
      style={{ touchAction: "none" }}
      onTouchStart={onStart}
      onTouchMove={onMove}
      onTouchEnd={onEnd}
      // Allow browser right-click menu by preventing the event from reaching OrbitControls
      onContextMenuCapture={(e) => {
        e.stopPropagation();
      }}
    />
  );
}

function GameOverOverlay({ gameOver }) {
  if (!gameOver) return null;
  return (
    <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
      <div className="px-6 py-4 rounded-2xl bg-black/70 text-white text-4xl font-extrabold tracking-wide">
        GAME OVER
      </div>
    </div>
  );
}

function Scene({ board, piece, clearingRows, clearPhase }) {
  const lightRef = useRef();
  const { size } = useThree();
  const yNudge = size.width <= 768 ? 1.0 : 0;
  useFrame(() => {
    if (lightRef.current) {
      lightRef.current.position.x = Math.sin(performance.now() * 0.0005) * 8;
    }
  });
  return (
    <>
      <FitCamera />
      <ambientLight intensity={0.5} />
      <directionalLight
        ref={lightRef}
        position={[6, 10, 12]}
        intensity={1.2}
        castShadow
      />
      <Board
        board={board}
        piece={piece}
        clearingRows={clearingRows}
        clearPhase={clearPhase}
        yNudge={yNudge}
      />
      <OrbitControls enablePan={false} enableZoom={false} target={[0, 0, 0]} />
    </>
  );
}

export default function App() {
  const {
    board,
    piece,
    nextPiece,
    score,
    gameOver,
    clearingRows,
    clearPhase,
    move,
    rotateCW,
    softDrop,
    hardDrop,
  } = useGameLogic();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [, setBarVisible] = useState(true);
  const hideRef = useRef(null);

  const markInteract = useCallback(() => {
    setBarVisible(true);
    if (hideRef.current) clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => setBarVisible(false), 2000);
  }, []);

  useEffect(() => {
    // show initially, then auto-hide
    markInteract();
    const onKey = () => markInteract();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markInteract]);

  return (
    <div className="fixed inset-0 bg-neutral-900">
      <Canvas
        shadows
        camera={{ position: [0, 0, 50], fov: 45 }}
        style={{ width: "100vw", height: "100svh" }}
      >
        <Scene
          board={board}
          piece={piece}
          clearingRows={clearingRows}
          clearPhase={clearPhase}
        />
      </Canvas>
      <HUD score={score} gameOver={gameOver} nextPiece={nextPiece} />
      <BottomSheet
        open={sheetOpen}
        onClose={(v) => setSheetOpen(!!v)}
        nextPiece={nextPiece}
      />
      <GestureLayer
        onLeft={() => move(-1)}
        onRight={() => move(1)}
        onRotate={rotateCW}
        onSoft={softDrop}
        onHard={hardDrop}
        onInteract={markInteract}
      />
      <GameOverOverlay gameOver={gameOver} />
      <div className="absolute bottom-4 left-4 text-xs text-white/70 z-[50]">
        Vibe Coded. Contribute here: <a href="https://github.com/rjjoaquin/tetris-on-vibes">Github Repo</a>
      </div>
    </div>
  );
}
