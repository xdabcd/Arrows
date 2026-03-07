import { _decorator, Component, Node, Input, EventTouch, EventMouse, Vec3 } from 'cc';
import * as cc from 'cc';
/** 兼容未单独导出 input 的版本：从 cc 命名空间取 */
const input = (cc as any).input;
import { LevelEditorBoard } from './LevelEditorBoard';
import { ArrowManager } from './ArrowManager';
import { LevelEditorArrowEdit } from './LevelEditorArrowEdit';
const { ccclass, property } = _decorator;

function distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * 游戏层缩放：双指捏合 / 滚轮 缩放游戏层。
 * 双指开始时取消当前棋盘触摸（通知 LevelEditorArrowEdit 取消绘制）。
 * 若未指定 gameLayer，会根据 board 与 arrowManager 自动创建 GameLayer 并 reparent 棋盘容器与箭头容器。
 *
 * 场景配置：挂在「关卡编辑」根节点（如 LevelEditor）上，并绑定 board、arrowManager、arrowEdit；
 * gameLayer 留空则运行时自动创建并 reparent。
 */
@ccclass('GameLayerZoom')
export class GameLayerZoom extends Component {

    @property(Node)
    gameLayer: Node | null = null;

    @property(LevelEditorBoard)
    board: LevelEditorBoard | null = null;

    @property(ArrowManager)
    arrowManager: ArrowManager | null = null;

    @property(LevelEditorArrowEdit)
    arrowEdit: LevelEditorArrowEdit | null = null;

    @property({ tooltip: '最小缩放' })
    minScale: number = 0.5;

    @property({ tooltip: '最大缩放' })
    maxScale: number = 2;

    @property({ tooltip: '滚轮灵敏度' })
    wheelSensitivity: number = 0.001;

    private _scale = 1;
    private _isPinching = false;
    private _lastPinchDistance = 0;
    private _lastPinchScale = 1;
    private _resolvedGameLayer: Node | null = null;

    onLoad() {
        this._ensureGameLayer();
        this._resolvedGameLayer = this.gameLayer;
        this._scale = this._getCurrentScale();
        if (!input) return;
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.on(Input.EventType.MOUSE_WHEEL, this._onMouseWheel, this);
    }

    onDestroy() {
        if (input) {
            input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
            input.off(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
            input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
            input.off(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
            input.off(Input.EventType.MOUSE_WHEEL, this._onMouseWheel, this);
        }
    }

    private _ensureGameLayer(): void {
        if (this.gameLayer) {
            this._resolvedGameLayer = this.gameLayer;
            return;
        }
        if (!this.board || !this.arrowManager) return;
        const boardContainer = this.board.boardContainer || this.board.node;
        const arrowContainer = this.arrowManager.arrowContainer || this.arrowManager.node;
        const parent = this.node;
        const layer = new Node('GameLayer');
        layer.setParent(parent);
        layer.setSiblingIndex(0);
        boardContainer.setParent(layer);
        arrowContainer.setParent(layer);
        this.gameLayer = layer;
        this._resolvedGameLayer = layer;
    }

    private _getTargetLayer(): Node | null {
        return this._resolvedGameLayer;
    }

    private _getCurrentScale(): number {
        const layer = this._getTargetLayer();
        if (!layer) return 1;
        const s = layer.scale;
        return s.x;
    }

    private _applyScale(s: number): void {
        const layer = this._getTargetLayer();
        if (!layer) return;
        s = Math.max(this.minScale, Math.min(this.maxScale, s));
        this._scale = s;
        layer.setScale(new Vec3(s, s, 1));
    }

    private _onTouchStart(event: EventTouch): void {
        const touches = (event.getAllTouches && event.getAllTouches()) ?? (event as any).getTouches?.() ?? [];
        if (touches.length >= 2) {
            this._isPinching = true;
            this.arrowEdit?.cancelTouch();
            this._lastPinchDistance = distance(
                touches[0].getUILocation().x, touches[0].getUILocation().y,
                touches[1].getUILocation().x, touches[1].getUILocation().y
            );
            this._lastPinchScale = this._getCurrentScale();
        }
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this._isPinching) return;
        const touches = (event.getAllTouches && event.getAllTouches()) ?? (event as any).getTouches?.() ?? [];
        if (touches.length < 2) return;
        const d = distance(
            touches[0].getUILocation().x, touches[0].getUILocation().y,
            touches[1].getUILocation().x, touches[1].getUILocation().y
        );
        if (this._lastPinchDistance > 0) {
            const s = this._lastPinchScale * (d / this._lastPinchDistance);
            this._applyScale(s);
            this._lastPinchScale = this._scale;
        }
        this._lastPinchDistance = d;
    }

    private _onTouchEnd(event: EventTouch): void {
        const touches = (event.getAllTouches && event.getAllTouches()) ?? (event as any).getTouches?.() ?? [];
        if (touches.length < 2) this._isPinching = false;
    }

    private _onMouseWheel(event: EventMouse): void {
        const delta = -event.getScrollY();
        const layer = this._getTargetLayer();
        if (!layer) return;
        const s = this._getCurrentScale() * (1 + delta * this.wheelSensitivity);
        this._applyScale(s);
    }

    /** 当前缩放值，供 UI 同步 */
    getZoomScale(): number {
        return this._scale;
    }

    /** 设置缩放并应用，供 UI 控制 */
    setZoomScale(s: number): void {
        this._applyScale(s);
    }

    getMinScale(): number { return this.minScale; }
    getMaxScale(): number { return this.maxScale; }
}
