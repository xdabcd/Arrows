import { _decorator, Component, Node, input, Input, EventTouch, Vec3, UITransform } from 'cc';
import { LevelEditorBoard } from './LevelEditorBoard';
import { ArrowManager } from './ArrowManager';
import { ArrowPoint, arrowDataToPositions, isValidArrowData, simplifyPath } from './ArrowData';
const { ccclass, property } = _decorator;

/** 是否与上一格为四邻接（上下左右） */
function isAdjacent(a: ArrowPoint, b: ArrowPoint): boolean {
    const dc = Math.abs(b.col - a.col);
    const dr = Math.abs(b.row - a.row);
    return dc + dr === 1;
}

/** 三点共线（列行同比例） */
function isCollinear(a: ArrowPoint, b: ArrowPoint, c: ArrowPoint): boolean {
    const dc1 = b.col - a.col, dr1 = b.row - a.row;
    const dc2 = c.col - a.col, dr2 = c.row - a.row;
    return dc1 * dr2 === dr1 * dc2;
}

/** 点 p 是否严格在线段 a-b 中间（共线且在 a、b 之间，不含端点） */
function isOnSegmentStrict(p: ArrowPoint, a: ArrowPoint, b: ArrowPoint): boolean {
    if (!isCollinear(p, a, b)) return false;
    const cMin = Math.min(a.col, b.col), cMax = Math.max(a.col, b.col);
    const rMin = Math.min(a.row, b.row), rMax = Math.max(a.row, b.row);
    const inCol = p.col > cMin && p.col < cMax;
    const inRow = p.row > rMin && p.row < rMax;
    if (cMin === cMax) return inRow;
    if (rMin === rMax) return inCol;
    return inCol && inRow;
}

/** 点 p 是否在线段 a-b 上（共线且在 a、b 之间或为端点） */
function isOnSegment(p: ArrowPoint, a: ArrowPoint, b: ArrowPoint): boolean {
    if (!isCollinear(p, a, b)) return false;
    const cMin = Math.min(a.col, b.col), cMax = Math.max(a.col, b.col);
    const rMin = Math.min(a.row, b.row), rMax = Math.max(a.row, b.row);
    return p.col >= cMin && p.col <= cMax && p.row >= rMin && p.row <= rMax;
}

/** 将新点追加到路径末尾 */
function tryAddPointToPath(path: ArrowPoint[], newPoint: ArrowPoint): ArrowPoint[] {
    return path.concat([newPoint]);
}

/**
 * 关卡编辑器 - 箭头绘制编辑
 * 按下第一点即开始画线/箭头（有两点后实时显示），拖动经过相邻格点更新，抬起时生成整条箭头并由管理器添加。路径仅用 _fullPath 维护。
 */
@ccclass('LevelEditorArrowEdit')
export class LevelEditorArrowEdit extends Component {

    @property(LevelEditorBoard)
    board: LevelEditorBoard | null = null;

    @property(ArrowManager)
    arrowManager: ArrowManager | null = null;

    /** 棋盘容器节点（触摸坐标将转换到其局部空间）；不填则用本节点 */
    @property(Node)
    boardContainer: Node | null = null;

    /** 本笔路径（从按下到抬起全程用此数组维护） */
    private _fullPath: ArrowPoint[] = [];
    private _isDrawing = false;
    /** 本笔已处理过抬起，避免 TOUCH_END / TOUCH_CANCEL 重复执行 */
    private _touchEndHandled = false;

    onLoad() {
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
    }

    private _touchToBoardLocal(event: EventTouch): Vec3 {
        const uiPos = event.getUILocation();
        const worldPos = new Vec3(uiPos.x, uiPos.y, 0);
        const target = this.boardContainer || this.node;
        const uiTransform = target.getComponent(UITransform);
        if (!uiTransform) return worldPos;
        const localPos = new Vec3();
        uiTransform.convertToNodeSpaceAR(worldPos, localPos);
        return localPos;
    }

    private _getPreviewPath(): ArrowPoint[] {
        return this._fullPath;
    }

    /** 将当前 _fullPath 同步到 ArrowManager 的占据点（编辑路径占点） */
    private _syncEditingPath(): void {
        if (this.arrowManager) this.arrowManager.setEditingPath(this._fullPath);
    }

    private _updatePreview(): void {
        this._syncEditingPath();
        if (!this.board || !this.arrowManager) return;
        const path = this._getPreviewPath();
        if (path.length < 2) {
            this.arrowManager.clearPreview();
            return;
        }
        const positions = arrowDataToPositions(path, (c, r) => this.board!.getPointPosition(c, r));
        this.arrowManager.setPreviewArrow(positions);
    }

