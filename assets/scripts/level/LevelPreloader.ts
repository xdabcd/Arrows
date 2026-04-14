import { _decorator, Component, Node, director, input, Input, EventTouch, EventMouse, EventKeyboard, KeyCode, UITransform, Vec3, profiler } from 'cc';
import { ArrowManager } from '../arrow/ArrowManager';
import { ArrowColorPicker } from '../arrow/ArrowColorPicker';
import { LevelEditorArrowEdit } from '../editor/LevelEditorArrowEdit';
import { LevelEditorBoard } from '../editor/LevelEditorBoard';
import { LevelEditorSave } from '../editor/LevelEditorSave';
import { LevelEditorUI } from '../editor/LevelEditorUI';
import { LevelStorage, type LevelConfigData } from './LevelConfig';
import { PlayerDataManager } from '../game/PlayerDataManager';
const { ccclass, property, executionOrder } = _decorator;

/**
 * 游戏初值预加载：游戏开始时加载关卡配置与玩家数据。
 * 挂在首场景（启动场景）的任意节点上即可，onLoad 时自动执行；
 * - 关卡配置写入缓存，关卡编辑场景直接使用
 * - 玩家数据从 localStorage 读取，若无则初始化
 */
@ccclass('LevelPreloader')
@executionOrder(-9999)
export class LevelPreloader extends Component {

    @property({ tooltip: '开启后进入关卡编辑；关闭后进入游玩（默认第1关）' })
    enterLevelEditor: boolean = false;

    @property(LevelEditorBoard)
    board: LevelEditorBoard | null = null;

    @property(ArrowManager)
    arrowManager: ArrowManager | null = null;

    /** 浏览器、编辑器预览、桌面模拟器（Web）下显示引擎 FPS/DrawCall 等；发原生包建议关掉 */
    @property({ tooltip: '开启后在浏览器/编辑器预览/桌面模拟器显示左下角性能统计（profiler）' })
    showDebugStats: boolean = true;

    onLoad() {
        this._applyDebugStats();
        LevelStorage.preloadLevelsJson();
        PlayerDataManager.loadFromStorage();
        this._bindDebugPauseInput();
        if (this.enterLevelEditor) return;
        this._disableEditorComponents();
        this._loadFirstLevelForPlay();
        this._bindPlayInput();
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this._onDebugKeyDown, this);
        if (this.enterLevelEditor) return;
        input.off(Input.EventType.TOUCH_END, this._onPlayTouchEnd, this);
        input.off(Input.EventType.MOUSE_UP, this._onPlayMouseUp, this);
    }

    private _loadFirstLevelForPlay(): void {
        const board = this.board ?? this._findComponentInScene(LevelEditorBoard);
        const arrowManager = this.arrowManager ?? this._findComponentInScene(ArrowManager);
        if (!board || !arrowManager) return;
        this.board = board;
        this.arrowManager = arrowManager;
        PlayerDataManager.setCurrentLevel(0);
        LevelStorage.loadFromLevelsJson((data) => {
            const levels = data.levels ?? [];
            const level: LevelConfigData = levels[0] ?? { width: 5, height: 5, arrows: [] };
            board.setSize(level.width, level.height);
            arrowManager.loadFromData(level.arrows, (c, r) => board.getPointPosition(c, r));
        });
    }

    private _bindPlayInput(): void {
        input.on(Input.EventType.TOUCH_END, this._onPlayTouchEnd, this);
        input.on(Input.EventType.MOUSE_UP, this._onPlayMouseUp, this);
    }

    private _bindDebugPauseInput(): void {
        input.on(Input.EventType.KEY_DOWN, this._onDebugKeyDown, this);
    }

    private _onDebugKeyDown(event: EventKeyboard): void {
        if (event.keyCode !== KeyCode.KEY_P) return;
        // 调试快捷键：P 在运行时切换暂停/恢复
        if (director.isPaused()) {
            director.resume();
        } else {
            director.pause();
        }
    }

    private _onPlayTouchEnd(event: EventTouch): void {
        const p = event.getUILocation();
        this._trySlideArrowAtUI(p.x, p.y);
    }

    private _onPlayMouseUp(event: EventMouse): void {
        // 游玩态用左键点击箭头触发滑出；右键留给棋盘拖拽
        if (event.getButton() !== 0) return;
        const p = event.getUILocation();
        this._trySlideArrowAtUI(p.x, p.y);
    }

    private _trySlideArrowAtUI(x: number, y: number): void {
        const board = this.board ?? this._findComponentInScene(LevelEditorBoard);
        const arrowManager = this.arrowManager ?? this._findComponentInScene(ArrowManager);
        if (!board || !arrowManager) return;
        const target = board.boardContainer || board.node;
        const uiTransform = target.getComponent(UITransform);
        if (!uiTransform) return;
        const localPos = new Vec3();
        uiTransform.convertToNodeSpaceAR(new Vec3(x, y, 0), localPos);
        const cell = board.getGridFromLocal(localPos.x, localPos.y);
        if (!cell) return;
        arrowManager.trySlideOutArrowAtPoint(
            cell.col,
            cell.row,
            board.getBounds(),
            (c, r) => board.getPointPosition(c, r)
        );
    }

    private _disableEditorComponents(): void {
        this._disableAndHideAll(LevelEditorUI);
        this._disableAndHideAll(LevelEditorSave);
        this._disableAndHideAll(ArrowColorPicker);
        this._disableOnlyAll(LevelEditorArrowEdit);
    }

    private _disableAndHideAll<T extends Component>(ctor: new (...args: any[]) => T): void {
        const comps = this._findAllComponentsInScene(ctor);
        for (const c of comps) {
            c.enabled = false;
            c.node.active = false;
        }
    }

    private _disableOnlyAll<T extends Component>(ctor: new (...args: any[]) => T): void {
        const comps = this._findAllComponentsInScene(ctor);
        for (const c of comps) c.enabled = false;
    }

    private _findComponentInScene<T extends Component>(ctor: new (...args: any[]) => T): T | null {
        const comps = this._findAllComponentsInScene(ctor);
        return comps.length > 0 ? comps[0] : null;
    }

    private _findAllComponentsInScene<T extends Component>(ctor: new (...args: any[]) => T): T[] {
        const scene = director.getScene();
        if (!scene) return [];
        const out: T[] = [];
        const walk = (node: Node) => {
            const c = node.getComponent(ctor);
            if (c) out.push(c);
            for (const child of node.children) walk(child);
        };
        for (const child of scene.children) walk(child);
        return out;
    }

    private _applyDebugStats(): void {
        if (!this.showDebugStats) return;
        try {
            profiler.showStats();
        } catch (_) {
            /* 个别环境无 profiler 实现 */
        }
    }
}
