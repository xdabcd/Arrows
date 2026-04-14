import { _decorator, Component, Button, Node, Prefab, instantiate, Label, Layout } from 'cc';
import { LevelEditorBoard } from './LevelEditorBoard';
import { ArrowManager } from '../arrow/ArrowManager';
import { LevelConfigData, LevelsConfigFile, LevelStorage, deepClone } from '../level/LevelConfig';
const { ccclass, property } = _decorator;

/**
 * 关卡编辑器 - 保存/还原与关卡选择。
 * 每次进入时从 levels.json（resources/conf/levels.json）读取；
 * 四个按钮：保存当前、保存所有、还原当前、还原所有；
 * 关卡下拉列表：1..N+1（N=已有关卡数，+1 为新关卡预留）。
 */
@ccclass('LevelEditorSave')
export class LevelEditorSave extends Component {

    @property(LevelEditorBoard)
    board: LevelEditorBoard | null = null;

    @property(ArrowManager)
    arrowManager: ArrowManager | null = null;

    /** 保存当前关卡配置：覆盖原配置对应关卡并保存文件 */
    @property(Button)
    saveCurrentBtn: Button | null = null;

    /** 保存所有关卡配置：将所有关卡保存到配置文件 */
    @property(Button)
    saveAllBtn: Button | null = null;

    /** 还原当前关卡配置：还原为原配置对应关卡并更新显示 */
    @property(Button)
    restoreCurrentBtn: Button | null = null;

    /** 还原所有关卡配置：还原所有关卡并更新显示 */
    @property(Button)
    restoreAllBtn: Button | null = null;

    /** 关卡选择下拉/列表的触发按钮（显示当前关卡，点击展开列表） */
    @property(Node)
    levelSelectBtn: Node | null = null;

    /** 关卡列表面板（展开时显示） */
    @property(Node)
    levelSelectPanel: Node | null = null;

    /** 关卡列表内容容器 */
    @property(Node)
    levelSelectContent: Node | null = null;

    @property(Prefab)
    levelItemPrefab: Prefab | null = null;

    /** 原配置（从 conf 读取的原始数据） */
    private _original: LevelsConfigFile = { levels: [] };
    /** 当前编辑中的全部关卡（含未保存的修改） */
    private _current: LevelConfigData[] = [];
    /** 当前选中的关卡索引（0-based），可为 levels.length 表示新关卡 */
    private _currentLevelIndex: number = 0;

    onLoad() {
        this._bindButtons();
        LevelStorage.loadFromLevelsJson((data) => {
            this._original = data;
            this._current = deepClone(this._original.levels);
            this._ensureCurrentSlots();
            this._currentLevelIndex = 0;
            this._refreshLevelList();
            this._applyCurrentLevel();
        });
    }

    private _bindButtons(): void {
        if (this.saveCurrentBtn) this.saveCurrentBtn.node.on(Button.EventType.CLICK, this._onSaveCurrent, this);
        if (this.saveAllBtn) this.saveAllBtn.node.on(Button.EventType.CLICK, this._onSaveAll, this);
        if (this.restoreCurrentBtn) this.restoreCurrentBtn.node.on(Button.EventType.CLICK, this._onRestoreCurrent, this);
        if (this.restoreAllBtn) this.restoreAllBtn.node.on(Button.EventType.CLICK, this._onRestoreAll, this);
        if (this.levelSelectBtn) {
            const btn = this.levelSelectBtn.getComponent(Button) ?? this.levelSelectBtn.getComponentInChildren(Button);
            if (btn) btn.node.on(Button.EventType.CLICK, this._onToggleLevelList, this);
        }
    }

    /** 将当前 board+arrows 写入 _current 指定索引 */
    private _captureToCurrent(index: number): void {
        if (!this.board || !this.arrowManager) return;
        const data: LevelConfigData = {
            width: this.board.getWidth(),
            height: this.board.getHeight(),
            arrows: this.arrowManager.getAllArrowData()
        };
        while (this._current.length <= index) {
            this._current.push({ width: 5, height: 5, arrows: [] });
        }
        this._current[index] = data;
    }

    /** 将指定关卡的配置应用到 board+arrows */
    private _applyLevelData(data: LevelConfigData): void {
        if (!this.board || !this.arrowManager) return;
        this.board.setSize(data.width, data.height);
        const getPos = (c: number, r: number) => this.board!.getPointPosition(c, r);
        this.arrowManager.loadFromData(data.arrows, getPos);
    }

    /** 应用当前选中的关卡到显示 */
    private _applyCurrentLevel(): void {
        const idx = this._currentLevelIndex;
        const data = idx < this._current.length ? this._current[idx] : null;
        if (data) {
            this._applyLevelData(data);
        } else {
            this._applyLevelData({ width: 5, height: 5, arrows: [] });
        }
        this._updateLevelSelectLabel();
    }