    private _onTouchStart(event: EventTouch): void {
        if (!this.board) return;
        const local = this._touchToBoardLocal(event);
        const cell = this.board.getGridFromLocal(local.x, local.y);
        if (cell == null) return;
        this._touchEndHandled = false;
        if (this.arrowManager && this.arrowManager.isPointOccupied(cell.col, cell.row)) {
            const truncated = this.arrowManager.takeOverArrowAtPoint(cell.col, cell.row);
            if (truncated && truncated.length >= 1) {
                this._isDrawing = true;
                this._fullPath = truncated.slice();
                this._updatePreview();
            }
            return;
        }
        this._isDrawing = true;
        this._fullPath = [{ col: cell.col, row: cell.row }];
        this._updatePreview();
    }

    private _onTouchMove(event: EventTouch): void {
        // 0) 防御：未处于绘制状态或路径为空时不处理
        if (!this._isDrawing || !this.board || this._fullPath.length === 0) return;

        // 1) 将触摸位置转换到棋盘容器局部坐标，并换算为格子坐标（最新点）
        const local = this._touchToBoardLocal(event);
        let cell = this.board.getGridFromLocal(local.x, local.y);

        // 1.1) 吸附：若手指靠近“上一个点”（倒数第二个点），则强制把最新点视为上一个点，便于拖回
        if (this._fullPath.length >= 2) {
            const prev = this._fullPath[this._fullPath.length - 2];
            const prevPos = this.board.getPointPosition(prev.col, prev.row);
            const spacing = this.board.getPointSpacing();
            const distSq = (local.x - prevPos.x) ** 2 + (local.y - prevPos.y) ** 2;
            if (distSq <= (spacing * 0.6) ** 2) cell = { col: prev.col, row: prev.row };
        }

        // 2) 触摸不在棋盘内：不处理
        if (cell == null) return;

        const latest = { col: cell.col, row: cell.row }; // 最新点（格子坐标）
        const last = this._fullPath[this._fullPath.length - 1]; // 当前箭头末点
        const secondLast = this._fullPath.length >= 2 ? this._fullPath[this._fullPath.length - 2] : null; // 倒数第二点

        // 3) 若最新点就是当前末点：无需更新
        if (last.col === latest.col && last.row === latest.row) return;

        // 3.1) 防抖：只有触摸点比“末点中心”更靠近“最新格中心”时才承认最新格，避免交界处伸缩抖动
        const lastPos = this.board.getPointPosition(last.col, last.row);
        const latestPos = this.board.getPointPosition(latest.col, latest.row);
        const distSqToLast = (local.x - lastPos.x) ** 2 + (local.y - lastPos.y) ** 2;
        const distSqToLatest = (local.x - latestPos.x) ** 2 + (local.y - latestPos.y) ** 2;
        if (distSqToLatest >= distSqToLast) return;

        // 4) 若最新点落在倒数第二点-末点的线段上（含端点）：用最新点替换末点，简化并刷新后返回
        if (secondLast && isOnSegment(latest, secondLast, last)) {
            this._fullPath = simplifyPath(this._fullPath.slice(0, -1).concat([latest]));
            this._updatePreview();
            return;
        }

        // 5) 若最新点已被任何已生成箭头占用：禁止作为新点加入
        if (this.arrowManager && this.arrowManager.isPointOccupied(latest.col, latest.row)) return;

        // 6) 若最新点与当前末点不相邻（上下左右）：不允许跳跃添加
        if (!isAdjacent(last, latest)) return;

        // 7) 添加最新点并更新路径，刷新预览
        this._fullPath = tryAddPointToPath(this._fullPath, latest);
        this._updatePreview();
    }

    private _onTouchEnd(): void {
        if (this._touchEndHandled) return;
        if (!this._isDrawing) return;
        this._touchEndHandled = true;
        this._isDrawing = false;
        if (!this.board || !this.arrowManager) return;
        this.arrowManager.clearPreview();
        const simplified = simplifyPath(this._fullPath);
        this._fullPath = [];
        this._syncEditingPath();
        if (simplified.length < 2 || !isValidArrowData(simplified)) return;
        const positions = arrowDataToPositions(simplified, (c, r) => this.board!.getPointPosition(c, r));
        this.arrowManager.addArrow(positions, simplified);
    }
}
