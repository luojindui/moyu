/** 精灵表加载与网格切帧（所有表均为 16×16 网格） */
export interface SpriteSheetSpec {
  src: string;
  cols: number;
  rows: number;
  frame: number; // 正方形帧边长（16）
}

export class SpriteGrid {
  readonly img: HTMLImageElement;
  readonly cols: number;
  readonly rows: number;
  readonly frame: number;
  readonly loaded: boolean;

  private constructor(img: HTMLImageElement, spec: SpriteSheetSpec) {
    this.img = img;
    this.cols = spec.cols;
    this.rows = spec.rows;
    this.frame = spec.frame;
    this.loaded = true;
  }

  static load(spec: SpriteSheetSpec): Promise<SpriteGrid> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(new SpriteGrid(img, spec));
      img.onerror = () => reject(new Error(`sprite load failed: ${spec.src}`));
      img.src = spec.src;
    });
  }

  /** 在 (x,y)（虚拟坐标=帧×scale 前的左上角）绘制某帧，scale 为整数放大倍数 */
  draw(ctx: CanvasRenderingContext2D, col: number, row: number, x: number, y: number, scale: number): void {
    const sx = col * this.frame;
    const sy = row * this.frame;
    ctx.drawImage(this.img, sx, sy, this.frame, this.frame, x * scale, y * scale, this.frame * scale, this.frame * scale);
  }
}

/** 帧位置（col,row）的非透明像素计数，用于动画行选择与诊断 */
export async function frameActivity(grid: SpriteGrid, canvas: HTMLCanvasElement): Promise<number[][]> {
  const off = canvas.getContext("2d")!;
  const { frame, cols, rows } = grid;
  off.canvas.width = grid.img.width;
  off.canvas.height = grid.img.height;
  off.drawImage(grid.img, 0, 0);
  const data = off.getImageData(0, 0, grid.img.width, grid.img.height).data;
  const map: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const rowCells: number[] = [];
    for (let c = 0; c < cols; c++) {
      let count = 0;
      for (let py = 0; py < frame; py++) {
        for (let px = 0; px < frame; px++) {
          const i = ((r * frame + py) * grid.img.width + c * frame + px) * 4 + 3; // alpha
          if (data[i]! > 0) count++;
        }
      }
      rowCells.push(count);
    }
    map.push(rowCells);
  }
  return map;
}
