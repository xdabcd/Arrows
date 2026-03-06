import { _decorator, Component, Node, Prefab, instantiate, Vec3 } from 'cc';
import { ArrowRenderer } from './ArrowRenderer';
import { ArrowPoint } from './ArrowData';
const { ccclass, property } = _decorator;

function pointKey(col: number, row: number): string {
    return `${col},${row}`;
}

/** 线段 a→b 经过的所有格点（含端点），Bresenham 直线 */
function getGridPointsOnSegment(a: ArrowPoint, b: ArrowPoint): ArrowPoint[] {
    const out: ArrowPoint[] = [];
    let c0 = a.col, r0 = a.row, c1 = b.col, r1 = b.row;
    const dc = Math.abs(c1 - c0), dr = Math.abs(r1 - r0);
    const sc = c0 < c1 ? 1 : -1, sr = r0 < r1 ? 1 : -1;
    if (dc >= dr) {
        let err = 2 * dr - dc;
        for (let i = 0; i <= dc; i++) {
            out.push({ col: c0, row: r0 });
            if (c0 === c1) break;
            if (err > 0) { r0 += sr; err -= 2 * dc; }
            err += 2 * dr;
            c0 += sc;
        }
    } else {
        let err = 2 * dc - dr;
        for (let i = 0; i <= dr; i++) {
            out.push({ col: c0, row: r0 });
            if (r0 === r1) break;
            if (err > 0) { c0 += sc; err -= 2 * dr; }
            err += 2 * dc;
            r0 += sr;
        }
    }
    return out;
}

/** 点 p 是否在线段 a-b 上（共线且在 a、b 之间或为端点） */
function isOnSegment(p: ArrowPoint, a: ArrowPoint, b: ArrowPoint): boolean {
    const dc1 = b.col - a.col, dr1 = b.row - a.row;
    const dc2 = p.col - a.col, dr2 = p.row - a.row;
    if (dc1 * dr2 !== dr1 * dc2) return false;
    const cMin = Math.min(a.col, b.col), cMax = Math.max(a.col, b.col);
    const rMin = Math.min(a.row, b.row), rMax = Math.max(a.row, b.row);
    return p.col >= cMin && p.col <= cMax && p.row >= rMin && p.row <= rMax;
}

/**
 * 箭头管理器：根据数据和箭头预制件生成、管理多条箭头；维护棋盘点占用。
 * 占用规则：箭头线上经过的所有格点（含顶点和线段经过的格点）均视为被占用。
 * 箭头预制件需在根节点上挂 ArrowRenderer，并已在预制件内填好 Arrow Head/Body Prefab。
 */
@ccclass('ArrowManager')
export class ArrowManager extends Component {

    @property(Prefab)
    arrowPrefab: Prefab | null = null;

    /** 箭头实例的父节点，positions 需与该节点局部坐标系一致；不填则用本节点 */
    @property(Node)
    arrowContainer: Node | null = null;

    private _arrowNodes: Node[] = [];
    /** 每条箭头对应的格点路径（与 _arrowNodes 一一对应） */
    private _arrowPaths: ArrowPoint[][] = [];
    private _previewNode: Node | null = null;
    /** 当前被已确认箭头占用的格点 (col,row) 集合 */
    private _occupiedPoints = new Set<string>();
    /** 当前正在编辑的路径占用的格点（与 _fullPath 同步，由编辑器在更新路径时调用 setEditingPath） */
    private _editingPathPoints = new Set<string>();

    /** 判定棋盘中的点 (col, row) 是否已被占用（含已确认箭头 + 当前编辑路径） */
    isPointOccupied(col: number, row: number): boolean {
        const key = pointKey(col, row);
        return this._occupiedPoints.has(key) || this._editingPathPoints.has(key);
    }

    /**
     * 设置当前编辑路径，用于更新占据点。路径上所有线段经过的格点会参与 isPointOccupied。
     * 传 null 或不足 2 个点则清空编辑路径占点。
     */
    setEditingPath(points: ArrowPoint[] | null): void {
        this._editingPathPoints.clear();
        if (points && points.length >= 2) {
            for (let i = 0; i < points.length - 1; i++) {
                for (const p of getGridPointsOnSegment(points[i], points[i + 1])) {
                    this._editingPathPoints.add(pointKey(p.col, p.row));
                }
            }
        }
    }

