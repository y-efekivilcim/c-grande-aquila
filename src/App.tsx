import { useEffect, useRef, useState, useCallback } from 'react';
import './index.css';

interface VisNode {
  x: number;
  y: number;
  ox: number;
  oy: number;
  layer: number;
  idx: number;
  r: number;
}

const QUOTE_LINES = [
  "Why should the eye behold, not palaces of kings,",
  "To see how they were ruined by tumults of the times?",
  "The spider weaves the curtains in the palace,",
  "The owl calls the watches in the towers."
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const nodesRef = useRef<VisNode[]>([]);
  const layerNodesRef = useRef<VisNode[][]>([]);
  const weightsRef = useRef<Float32Array[]>([]);
  const sizesRef = useRef<number[]>([]);
  const dragRef = useRef<VisNode | null>(null);
  const entropyRef = useRef(0);
  const builtRef = useRef(false);

  const [text, setText] = useState("");
  const [loss, setLoss] = useState(3.5);

  const buildNodes = useCallback((w: number, h: number, layers: number[]) => {
    const nodes: VisNode[] = [];
    const layerArr: VisNode[][] = Array(layers.length).fill(null).map(() => []);
    
    const caps = layers.map((s, i) => {
      if (i === 0 || i === layers.length - 1) return 5;
      return Math.min(s, 8);
    });
    
    const px = Math.max(w * 0.2, 50);
    const py = Math.max(h * 0.1, 40);
    const uw = w - px * 2;

    for (let l = 0; l < layers.length; l++) {
      const n = caps[l];
      const uh = h - py * 2;
      const sy = uh / (n + 1);
      const x = px + (uw / (layers.length - 1)) * l;
      
      const totalH = sy * n;
      const startY = py + (uh - totalH) / 2 + sy / 2;
      
      for (let j = 0; j < n; j++) {
        const idx = Math.floor((j / n) * layers[l]);
        const node = { x, y: startY + sy * j, ox: x, oy: startY + sy * j, layer: l, idx, r: 5 };
        nodes.push(node);
        layerArr[l].push(node);
      }
    }
    nodesRef.current = nodes;
    layerNodesRef.current = layerArr;
    builtRef.current = true;
  }, []);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    workerRef.current = new Worker(
      new URL('./engine/worker.ts', import.meta.url),
      { type: 'module' }
    );

    workerRef.current.onmessage = (e) => {
      if (e.data.type !== 'SYNC') return;
      const p = e.data.payload;
      if (p.text) setText(p.text);
      setLoss(p.loss);
      weightsRef.current = p.weights;
      sizesRef.current = p.layers;
      if (!builtRef.current && cvs.width > 0) buildNodes(cvs.width, cvs.height, p.layers);
    };
    workerRef.current.postMessage({ type: 'START' });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === cvs.parentElement) {
          cvs.width = entry.contentRect.width;
          cvs.height = entry.contentRect.height;
          if (sizesRef.current.length > 0) buildNodes(cvs.width, cvs.height, sizesRef.current);
        }
      }
    });
    
    if (cvs.parentElement) {
      resizeObserver.observe(cvs.parentElement);
      cvs.width = cvs.parentElement.clientWidth;
      cvs.height = cvs.parentElement.clientHeight;
    }

    const hitTest = (mx: number, my: number): VisNode | null => {
      for (const n of nodesRef.current) {
        if ((mx - n.x) ** 2 + (my - n.y) ** 2 < (n.r + 8) ** 2) return n;
      }
      return null;
    };

    const down = (e: MouseEvent | TouchEvent) => {
      const r = cvs.getBoundingClientRect();
      const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
      dragRef.current = hitTest(cx - r.left, cy - r.top);
      if (dragRef.current && 'touches' in e) e.preventDefault();
    };
    
    const move = (e: MouseEvent | TouchEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const r = cvs.getBoundingClientRect();
      const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
      d.x = Math.max(d.r, Math.min(cvs.width - d.r, cx - r.left));
      d.y = Math.max(d.r, Math.min(cvs.height - d.r, cy - r.top));
      if ('touches' in e) e.preventDefault();
    };
    
    const up = () => { dragRef.current = null; };

    cvs.addEventListener('mousedown', down);
    cvs.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);

    let af = 0;
    const draw = () => {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      const nodes = nodesRef.current;
      const layerNodes = layerNodesRef.current;
      const sizes = sizesRef.current;
      const weights = weightsRef.current;

      let totalDisp = 0;
      for (const n of nodes) {
        if (n !== dragRef.current) {
          n.x += (n.ox - n.x) * 0.04;
          n.y += (n.oy - n.y) * 0.04;
        }
        const dx = n.x - n.ox, dy = n.y - n.oy;
        totalDisp += Math.sqrt(dx * dx + dy * dy);
      }
      
      const entropy = Math.min(1, totalDisp / 1200);
      entropyRef.current = entropy;

      if (entropy > 0.01 && workerRef.current) {
        workerRef.current.postMessage({ type: 'ENTROPY', payload: entropy });
      }

      ctx.lineCap = 'round';
      
      ctx.beginPath();
      let posPathCount = 0;
      for (let li = 1; li < sizes.length; li++) {
        const prev = layerNodes[li - 1];
        const curr = layerNodes[li];
        if (!prev || !curr) continue;
        const wa = weights[li - 1];
        if (!wa) continue;
        const ps = sizes[li - 1];

        const limit = Math.sqrt(6 / (sizes[li - 1] + sizes[li]));
        for (const b of curr) {
          for (const a of prev) {
            const raw = b.idx < sizes[li] && a.idx < ps ? wa[b.idx * ps + a.idx] : 0;
            const v = Math.abs(raw) / limit;
            if (v < 0.6) continue;
            
            if (raw > 0) {
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              posPathCount++;
            }
          }
        }
      }
      if (posPathCount > 0) {
        ctx.strokeStyle = `rgba(255, 107, 0, 0.45)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.beginPath();
      let negPathCount = 0;
      for (let li = 1; li < sizes.length; li++) {
        const prev = layerNodes[li - 1];
        const curr = layerNodes[li];
        if (!prev || !curr) continue;
        const wa = weights[li - 1];
        if (!wa) continue;
        const ps = sizes[li - 1];

        const limit = Math.sqrt(6 / (sizes[li - 1] + sizes[li]));
        for (const b of curr) {
          for (const a of prev) {
            const raw = b.idx < sizes[li] && a.idx < ps ? wa[b.idx * ps + a.idx] : 0;
            const v = Math.abs(raw) / limit;
            if (v < 0.6) continue;

            if (raw <= 0) {
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              negPathCount++;
            }
          }
        }
      }
      if (negPathCount > 0) {
        ctx.strokeStyle = `rgba(0, 163, 255, 0.45)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.fillStyle = '#E2E8F0';
      ctx.strokeStyle = '#FF6B00';
      ctx.lineWidth = 2;
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        const disp = Math.sqrt((n.x - n.ox) ** 2 + (n.y - n.oy) ** 2);
        if (disp > 10) {
            ctx.stroke();
        }
      }

      af = requestAnimationFrame(draw);
    };
    draw();

      return () => {
      resizeObserver.disconnect();
      cvs.removeEventListener('mousedown', down);
      cvs.removeEventListener('touchstart', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
      cancelAnimationFrame(af);
      workerRef.current?.terminate();
    };
  }, [buildNodes]);

  const entropy = entropyRef.current;
  const workerChaos = Math.max(0, Math.min(1, (loss - 0.8) / 2.5));
  const chaos = Math.max(entropy * 1.5, workerChaos);

  return (
    <div className="shell">
      <header className="top-row">
        <section className="card info-card">
          <h1 className="title">Grande Aquila</h1>
          <p className="desc">A neural network training in real-time. Drag the neurons to inject entropy.</p>
        </section>
        <section className="card quote-card">
          <div className="quote">
            {QUOTE_LINES.map((line, li) => {
              return (
                <div key={li} className="quote-line">
                  {line.split('').map((_, ci) => {
                    const genStr = text ? textToLine(text, li) : line;
                    const ch = ci < genStr.length ? genStr[ci] : ' ';
                    const hit = Math.random() < chaos;

                    if (!hit) return <span key={ci} className="ch">{ch}</span>;
                    
                    const jx = (Math.random() - 0.5) * chaos * 24;
                    const jy = (Math.random() - 0.5) * chaos * 24;
                    const glyph = Math.random() > 0.4
                      ? '!@#$%^&*?~;:><'[Math.floor(Math.random() * 15)]
                      : ch;
                      
                    const glitchColors = ['#FF6B00', '#00A3FF', '#E2E8F0'];
                    const color = glitchColors[Math.floor(Math.random() * glitchColors.length)];
                    
                    return (
                      <span
                        key={ci}
                        className="ch glitch"
                        style={{
                          transform: `translate(${jx}px, ${jy}px)`,
                          opacity: 0.6 + Math.random() * 0.4,
                          color: color
                        }}
                      >
                        {glyph}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      </header>
      <main className="web-container">
        <canvas ref={canvasRef} />
      </main>
    </div>
  );
}

function textToLine(text: string, lineIdx: number): string {
  const lines = text.split('\n');
  return lines[lineIdx] || ' ';
}