    private _updateLevelSelectLabel(): void {
        if (!this.levelSelectBtn) return;
        const label = this.levelSelectBtn.getComponentInChildren(Label);
        if (label) label.string = `关卡 ${this._currentLevelIndex + 1}`;
    }

    private _onSaveCurrent(): void {
        if (!this.board || !this.arrowManager) return;
        this._captureToCurrent(this._currentLevelIndex);
        const idx = this._currentLevelIndex;
        const data = this._current[idx];
        if (idx < this._original.levels.length) {
            this._original.levels[idx] = deepClone(data);
        } else {
            this._original.levels.push(deepClone(data));
        }
        LevelStorage.saveToProjectFile(this._original);
        LevelStorage.setPreloaded(this._original);
        this._ensureCurrentSlots();
        this._refreshLevelList();
        console.log('[LevelEditor] 保存当前关卡', idx + 1, '关卡数据:', JSON.stringify(this._original, null, 2));
    }

    private _onSaveAll(): void {
        if (!this.board || !this.arrowManager) return;
        this._captureToCurrent(this._currentLevelIndex);
        const toSave: LevelConfigData[] = [];
        const n = this._original.levels.length;
        for (let i = 0; i < this._current.length; i++) {
            const d = this._current[i];
            if (d) {
                if (i < n || (d.arrows?.length ?? 0) > 0) {
                    toSave.push(deepClone(d));
                }
            }
        }
        this._original = { levels: toSave };
        LevelStorage.saveToProjectFile(this._original);
        LevelStorage.setPreloaded(this._original);
        this._ensureCurrentSlots();
        this._refreshLevelList();
        console.log('[LevelEditor] 保存所有关卡，关卡数据:', JSON.stringify(this._original, null, 2));
    }

    private _onRestoreCurrent(): void {
        const idx = this._currentLevelIndex;
        const orig = idx < this._original.levels.length ? this._original.levels[idx] : { width: 5, height: 5, arrows: [] };
        this._current[idx] = deepClone(orig);
        this._applyLevelData(orig);
        console.log(`[LevelEditor] 还原当前关卡 ${idx + 1}`);
    }

    private _onRestoreAll(): void {
        this._current = deepClone(this._original.levels);
        this._ensureCurrentSlots();
        this._applyCurrentLevel();
        this._refreshLevelList();
        console.log(`[LevelEditor] 还原所有关卡`);
    }

    /** 确保 _current 有 N+1 个槽位（N=原关卡数） */
    private _ensureCurrentSlots(): void {
        const need = this._getLevelCount();
        while (this._current.length < need) {
            this._current.push({ width: 5, height: 5, arrows: [] });
        }
    }

    private _onToggleLevelList(): void {
        if (!this.levelSelectPanel) return;
        this._refreshLevelList();
        this.levelSelectPanel.active = !this.levelSelectPanel.active;
    }

    /** 关卡列表项数量：已有关卡数 + 1（新关卡） */
    private _getLevelCount(): number {
        const n = this._original.levels.length;
        return Math.max(1, n + 1);
    }

    private _refreshLevelList(): void {
        const content = this.levelSelectContent ?? this.levelSelectPanel;
        if (!content) return;
        content.removeAllChildren();
        let layout = content.getComponent(Layout);
        if (!layout) layout = content.addComponent(Layout);
        layout.type = Layout.Type.VERTICAL;
        layout.verticalDirection = Layout.VerticalDirection.BOTTOM_TO_TOP;
        layout.spacingY = 4;
        layout.paddingTop = layout.paddingBottom = layout.paddingLeft = layout.paddingRight = 4;
        const count = this._getLevelCount();
        for (let i = 0; i < count; i++) {
            const item = this._createLevelItem(i);
            if (item) item.setParent(content);
        }
        layout.updateLayout();
    }

    private _createLevelItem(index: number): Node | null {
        let node: Node;
        if (this.levelItemPrefab) {
            node = instantiate(this.levelItemPrefab);
        } else {
            node = new Node(`Level_${index}`);
            node.addComponent(Button);
            const labelNode = new Node('Label');
            labelNode.setParent(node);
            const label = labelNode.addComponent(Label);
            label.string = `关卡 ${index + 1}`;
        }
        const btn = node.getComponent(Button) ?? node.getComponentInChildren(Button);
        if (btn) {
            const idx = index;
            btn.node.on(Button.EventType.CLICK, () => this._switchLevel(idx), this);
        }
        const label = node.getComponent(Label) ?? node.getComponentInChildren(Label);
        if (label) label.string = `关卡 ${index + 1}`;
        return node;
    }

    private _switchLevel(index: number): void {
        this._captureToCurrent(this._currentLevelIndex);
        this._currentLevelIndex = index;
        this._applyCurrentLevel();
        if (this.levelSelectPanel) this.levelSelectPanel.active = false;
    }
}
