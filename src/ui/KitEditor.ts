import { DESIGN_SIZE, PALETTE, contrastingKeeper, hex, kitPreview, newCustomKit, type Kit } from '../render/kits';
import { spriteCanvas } from '../render/sprites';

type Tool = 'pencil' | 'fill';

/**
 * Pixel painter for custom kits, in the spirit of Animal Crossing's pattern
 * designer: a 16×16 shirt grid, a 15-colour palette, pencil and fill, mirror
 * mode, plus shorts and socks colours. Returns the kit, or null on cancel.
 */
export class KitEditor {
  /** `stage` is the dual-screen host over the pitch screen (M9); the big preview goes there. */
  constructor(
    private readonly overlay: HTMLElement,
    private readonly stage: HTMLElement | null = null,
  ) {}

  run(initial?: Kit): Promise<{ kit: Kit; deleted?: boolean } | null> {
    return new Promise((resolve) => {
      const kit: Kit = initial ? JSON.parse(JSON.stringify(initial)) : newCustomKit('My kit');
      if (!kit.design) kit.design = newCustomKit('').design;
      const design = kit.design!;
      const n = design.size || DESIGN_SIZE;
      let color = 2;
      let tool: Tool = 'pencil';
      let mirror = true;
      let painting = false;

      const root = document.createElement('div');
      root.className = 'kit-editor';
      root.innerHTML = `
        <div class="ke-head">
          <input class="ke-name" data-name maxlength="18" placeholder="Kit name" />
          <div class="ke-actions">
            ${initial ? '<button data-delete>Delete</button>' : ''}
            <button data-cancel>Cancel</button>
            <button class="primary" data-save>Save</button>
          </div>
        </div>
        <div class="ke-body">
          <div class="ke-left">
            <canvas class="ke-grid" data-grid></canvas>
            <div class="ke-tools">
              <button data-tool="pencil" class="armed">✏️ Pencil</button>
              <button data-tool="fill">🪣 Fill</button>
              <button data-mirror class="armed">⇔ Mirror</button>
              <button data-clear>Clear</button>
            </div>
          </div>
          <div class="ke-right">
            <div class="ke-label">Colour</div>
            <div class="ke-palette" data-palette></div>
            <div class="ke-label">Shorts</div>
            <div class="ke-palette small" data-shorts></div>
            <div class="ke-label">Socks</div>
            <div class="ke-palette small" data-socks></div>
            <div class="ke-label">Preview</div>
            <div class="ke-preview" data-preview></div>
          </div>
        </div>`;
      this.overlay.appendChild(root);
      // On two screens the grid stays on the pane and this blown-up preview takes the pitch screen.
      const big = document.createElement('div');
      big.className = 'ke-stage';
      this.stage?.appendChild(big);

      const nameInput = root.querySelector<HTMLInputElement>('[data-name]')!;
      nameInput.value = kit.name;
      const grid = root.querySelector<HTMLCanvasElement>('[data-grid]')!;
      const ctx = grid.getContext('2d')!;
      const preview = root.querySelector<HTMLElement>('[data-preview]')!;

      const cellPx = () => grid.width / n;
      const sizeGrid = () => {
        // The editor is sized to its screen (the pane on a dual-screen device), so measure it, not the window.
        const r = root.getBoundingClientRect();
        const side = Math.min(r.width - 32, r.height * 0.55, 420);
        const cell = Math.max(8, Math.floor(side / n));
        grid.width = cell * n;
        grid.height = cell * n;
        grid.style.width = `${grid.width}px`;
        grid.style.height = `${grid.height}px`;
        drawGrid();
      };

      const drawGrid = () => {
        const c = cellPx();
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            ctx.fillStyle = hex(PALETTE[design.pixels[y * n + x]]);
            ctx.fillRect(x * c, y * c, c, c);
          }
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= n; i++) {
          ctx.beginPath();
          ctx.moveTo(i * c + 0.5, 0);
          ctx.lineTo(i * c + 0.5, grid.height);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, i * c + 0.5);
          ctx.lineTo(grid.width, i * c + 0.5);
          ctx.stroke();
        }
        if (mirror) {
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(grid.width / 2, 0);
          ctx.lineTo(grid.width / 2, grid.height);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      };

      const syncColors = () => {
        // Jersey base = most used colour, for anything that still reads kit.jersey.
        const counts = new Map<number, number>();
        for (const p of design.pixels) counts.set(p, (counts.get(p) ?? 0) + 1);
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
        kit.jersey = PALETTE[top];
        kit.jersey2 = PALETTE[top];
        kit.keeper = contrastingKeeper(kit.jersey);
      };

      const refreshPreview = () => {
        syncColors();
        preview.innerHTML = '';
        preview.appendChild(kitPreview(kit, 8));
        preview.appendChild(spriteCanvas('stand', kit, false, 4));
        preview.appendChild(spriteCanvas('run1', kit, false, 4));
        big.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'ke-stage-title';
        title.textContent = nameInput.value.trim() || kit.name;
        const row = document.createElement('div');
        row.className = 'ke-stage-row';
        row.append(kitPreview(kit, 8), spriteCanvas('stand', kit, false, 5), spriteCanvas('run1', kit, false, 5), spriteCanvas('kick', kit, false, 5), spriteCanvas('stand', kit, true, 5));
        big.append(title, row);
      };
      nameInput.addEventListener('input', refreshPreview);

      const swatches = (host: HTMLElement, get: () => number, set: (i: number) => void) => {
        host.innerHTML = '';
        PALETTE.forEach((c, i) => {
          const b = document.createElement('button');
          b.className = 'swatch' + (get() === i ? ' active' : '');
          b.style.background = hex(c);
          b.title = hex(c);
          b.addEventListener('click', () => {
            set(i);
            refreshAll();
          });
          host.appendChild(b);
        });
      };
      const refreshAll = () => {
        swatches(root.querySelector('[data-palette]')!, () => color, (i) => (color = i));
        swatches(root.querySelector('[data-shorts]')!, () => PALETTE.indexOf(kit.shorts), (i) => (kit.shorts = PALETTE[i]));
        swatches(root.querySelector('[data-socks]')!, () => PALETTE.indexOf(kit.socks), (i) => (kit.socks = PALETTE[i]));
        root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('armed', b.dataset.tool === tool));
        root.querySelector('[data-mirror]')!.classList.toggle('armed', mirror);
        drawGrid();
        refreshPreview();
      };