    /**
     * 添加一条箭头并显示（身体和头在箭头节点下生成），并占用该箭头线上经过的所有格点（顶点+线段经过的格点）。
     * @param positions 顺序位置点（至少 2 个），与 arrowContainer 同坐标系
     * @param points 对应的格点列表，用于占用判定；不传则不占用
     * @returns 生成的箭头节点，失败返回 null
     */
    addArrow(positions: Vec3[], points?: ArrowPoint[]): Node | null {
        if (!positions || positions.length < 2 || !this.arrowPrefab) return null;
        const toOccupy: string[] = [];
        if (points && points.length >= 2) {
            for (let i = 0; i < points.length - 1; i++) {
                for (const p of getGridPointsOnSegment(points[i], points[i + 1])) {
                    const key = pointKey(p.col, p.row);
                    toOccupy.push(key);
                    this._occupiedPoints.add(key);
                }
            }
        }
        const container = this.arrowContainer || this.node;
        const node = instantiate(this.arrowPrefab);
        const renderer = node.getComponent(ArrowRenderer);
        if (!renderer) {
            node.destroy();
            for (const key of toOccupy) this._occupiedPoints.delete(key);
            return null;
        }
        node.setParent(container);
        renderer.buildArrow(positions);
        this._arrowNodes.push(node);
        this._arrowPaths.push(points && points.length >= 2 ? points.slice() : []);
        return node;
    }

    /**
     * 若 (col, row) 被某条箭头占据，则移除该箭头、释放占用，并返回「回退到该点」的路径（从起点到该点，含端点）。
     * 若该点恰为路径顶点，返回起点到该顶点的路径；若在边上，返回起点到该边起点的路径并加上该点。
     * 若未被占据或找不到则返回 null。
     */
    takeOverArrowAtPoint(col: number, row: number): ArrowPoint[] | null {
        const point: ArrowPoint = { col, row };
        for (let i = 0; i < this._arrowPaths.length; i++) {
            const path = this._arrowPaths[i];
            for (let j = 0; j < path.length; j++) {
                if (path[j].col === col && path[j].row === row) {
                    const truncated = path.slice(0, j + 1);
                    this._removeArrowAtIndex(i);
                    return truncated;
                }
            }
            for (let j = 0; j < path.length - 1; j++) {
                if (isOnSegment(point, path[j], path[j + 1])) {
                    const truncated = path.slice(0, j + 1).concat([{ col, row }]);
                    this._removeArrowAtIndex(i);
                    return truncated;
                }
            }
        }
        return null;
    }

    private _removeArrowAtIndex(index: number): void {
        const path = this._arrowPaths[index];
        if (path && path.length >= 2) {
            for (let i = 0; i < path.length - 1; i++) {
                for (const p of getGridPointsOnSegment(path[i], path[i + 1])) {
                    this._occupiedPoints.delete(pointKey(p.col, p.row));
                }
            }
        }
        this._arrowNodes[index].destroy();
        this._arrowNodes.splice(index, 1);
        this._arrowPaths.splice(index, 1);
    }

    /** 移除所有已添加的箭头并清空占用 */
    clearAll(): void {
        for (const n of this._arrowNodes) {
            n.destroy();
        }
        this._arrowNodes = [];
        this._arrowPaths = [];
        this._occupiedPoints.clear();
        this.clearPreview();
    }

    /**
     * 设置预览箭头（实时绘制时用）；positions 不足 2 个时会清除预览。
     */
    setPreviewArrow(positions: Vec3[]): void {
        if (!positions || positions.length < 2) {
            this.clearPreview();
            return;
        }
        if (!this.arrowPrefab) return;
        if (!this._previewNode) {
            const container = this.arrowContainer || this.node;
            this._previewNode = instantiate(this.arrowPrefab);
            this._previewNode.setParent(container);
        }
        const renderer = this._previewNode.getComponent(ArrowRenderer);
        if (renderer) renderer.buildArrow(positions);
    }

    /** 清除预览箭头 */
    clearPreview(): void {
        if (this._previewNode) {
            this._previewNode.destroy();
            this._previewNode = null;
        }
    }

    getArrowCount(): number {
        return this._arrowNodes.length;
    }
}
