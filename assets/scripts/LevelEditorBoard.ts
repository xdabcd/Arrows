import { _decorator, Component, Node, Prefab, instantiate, Vec3, UITransform } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 关卡编辑器 - 棋盘生成
 * 根据 width（横向点数）、height（纵向点数）生成可变大小棋盘，使用 PointPrefab 显示每个点。
 */
@ccclass('LevelEditorBoard')
export class LevelEditorBoard extends Component {

    @property(Prefab)
    pointPrefab: Prefab | null = null;

    /** 放置点的父节点，不填则用本节点 */
    @property(Node)
    boardContainer: Node | null = null;

    @property({ tooltip: '横向点数' })
    width: number = 5;

    @property({ tooltip: '纵向点数' })
    height: number = 5;

    @property({ tooltip: '横向点数下限' })
    minWidth: number = 3;

    @property({ tooltip: '横向点数上限' })
    maxWidth: number = 20;

    @property({ tooltip: '纵向点数下限' })
    minHeight: number = 3;

    @property({ tooltip: '纵向点数上限' })
    maxHeight: number = 20;

    @property({ tooltip: '点与点之间的间距（世界单位）' })
    pointSpacing: number = 36;

    /** 当前已生成的点的节点（用于刷新时销毁） */
    private _pointNodes: Node[] = [];

    onLoad() {
        this.clampSize();
        this.buildBoard();
    }

    /** 将 width/height 限制在 [min, max] 内 */
    clampSize(): void {
        this.width = Math.max(this.minWidth, Math.min(this.maxWidth, this.width));
        this.height = Math.max(this.minHeight, Math.min(this.maxHeight, this.height));
    }

    /** 设置尺寸并重建棋盘（供 UI 调用） */
    setSize(w: number, h: number): void {
        this.width = Math.max(this.minWidth, Math.min(this.maxWidth, w));
        this.height = Math.max(this.minHeight, Math.min(this.maxHeight, h));
        this.buildBoard();
    }

    /** 重建棋盘：清空旧点，按当前 width/height 生成新点 */
    buildBoard(): void {
        this.clampSize();
        const container = this.boardContainer || this.node;
        // 移除旧点
        for (const n of this._pointNodes) {
            n.destroy();
        }
        this._pointNodes = [];

        if (!this.pointPrefab) {
            return;
        }

        const spacing = this.pointSpacing;
        const W = this.width;
        const H = this.height;
        // 中心对齐：(0,0) 在网格中心
        const ox = (W - 1) * 0.5 * spacing;
        const oy = (H - 1) * 0.5 * spacing;

        for (let j = 0; j < H; j++) {
            for (let i = 0; i < W; i++) {
                const pointNode = instantiate(this.pointPrefab);
                pointNode.setParent(container);
                const x = i * spacing - ox;
                const y = j * spacing - oy;
                pointNode.setPosition(new Vec3(x, y, 0));
                pointNode.name = `Point_${i}_${j}`;
                this._pointNodes.push(pointNode);
            }
        }
    }

    getWidth(): number { return this.width; }
    getHeight(): number { return this.height; }
    getMinWidth(): number { return this.minWidth; }
    getMaxWidth(): number { return this.maxWidth; }
    getMinHeight(): number { return this.minHeight; }
    getMaxHeight(): number { return this.maxHeight; }
}
