import { _decorator, Color, Component, Node, Prefab, Sprite, UIOpacity, instantiate, Vec3 } from 'cc';
import { ArrowRenderer } from './ArrowRenderer';
import { ArrowPoint } from './ArrowData';
import { getArrowColor } from './ArrowColors';
import type { LevelArrowData } from '../level/LevelConfig';
const { ccclass, property } = _decorator;
const BLOCK_BOUNCE_COLOR = new Color(255, 70, 70, 255);
const BLOCK_BOUNCE_EARLY_GRIDS = 0.6;
const BLOCK_COLOR_LERP_DURATION = 0.15;
const OVERLAY_FLASH_IN_SECONDS = 3 / 60;
const OVERLAY_FLASH_OUT_SECONDS = 12 / 60;
const OVERLAY_PEAK_ALPHA_01 = 0.5;
const POINT_TRAIL_PULSE_DURATION = 0.3;
const POINT_TRAIL_MAX_SCALE = 2.5;
const POINT_TRAIL_DELAY_AFTER_PASS = 0.1;
const POINT_TRAIL_DEBUG_INSTANT_SCALE = false;

/** 接管箭头结果：回退后的路径 + 颜色序列号 */
export interface TakeOverResult {
    path: ArrowPoint[];
    colorIndex: number;
}

function pointKey(col: number, row: number): string {
    return `${col},${row}`;
}