      const paint = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= n || y >= n) return;
        const set = (px: number, py: number) => (design.pixels[py * n + px] = color);
        if (tool === 'fill') {
          const target = design.pixels[y * n + x];
          if (target === color) return;
          const stack = [[x, y]];
          while (stack.length) {
            const [cx, cy] = stack.pop()!;
            if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
            if (design.pixels[cy * n + cx] !== target) continue;
            set(cx, cy);
            stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
          }
        } else {
          set(x, y);
          if (mirror) set(n - 1 - x, y);
        }
      };

      const cellOf = (e: PointerEvent) => {
        const r = grid.getBoundingClientRect();
        return [Math.floor(((e.clientX - r.left) / r.width) * n), Math.floor(((e.clientY - r.top) / r.height) * n)];
      };
      let lastCell: [number, number] | null = null;
      /** Paint every cell on the line from the previous pointer cell, so fast strokes leave no gaps. */
      const stroke = (x: number, y: number) => {
        if (!lastCell) {
          paint(x, y);
        } else {
          const [x0, y0] = lastCell;
          const steps = Math.max(Math.abs(x - x0), Math.abs(y - y0), 1);
          for (let s = 1; s <= steps; s++) paint(Math.round(x0 + ((x - x0) * s) / steps), Math.round(y0 + ((y - y0) * s) / steps));
        }
        lastCell = [x, y];
      };
      grid.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        painting = true;
        lastCell = null;
        try {
          grid.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        const [x, y] = cellOf(e);
        stroke(x, y);
        drawGrid();
      });
      grid.addEventListener('pointermove', (e) => {
        if (!painting || tool === 'fill') return;
        const [x, y] = cellOf(e);
        stroke(x, y);
        drawGrid();
      });
      const stop = () => {
        if (!painting) return;
        painting = false;
        refreshPreview();
      };
      grid.addEventListener('pointerup', stop);
      grid.addEventListener('pointercancel', stop);

      root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
        b.addEventListener('click', () => {
          tool = b.dataset.tool as Tool;
          refreshAll();
        }),
      );
      root.querySelector('[data-mirror]')!.addEventListener('click', () => {
        mirror = !mirror;
        refreshAll();
      });
      root.querySelector('[data-clear]')!.addEventListener('click', () => {
        design.pixels.fill(color);
        refreshAll();
      });

      const close = (result: { kit: Kit; deleted?: boolean } | null) => {
        window.removeEventListener('resize', sizeGrid);
        root.remove();
        big.remove();
        resolve(result);
      };
      root.querySelector('[data-cancel]')!.addEventListener('click', () => close(null));
      root.querySelector('[data-save]')!.addEventListener('click', () => {
        kit.name = nameInput.value.trim() || 'My kit';
        syncColors();
        close({ kit });
      });
      root.querySelector('[data-delete]')?.addEventListener('click', () => close({ kit, deleted: true }));

      window.addEventListener('resize', sizeGrid);
      sizeGrid();
      refreshAll();
    });
  }
}
