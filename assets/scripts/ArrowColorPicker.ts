import { _decorator, Component, Node, Button, Sprite, Prefab, instantiate, Vec3 } from 'cc';
import { DEFAULT_ARROW_COLORS } from './ArrowColors';
const { ccclass, property } = _decorator;

/** ColorPrefab 内用于表示“选中”的框节点名，可放 Sprite 做边框（会递归查找子节点） */
const FRAME_NODE_NAME = 'Frame';

function findFrameNode(root: Node): Node | null {
    if (root.name === FRAME_NODE_NAME) return root;
    for (const c of root.children) {
        const f = findFrameNode(c);
        if (f) return f;
    }
    return null;
}

/**
 * 关卡编辑器 - 箭头颜色选择器（颜色块列表）。
 * 使用 optionContainer 放置多个颜色块，选中项框上表示当前颜色；配合 ColorPrefab 可从预制体生成颜色块。
 * ColorPrefab 建议：根节点带 Button，下有 Sprite（显示颜色），另有子节点名为 "Frame" 的框（选中时显示）。
 */
@ccclass('ArrowColorPicker')
export class ArrowColorPicker extends Component {

    /** 颜色块列表的父节点 */
    @property(Node)
    optionContainer: Node | null = null;

    /** 颜色块预制体（含 Button、Sprite、子节点 Frame）；若绑定且 optionContainer 子节点不足则自动补足 */
    @property(Prefab)
    colorOptionPrefab: Prefab | null = null;

    /** 颜色块横向间距（从左到右排列） */
    @property({ tooltip: '颜色块横向间距' })
    blockSpacing: number = 44;

    private _selectedIndex = 0;
    private _colorCount = 0;
    /** 每个颜色块对应的“框”节点，选中时设为 active */
    private _optionFrames: (Node | null)[] = [];

    onLoad() {
        this._colorCount = DEFAULT_ARROW_COLORS.length;
        this._buildOptionsIfNeeded();
        this._setupOptionContainer();
        this._updateSelectionFrame();
    }

    private _buildOptionsIfNeeded(): void {
        if (!this.optionContainer || !this.colorOptionPrefab) return;
        const current = this.optionContainer.children.length;
        for (let i = current; i < this._colorCount; i++) {
            const node = instantiate(this.colorOptionPrefab);
            node.setParent(this.optionContainer);
        }
    }

    private _setupOptionContainer(): void {
        if (!this.optionContainer) return;
        const children = this.optionContainer.children;
        this._optionFrames = [];
        for (let i = 0; i < children.length && i < this._colorCount; i++) {
            const idx = i;
            const optionNode = children[i];
            optionNode.setPosition(new Vec3(i * this.blockSpacing, 0, 0));
            const btn = optionNode.getComponent(Button);
            const sp = optionNode.getComponent(Sprite) ?? optionNode.getComponentInChildren(Sprite);
            if (sp) sp.color = DEFAULT_ARROW_COLORS[idx].clone();
            const frameNode = optionNode.getChildByName(FRAME_NODE_NAME) ?? findFrameNode(optionNode);
            this._optionFrames.push(frameNode);
            if (btn) {
                btn.node.on(Button.EventType.CLICK, () => this.setSelectedColorIndex(idx), this);
            }
        }
    }

    private _updateSelectionFrame(): void {
        for (let i = 0; i < this._optionFrames.length; i++) {
            const frame = this._optionFrames[i];
            if (frame) frame.active = i === this._selectedIndex;
        }
    }

    /** 当前选中的颜色序列号 */
    getSelectedColorIndex(): number {
        return this._selectedIndex;
    }

    /** 设置选中的颜色序列号 */
    setSelectedColorIndex(index: number): void {
        this._selectedIndex = Math.max(0, Math.min(index, this._colorCount - 1));
        this._updateSelectionFrame();
    }
}