function gcdInt(a: number, b: number): number {
    a = Math.abs(Math.trunc(a));
    b = Math.abs(Math.trunc(b));
    while (b !== 0) {
        const t = a % b;
        a = b;
        b = t;
    }
    return a;
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

/** 棋盘边界（与 LevelEditorBoard 中心坐标系一致） */
export interface BoardBounds {
    colMin: number;
    colMax: number;
    rowMin: number;
    rowMax: number;
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

    /** 受击屏幕红色遮罩（Canvas 下 DmgOverlay），仅在阻挡回弹时闪烁警示 */
    @property(Node)
    dmgOverlay: Node | null = null;

    private _arrowNodes: Node[] = [];
    /** 每条箭头对应的格点路径（与 _arrowNodes 一一对应） */
    private _arrowPaths: ArrowPoint[][] = [];
    /** 每条箭头对应的颜色序列号（与 _arrowNodes 一一对应） */
    private _arrowColors: number[] = [];
    /** 每条箭头是否已因阻挡回弹而标红（与 _arrowNodes 一一对应） */
    private _arrowBlockedRed: boolean[] = [];
    private _previewNode: Node | null = null;
    /** 当前被已确认箭头占用的格点 (col,row) 集合 */
    private _occupiedPoints = new Set<string>();
    /** 当前正在编辑的路径占用的格点（与 _fullPath 同步，由编辑器在更新路径时调用 setEditingPath） */
    private _editingPathPoints = new Set<string>();
    private _isSliding = false;
    /** 滑出动画上下文 */
    private _slideOutCtx: {
        arrowIndex: number;
        node: Node;
        renderer: ArrowRenderer;
        totalDistance: number;
        unitGridDistance: number;
        initialSpeed: number;
        acceleration: number;
        totalDuration: number;
        elapsed: number;
        phase: 'out' | 'back';
        isBlockedBounce: boolean;
        originalColor: Color;
        initialPositions: Vec3[];
        firstBlockStep: number;
        colorLerpElapsed: number;
        colorLerpDuration: number;
        colorLerpFrom: Color;
        colorLerpTo: Color;
        lastOutMoved: number;
    } | null = null;
    private _dmgOverlayOpacity: UIOpacity | null = null;
    private _dmgOverlayFlashCtx: {
        phase: 'in' | 'out';
        elapsed: number;
    } | null = null;
    private _pointTrailPending: {
        node: Node;
        triggerDistance: number;
    }[] = [];
    private _pointTrailDelayed: {
        node: Node;
        startAt: number;
    }[] = [];
    private _pointTrailActive: {
        node: Node;
        baseScale: Vec3;
        elapsed: number;
    }[] = [];
    private _pointTrailClock = 0;

    /** 匀加速标尺：从静止出发，移动第 1 格耗时 3 帧（60fps 参考）。 */
    private _getSlideOutSecondsPerGrid(): number {
        const refFps = 60;
        const framesPerStep = 3;
        return framesPerStep / refFps;
    }

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
     * @param colorIndex 颜色序列号，对应 ArrowColors 列表；默认 0
     * @returns 生成的箭头节点，失败返回 null
     */
    addArrow(positions: Vec3[], points?: ArrowPoint[], colorIndex: number = 0): Node | null {
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
        renderer.buildArrow(positions, getArrowColor(colorIndex));
        this._arrowNodes.push(node);
        this._arrowPaths.push(points && points.length >= 2 ? points.slice() : []);
        this._arrowColors.push(colorIndex);
        this._arrowBlockedRed.push(false);
        return node;
    }

    /**
     * 若 (col, row) 被某条箭头占据，则移除该箭头、释放占用，并返回「回退到该点」的路径与颜色序列号。
     * 若未被占据或找不到则返回 null。
     */
    takeOverArrowAtPoint(col: number, row: number): TakeOverResult | null {
        const point: ArrowPoint = { col, row };
        for (let i = 0; i < this._arrowPaths.length; i++) {
            const path = this._arrowPaths[i];
            const colorIndex = this._arrowColors[i] ?? 0;
            for (let j = 0; j < path.length; j++) {
                if (path[j].col === col && path[j].row === row) {
                    const truncated = path.slice(0, j + 1);
                    this._removeArrowAtIndex(i);
                    return { path: truncated, colorIndex };
                }
            }
            for (let j = 0; j < path.length - 1; j++) {
                if (isOnSegment(point, path[j], path[j + 1])) {
                    const truncated = path.slice(0, j + 1).concat([{ col, row }]);
                    this._removeArrowAtIndex(i);
                    return { path: truncated, colorIndex };
                }
            }
        }
        return null;
    }

    private _removeArrowAtIndex(index: number): void {
        const path = this._arrowPaths[index];
        this._releaseOccupiedForPath(path);
        this._arrowNodes[index].destroy();
        this._arrowNodes.splice(index, 1);
        this._arrowPaths.splice(index, 1);
        this._arrowColors.splice(index, 1);
        this._arrowBlockedRed.splice(index, 1);
    }

    private _releaseOccupiedForPath(path: ArrowPoint[] | undefined): void {
        if (!path || path.length < 2) return;
        for (let i = 0; i < path.length - 1; i++) {
            for (const p of getGridPointsOnSegment(path[i], path[i + 1])) {
                this._occupiedPoints.delete(pointKey(p.col, p.row));
            }
        }
    }

    onDestroy(): void {
        this._abortSlideOutAnimation();
        this._stopDmgOverlayFlash();
        this._stopPointTrailFx(true);
    }

    /** 移除所有已添加的箭头并清空占用 */
    clearAll(): void {
        this._abortSlideOutAnimation();
        this._stopPointTrailFx(true);
        for (const n of this._arrowNodes) {
            n.destroy();
        }
        this._arrowNodes = [];
        this._arrowPaths = [];
        this._arrowColors = [];
        this._arrowBlockedRed = [];
        this._occupiedPoints.clear();
        this.clearPreview();
    }

    /**
     * 设置预览箭头（实时绘制时用）；positions 不足 2 个时会清除预览。
     * @param colorIndex 颜色序列号，默认 0
     */
    setPreviewArrow(positions: Vec3[], colorIndex: number = 0): void {
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
        if (renderer) renderer.buildArrow(positions, getArrowColor(colorIndex));
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

    /** 获取所有箭头的路径与颜色，用于保存关卡 */
    getAllArrowData(): LevelArrowData[] {
        const out: LevelArrowData[] = [];
        for (let i = 0; i < this._arrowPaths.length; i++) {
            const path = this._arrowPaths[i];
            const colorIndex = this._arrowColors[i] ?? 0;
            if (path && path.length >= 2) {
                out.push({
                    points: path.map(p => ({ col: p.col, row: p.row })),
                    colorIndex
                });
            }
        }
        return out;
    }

    /**
     * 根据关卡数据加载箭头（会先清空现有箭头）。
     * @param arrows 箭头列表
     * @param getPosition 格点转世界位置的函数，通常用 board.getPointPosition
     */
    loadFromData(arrows: LevelArrowData[], getPosition: (col: number, row: number) => Vec3): void {
        this.clearAll();
        for (const a of arrows) {
            if (!a.points || a.points.length < 2) continue;
            const positions = a.points.map(p => getPosition(p.col, p.row));
            const points = a.points.map(p => ({ col: p.col, row: p.row }));
            this.addArrow(positions, points, a.colorIndex ?? 0);
        }
    }

    /**
     * 获取指定箭头占据的所有格点（路径上每段线段经过的格点）
     */
    getArrowOccupiedPoints(arrowIndex: number): Set<string> {
        const out = new Set<string>();
        const path = this._arrowPaths[arrowIndex];
        if (!path || path.length < 2) return out;
        for (let i = 0; i < path.length - 1; i++) {
            for (const p of getGridPointsOnSegment(path[i], path[i + 1])) {
                out.add(pointKey(p.col, p.row));
            }
        }
        return out;
    }

    /**
     * 获取除指定箭头外，其它箭头占据的格点集合（用于判断是否阻挡）
     */
    getOccupiedPointsExcludingArrow(arrowIndex: number): Set<string> {
        const other = new Set<string>(this._occupiedPoints);
        const self = this.getArrowOccupiedPoints(arrowIndex);
        for (const k of self) other.delete(k);
        return other;
    }

    /**
     * 沿箭头自身路径方向延伸路径：按箭头方向（末段指向）在路径末尾追加格点，直到足够滑出棋盘。
     */
    private getExtendedPathForSlide(path: ArrowPoint[], bounds: BoardBounds): ArrowPoint[] {
        const k = path.length;
        if (k < 2) return path.slice();
        const rawDCol = path[k - 1].col - path[k - 2].col;
        const rawDRow = path[k - 1].row - path[k - 2].row;
        if (rawDCol === 0 && rawDRow === 0) return path.slice();
        const g = gcdInt(rawDCol, rawDRow);
        const dCol = g > 0 ? rawDCol / g : rawDCol;
        const dRow = g > 0 ? rawDRow / g : rawDRow;
        const { colMin, colMax, rowMin, rowMax } = bounds;
        /** 基础延伸 + 额外格数，保证滑出动画末端仍有足够顶点可插值 */
        const maxExtend = (colMax - colMin + 1) + (rowMax - rowMin + 1) + 32;
        const extended: ArrowPoint[] = path.slice();
        for (let i = 1; i <= maxExtend; i++) {
            extended.push({
                col: path[k - 1].col + i * dCol,
                row: path[k - 1].row + i * dRow
            });
        }
        return extended;
    }

    /**
     * 在延伸路径上，取从 extended[start] 起、长度为 pathLen 的连续顶点构成的折线所占据的格点。
     */
    private getOccupiedAtStep(extended: ArrowPoint[], start: number, pathLen: number): Set<string> {
        const out = new Set<string>();
        for (let i = 0; i < pathLen - 1; i++) {
            const a = extended[start + i];
            const b = extended[start + i + 1];
            if (a == null || b == null) break;
            for (const p of getGridPointsOnSegment(a, b)) {
                out.add(pointKey(p.col, p.row));
            }
        }
        return out;
    }

    private isInBounds(col: number, row: number, bounds: BoardBounds): boolean {
        return col >= bounds.colMin && col <= bounds.colMax && row >= bounds.rowMin && row <= bounds.rowMax;
    }

    /**
     * 判断某箭头沿自身路径方向（箭头指向）按路径一步步滑出棋盘时，是否会被其它箭头的占据点阻挡。
     * 滑出方式：路径顶点沿路径向前移动，每步后箭头占据「当前段」路径上的格点，直到整条箭头移出棋盘。
     */
    canArrowSlideOutAlongPath(arrowIndex: number, bounds: BoardBounds): boolean {
        const path = this._arrowPaths[arrowIndex];
        if (!path || path.length < 2) return false;
        const extended = this.getExtendedPathForSlide(path, bounds);
        const pathLen = path.length;
        const otherOccupied = this.getOccupiedPointsExcludingArrow(arrowIndex);
        const maxStep = extended.length - pathLen;

        for (let t = 1; t <= maxStep; t++) {
            const occupied = this.getOccupiedAtStep(extended, t, pathLen);
            let allOut = true;
            for (const key of occupied) {
                const [c, r] = key.split(',').map(Number);
                if (this.isInBounds(c, r, bounds)) {
                    allOut = false;
                    if (otherOccupied.has(key)) return false;
                }
            }
            if (allOut) return true;
        }
        return false;
    }

    /**
     * 找出当前关卡中，可以沿自身路径方向滑出棋盘且不被其它箭头占据点阻挡的箭头（按箭头索引列表返回）。
     * @param bounds 棋盘边界，与 LevelEditorBoard 中心坐标系一致
     */
    getArrowsThatCanSlideOut(bounds: BoardBounds): number[] {
        const result: number[] = [];
        for (let i = 0; i < this._arrowPaths.length; i++) {
            const path = this._arrowPaths[i];
            if (!path || path.length < 2) continue;
            if (this.canArrowSlideOutAlongPath(i, bounds)) result.push(i);
        }
        return result;
    }

    private _findArrowIndexAtPoint(col: number, row: number): number {
        const point: ArrowPoint = { col, row };
        for (let i = 0; i < this._arrowPaths.length; i++) {
            const path = this._arrowPaths[i];
            for (let j = 0; j < path.length; j++) {
                if (path[j].col === col && path[j].row === row) return i;
            }
            for (let j = 0; j < path.length - 1; j++) {
                if (isOnSegment(point, path[j], path[j + 1])) return i;
            }
        }
        return -1;
    }

    private _getCurrentArrowRenderColor(arrowIndex: number): Color {
        const node = this._arrowNodes[arrowIndex];
        if (node && node.isValid) {
            const sprites = node.getComponentsInChildren(Sprite);
            if (sprites.length > 0) return sprites[0].color.clone();
        }
        if (this._arrowBlockedRed[arrowIndex] === true) return BLOCK_BOUNCE_COLOR.clone();
        const colorIndex = this._arrowColors[arrowIndex] ?? 0;
        return getArrowColor(colorIndex);
    }

    /**
     * 仅用于滑出步进/距离判定：把路径密化为逐格点，避免“按拐点跳步”导致距离与判定失真。
     * 注意：渲染仍使用原始 path，保证 body 段数不膨胀。
     */
    private _densifyPathForSlide(path: ArrowPoint[] | undefined): ArrowPoint[] {
        if (!path || path.length < 2) return [];
        const out: ArrowPoint[] = [];
        for (let i = 0; i < path.length - 1; i++) {
            const seg = getGridPointsOnSegment(path[i], path[i + 1]);
            for (let j = 0; j < seg.length; j++) {
                if (i > 0 && j === 0) continue;
                out.push({ col: seg[j].col, row: seg[j].row });
            }
        }
        return out.length >= 2 ? out : path.slice();
    }

    private _getExitStepIgnoringBlock(path: ArrowPoint[] | undefined, bounds: BoardBounds): number {
        if (!path || path.length < 2) return -1;
        const extended = this.getExtendedPathForSlide(path, bounds);
        const pathLen = path.length;
        const maxStep = extended.length - pathLen;
        for (let t = 1; t <= maxStep; t++) {
            const occupied = this.getOccupiedAtStep(extended, t, pathLen);
            let allOut = true;
            for (const key of occupied) {
                const [c, r] = key.split(',').map(Number);
                if (this.isInBounds(c, r, bounds)) {
                    allOut = false;
                    break;
                }
            }
            if (allOut) return t;
        }
        return -1;
    }

    private _buildOccupiedOwnerMapExcludingArrow(selfArrowIndex: number): Map<string, number[]> {
        const owners = new Map<string, number[]>();
        for (let i = 0; i < this._arrowPaths.length; i++) {
            if (i === selfArrowIndex) continue;
            const points = this.getArrowOccupiedPoints(i);
            for (const key of points) {
                const arr = owners.get(key);
                if (!arr) {
                    owners.set(key, [i]);
                    continue;
                }
                // 同一点可能被多条箭头占据，保留归属索引列表
                if (arr.indexOf(i) < 0) arr.push(i);
            }
        }
        return owners;
    }

    private _getFirstBlockingInfo(
        path: ArrowPoint[] | undefined,
        bounds: BoardBounds,
        selfArrowIndex: number
    ): number {
        if (!path || path.length < 2) return -1;
        const owners = this._buildOccupiedOwnerMapExcludingArrow(selfArrowIndex);
        const selfStartOccupied = this.getArrowOccupiedPoints(selfArrowIndex);
        if (owners.size <= 0) return -1;
        const extended = this.getExtendedPathForSlide(path, bounds);
        const pathLen = path.length;
        const maxStep = extended.length - pathLen;
        const rawDCol = path[path.length - 1].col - path[path.length - 2].col;
        const rawDRow = path[path.length - 1].row - path[path.length - 2].row;
        const g = gcdInt(rawDCol, rawDRow);
        const stepCol = g > 0 ? rawDCol / g : rawDCol;
        const stepRow = g > 0 ? rawDRow / g : rawDRow;
        const head0 = path[path.length - 1];

        for (let t = 1; t <= maxStep; t++) {
            let blockerIndex = -1;
            let firstHitKey = '';
            let firstHitOwners: number[] = [];
            let bestForward = -Infinity;
            let addedCount = 0;
            const debugCandidates: string[] = [];
            // 仅按“头部前沿”新进入的轨迹点判定首撞，避免身体形变带来的伪早碰撞
            const prevHead = extended[t + pathLen - 2];
            const currHead = extended[t + pathLen - 1];
            if (!prevHead || !currHead) continue;
            const headFrontPoints = getGridPointsOnSegment(prevHead, currHead);
            for (const p of headFrontPoints) {
                const key = pointKey(p.col, p.row);
                const [c, r] = key.split(',').map(Number);
                if (!this.isInBounds(c, r, bounds)) continue;
                // 候选点必须在初始头部的前方，排除侧向/回向伪命中
                const forwardFromHead0 = (c - head0.col) * stepCol + (r - head0.row) * stepRow;
                if (forwardFromHead0 <= 0) continue;
                addedCount += 1;
                // 排除初始占据点，避免起始重叠区域被误判为“首次碰撞”
                if (selfStartOccupied.has(key)) continue;
                const ownerList = owners.get(key);
                if (!ownerList || ownerList.length <= 0) continue;
                debugCandidates.push(`${key}(f=${forwardFromHead0})->[${ownerList.join(',')}]`);
                const forward = c * stepCol + r * stepRow;
                if (forward > bestForward) {
                    bestForward = forward;
                    firstHitKey = key;
                    firstHitOwners = ownerList.slice();
                    blockerIndex = ownerList[0];
                    for (const owner of ownerList) {
                        if (owner < blockerIndex) blockerIndex = owner;
                    }
                }
            }
            if (blockerIndex >= 0) {
                return t;
            }
        }
        return -1;
    }

    private _analyzeSlideOutPath(
        path: ArrowPoint[] | undefined,
        bounds: BoardBounds,
        selfArrowIndex: number
    ): { exitStep: number; blockStep: number } {
        const exitStep = this._getExitStepIgnoringBlock(path, bounds);
        const firstBlockStep = this._getFirstBlockingInfo(path, bounds, selfArrowIndex);
        if (firstBlockStep > 0 && (exitStep < 0 || firstBlockStep <= exitStep)) {
            return { exitStep: -1, blockStep: firstBlockStep };
        }
        return { exitStep, blockStep: -1 };
    }

    private _evalSlideDistance(v0: number, a: number, t: number, totalDistance: number): number {
        return Math.min(totalDistance, Math.max(0, v0 * t + 0.5 * a * t * t));
    }

    private _buildSlideMotion(totalDistance: number, unitGridDistance: number): {
        initialSpeed: number;
        acceleration: number;
        totalDuration: number;
    } {
        const tFirstGrid = this._getSlideOutSecondsPerGrid();
        // 初速度略抬高（相对“一格/首格时间”的 10%），让起步更利落
        const speedUnitsPerSec = (unitGridDistance > 1e-6 && tFirstGrid > 1e-6)
            ? (unitGridDistance / tFirstGrid) * 0.1
            : 0;
        // s = v0*t + 1/2*a*t^2；保持首格时间基准不变，并沿用之前 0.25 的加速度倍率
        const accelBase = (unitGridDistance > 1e-6 && tFirstGrid > 1e-6)
            ? (2 * Math.max(0, unitGridDistance - speedUnitsPerSec * tFirstGrid)) / (tFirstGrid * tFirstGrid)
            : 0;
        const accelPerSec2 = accelBase * 0.25;
        let totalDuration = 0;
        if (accelPerSec2 > 1e-6 && totalDistance > 1e-6) {
            // s = v0*t + 1/2*a*t^2 -> t = (-v0 + sqrt(v0^2 + 2as)) / a
            const disc = speedUnitsPerSec * speedUnitsPerSec + 2 * accelPerSec2 * totalDistance;
            totalDuration = (-speedUnitsPerSec + Math.sqrt(Math.max(0, disc))) / accelPerSec2;
        }
        return { initialSpeed: speedUnitsPerSec, acceleration: accelPerSec2, totalDuration };
    }

    private _lerpColor(from: Color, to: Color, t: number): Color {
        const k = Math.max(0, Math.min(1, t));
        return new Color(
            Math.round(from.r + (to.r - from.r) * k),
            Math.round(from.g + (to.g - from.g) * k),
            Math.round(from.b + (to.b - from.b) * k),
            Math.round(from.a + (to.a - from.a) * k),
        );
    }

    private _updateBlockedColorLerp(ctx: NonNullable<ArrowManager['_slideOutCtx']>, dt: number): void {
        if (ctx.colorLerpDuration <= 1e-6) {
            ctx.renderer.applyColor(ctx.colorLerpTo);
            return;
        }
        ctx.colorLerpElapsed = Math.min(ctx.colorLerpDuration, ctx.colorLerpElapsed + Math.max(0, dt));
        const t = ctx.colorLerpElapsed / ctx.colorLerpDuration;
        // 先快后慢（ease-out）
        const eased = 1 - (1 - t) * (1 - t);
        ctx.renderer.applyColor(this._lerpColor(ctx.colorLerpFrom, ctx.colorLerpTo, eased));
    }

    private _finishSlideOutSuccess(ctx: {
        arrowIndex: number;
        node: Node;
        renderer: ArrowRenderer;
        totalDistance: number;
        unitGridDistance: number;
        initialSpeed: number;
        acceleration: number;
        totalDuration: number;
        elapsed: number;
        phase: 'out' | 'back';
        isBlockedBounce: boolean;
        originalColor: Color;
        initialPositions: Vec3[];
        firstBlockStep: number;
    }): void {
        this._slideOutCtx = null;
        if (ctx.node.isValid) {
            ctx.node.destroy();
            this._arrowNodes.splice(ctx.arrowIndex, 1);
            this._arrowPaths.splice(ctx.arrowIndex, 1);
            this._arrowColors.splice(ctx.arrowIndex, 1);
        }
        this._isSliding = false;
    }

    private _finishSlideOutBlocked(ctx: {
        arrowIndex: number;
        node: Node;
        renderer: ArrowRenderer;
        totalDistance: number;
        unitGridDistance: number;
        initialSpeed: number;
        acceleration: number;
        totalDuration: number;
        elapsed: number;
        phase: 'out' | 'back';
        isBlockedBounce: boolean;
        originalColor: Color;
        initialPositions: Vec3[];
        firstBlockStep: number;
    }): void {
        this._slideOutCtx = null;
        if (ctx.node.isValid) {
            // 回弹结束保持红色，只把形态回到原位（不重建节点）
            ctx.renderer.updateSlideByDistance(0);
            ctx.renderer.applyColor(BLOCK_BOUNCE_COLOR);
            if (ctx.arrowIndex >= 0 && ctx.arrowIndex < this._arrowBlockedRed.length) {
                this._arrowBlockedRed[ctx.arrowIndex] = true;
            }
        }
        this._isSliding = false;
    }

    private _abortSlideOutAnimation(): void {
        const ctx = this._slideOutCtx;
        if (ctx && ctx.node.isValid && ctx.isBlockedBounce) {
            // 中断阻挡回弹时同样保持红色，并回到初始形态（不重建节点）
            ctx.renderer.updateSlideByDistance(0);
            ctx.renderer.applyColor(BLOCK_BOUNCE_COLOR);
            if (ctx.arrowIndex >= 0 && ctx.arrowIndex < this._arrowBlockedRed.length) {
                this._arrowBlockedRed[ctx.arrowIndex] = true;
            }
        }
        this._slideOutCtx = null;
        this._isSliding = false;
    }

    private _ensureDmgOverlayOpacity(): UIOpacity | null {
        if (!this.dmgOverlay || !this.dmgOverlay.isValid) return null;
        if (this._dmgOverlayOpacity && this._dmgOverlayOpacity.isValid) return this._dmgOverlayOpacity;
        let op = this.dmgOverlay.getComponent(UIOpacity);
        if (!op) op = this.dmgOverlay.addComponent(UIOpacity);
        this._dmgOverlayOpacity = op;
        return op;
    }

    private _setDmgOverlayAlpha01(alpha01: number): void {
        const op = this._ensureDmgOverlayOpacity();
        if (!op || !this.dmgOverlay) return;
        const a = Math.max(0, Math.min(1, alpha01));
        op.opacity = Math.round(a * 255);
        this.dmgOverlay.active = a > 0;
    }

    private _startDmgOverlayFlash(): void {
        if (!this.dmgOverlay || !this.dmgOverlay.isValid) return;
        this.dmgOverlay.active = true;
        this._setDmgOverlayAlpha01(0);
        this._dmgOverlayFlashCtx = { phase: 'in', elapsed: 0 };
    }

    private _stopDmgOverlayFlash(): void {
        this._dmgOverlayFlashCtx = null;
        if (!this.dmgOverlay || !this.dmgOverlay.isValid) return;
        this._setDmgOverlayAlpha01(0);
        this.dmgOverlay.active = false;
    }

    private _tickDmgOverlayFlash(dt: number): void {
        const fx = this._dmgOverlayFlashCtx;
        if (!fx) return;
        const stepDt = Math.max(0, dt);
        if (fx.phase === 'in') {
            fx.elapsed = Math.min(OVERLAY_FLASH_IN_SECONDS, fx.elapsed + stepDt);
            const t = OVERLAY_FLASH_IN_SECONDS > 1e-6 ? fx.elapsed / OVERLAY_FLASH_IN_SECONDS : 1;
            // 平滑淡入（ease-out）
            const eased = 1 - (1 - t) * (1 - t);
            this._setDmgOverlayAlpha01(OVERLAY_PEAK_ALPHA_01 * eased);
            if (fx.elapsed >= OVERLAY_FLASH_IN_SECONDS - 1e-6) {
                fx.phase = 'out';
                fx.elapsed = 0;
            }
            return;
        }
        fx.elapsed = Math.min(OVERLAY_FLASH_OUT_SECONDS, fx.elapsed + stepDt);
        const t = OVERLAY_FLASH_OUT_SECONDS > 1e-6 ? fx.elapsed / OVERLAY_FLASH_OUT_SECONDS : 1;
        // 平滑淡出（ease-in），避免突兀消失
        const eased = t * t;
        this._setDmgOverlayAlpha01(OVERLAY_PEAK_ALPHA_01 * (1 - eased));
        if (fx.elapsed >= OVERLAY_FLASH_OUT_SECONDS - 1e-6) {
            this._stopDmgOverlayFlash();
        }
    }

    private _stopPointTrailFx(resetScale: boolean): void {
        if (resetScale) {
            for (const a of this._pointTrailActive) {
                if (a.node && a.node.isValid) a.node.setScale(a.baseScale);
            }
        }
        this._pointTrailPending = [];
        this._pointTrailDelayed = [];
        this._pointTrailActive = [];
        this._pointTrailClock = 0;
    }

    private _preparePointTrailFx(
        triggers: {
            point: ArrowPoint;
            triggerDistance: number;
        }[],
        _unitGridDistance: number,
        getPointNode?: (c: number, r: number) => Node | null
    ): void {
        this._stopPointTrailFx(true);
        if (!getPointNode || triggers.length <= 0) return;
        for (let i = 0; i < triggers.length; i++) {
            const item = triggers[i];
            const p = item.point;
            const node = getPointNode(p.col, p.row);
            if (!node || !node.isValid) continue;
            this._pointTrailPending.push({
                node,
                // 以“尾巴经过该点的真实位移阈值”为触发基准
                triggerDistance: Math.max(0, item.triggerDistance),
            });
        }
    }

    /** 按路径经过顺序（逐段）展开占据点：用于拖尾动画的时序。 */
    private _getOrderedOccupiedPointsFromPath(path: ArrowPoint[] | undefined): ArrowPoint[] {
        if (!path || path.length < 2) return [];
        const ordered: ArrowPoint[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < path.length - 1; i++) {
            const seg = getGridPointsOnSegment(path[i], path[i + 1]);
            for (let j = 0; j < seg.length; j++) {
                if (i > 0 && j === 0) continue;
                const p = seg[j];
                const key = pointKey(p.col, p.row);
                if (seen.has(key)) continue;
                seen.add(key);
                ordered.push({ col: p.col, row: p.row });
            }
        }
        return ordered;
    }

    /** 生成“滑出全过程”的拖尾触发序列（按每步离开的点触发）。 */
    private _getTrailPointTriggersForSlide(
        analysisPath: ArrowPoint[],
        extended: ArrowPoint[],
        finalStart: number,
        unitGridDistance: number
    ): {
        point: ArrowPoint;
        triggerDistance: number;
    }[] {
        if (!analysisPath || analysisPath.length < 2) return [];
        const pathLen = analysisPath.length;
        const out: { point: ArrowPoint; triggerDistance: number }[] = [];
        const seen = new Set<string>();
        let prevOcc = this.getOccupiedAtStep(extended, 0, pathLen);
        let prevOrdered = this._getOrderedOccupiedPointsFromPath(extended.slice(0, pathLen));
        const steps = Math.max(0, Math.floor(finalStart));
        for (let t = 1; t <= steps; t++) {
            const occ = this.getOccupiedAtStep(extended, t, pathLen);
            const released: ArrowPoint[] = [];
            // 用上一步窗口的有序点列来判断离开点，保证尾巴离开顺序稳定
            for (const p of prevOrdered) {
                const k = pointKey(p.col, p.row);
                if (!occ.has(k)) released.push({ col: p.col, row: p.row });
            }
            for (const p of released) {
                const k = pointKey(p.col, p.row);
                if (seen.has(k)) continue;
                seen.add(k);
                out.push({
                    point: p,
                    // 该点在第 t 步被尾巴越过：对应位移约为 (t-1) 格
                    triggerDistance: Math.max(0, t - 1) * unitGridDistance,
                });
            }
            prevOcc = occ;
            prevOrdered = this._getOrderedOccupiedPointsFromPath(extended.slice(t, t + pathLen));
        }
        return out;
    }

    private _tickPointTrailFx(dt: number, movedDistance?: number): void {
        if (
            this._pointTrailPending.length <= 0 &&
            this._pointTrailDelayed.length <= 0 &&
            this._pointTrailActive.length <= 0
        ) return;
        this._pointTrailClock += Math.max(0, dt);
        const movedForTrigger = movedDistance != null ? Math.max(0, movedDistance) : null;
        // 尾巴经过点后，先进入固定延时队列
        while (
            movedForTrigger != null &&
            this._pointTrailPending.length > 0
        ) {
            const p = this._pointTrailPending[0];
            if (!p.node || !p.node.isValid) {
                this._pointTrailPending.shift();
                continue;
            }
            if (movedForTrigger < p.triggerDistance) break;
            this._pointTrailPending.shift();
            this._pointTrailDelayed.push({
                node: p.node,
                startAt: this._pointTrailClock + POINT_TRAIL_DELAY_AFTER_PASS,
            });
        }
        // 固定延时到达后，开始点动画
        for (let i = this._pointTrailDelayed.length - 1; i >= 0; i--) {
            const d = this._pointTrailDelayed[i];
            if (!d.node || !d.node.isValid) {
                this._pointTrailDelayed.splice(i, 1);
                continue;
            }
            if (this._pointTrailClock < d.startAt) continue;
            this._pointTrailDelayed.splice(i, 1);
            const baseScale = d.node.scale.clone();
            if (POINT_TRAIL_DEBUG_INSTANT_SCALE) {
                d.node.setScale(
                    baseScale.x * POINT_TRAIL_MAX_SCALE,
                    baseScale.y * POINT_TRAIL_MAX_SCALE,
                    baseScale.z * POINT_TRAIL_MAX_SCALE
                );
                // 调试模式：直接放大，不做缩回动画；下次 _stopPointTrailFx 会统一恢复
                this._pointTrailActive.push({
                    node: d.node,
                    baseScale,
                    elapsed: -1,
                });
            } else {
                this._pointTrailActive.push({
                    node: d.node,
                    baseScale,
                    elapsed: 0,
                });
            }
        }
        for (let i = this._pointTrailActive.length - 1; i >= 0; i--) {
            const a = this._pointTrailActive[i];
            if (!a.node || !a.node.isValid) {
                this._pointTrailActive.splice(i, 1);
                continue;
            }
            if (a.elapsed < 0) continue;
            a.elapsed = Math.min(POINT_TRAIL_PULSE_DURATION, a.elapsed + Math.max(0, dt));
            const t = POINT_TRAIL_PULSE_DURATION > 1e-6 ? a.elapsed / POINT_TRAIL_PULSE_DURATION : 1;
            // 变窄脉冲：仍平滑，但大尺寸停留时间更短
            const base = Math.sin(Math.PI * t);
            const pulse = base * base * base;
            const k = 1 + (POINT_TRAIL_MAX_SCALE - 1) * pulse;
            a.node.setScale(
                a.baseScale.x * k,
                a.baseScale.y * k,
                a.baseScale.z * k
            );
            if (a.elapsed >= POINT_TRAIL_PULSE_DURATION - 1e-6) {
                a.node.setScale(a.baseScale);
                this._pointTrailActive.splice(i, 1);
            }
        }
    }

    private _tickSlideOut(dt: number): void {
        const ctx = this._slideOutCtx;
        if (!ctx || !ctx.node.isValid) {
            this._abortSlideOutAnimation();
            return;
        }
        if (ctx.totalDuration <= 1e-6) {
            if (ctx.isBlockedBounce) this._finishSlideOutBlocked(ctx);
            else this._finishSlideOutSuccess(ctx);
            return;
        }
        const stepDt = Math.max(0, dt);
        if (ctx.isBlockedBounce && ctx.phase === 'back') {
            this._updateBlockedColorLerp(ctx, stepDt);
        }
        ctx.elapsed = Math.min(ctx.totalDuration, ctx.elapsed + stepDt);
        if (ctx.phase === 'out') {
            const targetMoved = this._evalSlideDistance(
                ctx.initialSpeed,
                ctx.acceleration,
                ctx.elapsed,
                ctx.totalDistance
            );
            // 避免个别帧位移过小导致“尾巴看起来没缩短”的视觉停顿
            const minVisualStep = Math.max(0, ctx.unitGridDistance) / 240;
            let moved = targetMoved;
            if (moved < ctx.totalDistance - 1e-6) {
                moved = Math.max(moved, Math.min(ctx.totalDistance, ctx.lastOutMoved + minVisualStep));
            }
            ctx.lastOutMoved = moved;
            ctx.renderer.updateSlideByDistance(moved);
            if (!ctx.isBlockedBounce) this._tickPointTrailFx(stepDt, moved);
            if (ctx.elapsed >= ctx.totalDuration - 1e-6) {
                if (!ctx.isBlockedBounce) {
                    this._finishSlideOutSuccess(ctx);
                    return;
                }
                ctx.phase = 'back';
                ctx.elapsed = 0;
                // 撞击瞬间开始从当前色渐变到红色
                ctx.colorLerpFrom = this._getCurrentArrowRenderColor(ctx.arrowIndex);
                ctx.colorLerpElapsed = 0;
            }
            return;
        }
        // 反向回溯：按移出曲线倒放（先快后慢）
        const tBackRef = Math.max(0, ctx.totalDuration - ctx.elapsed);
        const movedBack = this._evalSlideDistance(ctx.initialSpeed, ctx.acceleration, tBackRef, ctx.totalDistance);
        ctx.renderer.updateSlideByDistance(movedBack);
        if (ctx.elapsed >= ctx.totalDuration - 1e-6) this._finishSlideOutBlocked(ctx);
    }

    update(dt: number): void {
        this._tickDmgOverlayFlash(dt);
        if (!this._slideOutCtx) {
            // 主箭头结束后，点拖尾仍继续播完
            this._tickPointTrailFx(dt);
            return;
        }
        this._tickSlideOut(dt);
    }

    /**
     * 点击某个格点后，若命中箭头且可沿自身轨迹滑出棋盘，则播放滑出动画并移除该箭头。
     * @param stepDuration 约等于每「移动一格」的时间比例（总时长会据此估算）
     */
    trySlideOutArrowAtPoint(
        col: number,
        row: number,
        bounds: BoardBounds,
        getPosition: (c: number, r: number) => Vec3,
        getPointNode?: (c: number, r: number) => Node | null,
        _stepDuration: number = 0.06
    ): boolean {
        if (this._isSliding) return false;
        const arrowIndex = this._findArrowIndexAtPoint(col, row);
        if (arrowIndex < 0) return false;
        const path = this._arrowPaths[arrowIndex];
        const node = this._arrowNodes[arrowIndex];
        if (!path || path.length < 2 || !node || !node.isValid) return false;
        const analysisPath = this._densifyPathForSlide(path);
        const analysis = this._analyzeSlideOutPath(analysisPath, bounds, arrowIndex);
        if (analysis.exitStep < 1 && analysis.blockStep < 1) {
            console.log('[Arrows] 箭头被阻挡，无法沿轨迹滑出');
            return false;
        }

        const renderColor = this._getCurrentArrowRenderColor(arrowIndex);
        // 用原始路径建段，滑出期间只改这批 body 的长度，不新增段数
        const initialPositions = path.map(p => getPosition(p.col, p.row));
        const renderer = node.getComponent(ArrowRenderer);
        if (!renderer) return false;
        const parent = node.parent;
        if (parent) {
            node.setSiblingIndex(parent.children.length - 1);
        }

        const extended = this.getExtendedPathForSlide(analysisPath, bounds);
        /** 逻辑上已全部离格后，再多滑几格，避免线宽/箭头头仍压在边线内 */
        const VISUAL_PAD = 6;
        const maxStart = extended.length - analysisPath.length;
        const blockedTargetStart = Math.max(0.12, analysis.blockStep - BLOCK_BOUNCE_EARLY_GRIDS);
        const finalStart = analysis.exitStep > 0
            ? Math.min(analysis.exitStep + VISUAL_PAD, extended.length - analysisPath.length)
            : Math.min(blockedTargetStart, maxStart);
        const isBlockedBounce = analysis.exitStep < 1 && analysis.blockStep > 0;
        if (!isBlockedBounce) this._releaseOccupiedForPath(path);
        else this._startDmgOverlayFlash();

        this._abortSlideOutAnimation();
        renderer.buildArrow(initialPositions, renderColor);
        const rawDCol = analysisPath[analysisPath.length - 1].col - analysisPath[analysisPath.length - 2].col;
        const rawDRow = analysisPath[analysisPath.length - 1].row - analysisPath[analysisPath.length - 2].row;
        const g = gcdInt(rawDCol, rawDRow);
        const stepCol = g > 0 ? rawDCol / g : rawDCol;
        const stepRow = g > 0 ? rawDRow / g : rawDRow;
        const tail = analysisPath[analysisPath.length - 1];
        // 统一使用“滑出方向单格位移”的世界距离做速度标尺，避免不同箭头因首段长短导致速度不一致
        const unitA = getPosition(tail.col, tail.row);
        const unitB = getPosition(tail.col + stepCol, tail.row + stepRow);
        const unitGridDistance = Vec3.distance(unitA, unitB);
        // 距离按“步数 * 单格距离”计算，避免受路径开头长段影响导致 step=1 却移动多格
        const totalDistance = Math.max(0, finalStart) * unitGridDistance;
        const motion = this._buildSlideMotion(totalDistance, unitGridDistance);

        if (!isBlockedBounce) {
            // 按滑出每步“离开点”触发，和真实位移严格对齐
            const trailTriggers = this._getTrailPointTriggersForSlide(
                analysisPath,
                extended,
                finalStart,
                unitGridDistance
            );
            this._preparePointTrailFx(
                trailTriggers,
                unitGridDistance,
                getPointNode
            );
        }

        this._slideOutCtx = {
            arrowIndex,
            node,
            renderer,
            totalDistance,
            unitGridDistance,
            initialSpeed: motion.initialSpeed,
            acceleration: motion.acceleration,
            totalDuration: motion.totalDuration,
            elapsed: 0,
            phase: 'out',
            isBlockedBounce,
            originalColor: renderColor.clone(),
            initialPositions: initialPositions.map(p => new Vec3(p.x, p.y, p.z)),
            firstBlockStep: analysis.blockStep,
            colorLerpElapsed: 0,
            colorLerpDuration: isBlockedBounce ? BLOCK_COLOR_LERP_DURATION : 0,
            colorLerpFrom: renderColor.clone(),
            colorLerpTo: BLOCK_BOUNCE_COLOR.clone(),
            lastOutMoved: 0,
        };
        this._isSliding = true;
        renderer.updateSlideByDistance(0);

        return true;
    }
}
