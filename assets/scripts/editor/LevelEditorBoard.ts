import { _decorator, Component, Node, Prefab, instantiate, Vec3, UITransform } from 'cc';
import type { BoardBounds } from '../arrow/ArrowManager';
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
    /** 按格坐标索引到点节点，key: "col,row" */
    private _pointNodeMap = new Map<string, Node>();

    /** 当前宽度对应列范围（整数格坐标） */
    private _getColRange(): { min: number; max: number } {
        const min = -Math.floor(this.width / 2);
        return { min, max: min + this.width - 1 };
    }

    /** 当前高度对应行范围（整数格坐标） */
    private _getRowRange(): { min: number; max: number } {
        const min = -Math.floor(this.height / 2);
        return { min, max: min + this.height - 1 };
    }

    /**
     * 棋盘几何中心在“格坐标”中的位置：
     * - 奇数尺寸时为整数（如 0）
     * - 偶数尺寸时为半格（如 -0.5）
     */
    private _getGridCenter(): { col: number; row: number } {
        const colRange = this._getColRange();
        const rowRange = this._getRowRange();
        return {
            col: (colRange.min + colRange.max) * 0.5,
            row: (rowRange.min + rowRange.max) * 0.5
        };
    }

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
        this._pointNodeMap.clear();

        if (!this.pointPrefab) {
            return;
        }

        const spacing = this.pointSpacing;
        const W = this.width;
        const H = this.height;
        const colRange = this._getColRange();
        const rowRange = this._getRowRange();
        const center = this._getGridCenter();

        for (let j = 0; j < H; j++) {
            for (let i = 0; i < W; i++) {
                const pointNode = instantiate(this.pointPrefab);
                pointNode.setParent(container);
                const col = colRange.min + i;
                const row = rowRange.min + j;
                const x = (col - center.col) * spacing;
                const y = (row - center.row) * spacing;
                pointNode.setPosition(new Vec3(x, y, 0));
                pointNode.name = `Point_${i}_${j}`;
                this._pointNodes.push(pointNode);
                this._pointNodeMap.set(`${col},${row}`, pointNode);
            }
        }
    }

    getPointNode(col: number, row: number): Node | null {
        return this._pointNodeMap.get(`${col},${row}`) ?? null;
    }

    /**
     * 根据棋盘容器局部坐标 (x, y) 得到所在格子的 (col, row)。
     * 坐标系以中心为 (0,0)：col/row 为负表示中心左侧/下侧，正表示右侧/上侧。
     * 若在棋盘外则返回 null。
     */
    getGridFromLocal(x: number, y: number): { col: number; row: number } | null {
        const spacing = this.pointSpacing;
        const colRange = this._getColRange();
        const rowRange = this._getRowRange();
        const center = this._getGridCenter();
        const col = Math.round(x / spacing + center.col);
        const row = Math.round(y / spacing + center.row);
        const colMin = colRange.min;
        const colMax = colRange.max;
        const rowMin = rowRange.min;
        const rowMax = rowRange.max;
        if (col < colMin || col > colMax || row < rowMin || row > rowMax) return null;
        return { col, row };
    }

    /** 获取棋盘格点 (col, row) 在棋盘容器局部空间中的位置。坐标系以中心为 (0,0)。 */
    getPointPosition(col: number, row: number): Vec3 {
        const spacing = this.pointSpacing;
        const center = this._getGridCenter();
        const x = (col - center.col) * spacing;
        const y = (row - center.row) * spacing;
        return new Vec3(x, y, 0);
    }

    getPointSpacing(): number { return this.pointSpacing; }
    getWidth(): number { return this.width; }
    getHeight(): number { return this.height; }

    /** 棋盘边界（中心坐标系），供 ArrowManager 等逻辑使用 */
    getBounds(): BoardBounds {
        const colRange = this._getColRange();
        const rowRange = this._getRowRange();
        return {
            colMin: colRange.min,
            colMax: colRange.max,
            rowMin: rowRange.min,
            rowMax: rowRange.max
        };
    }
    getMinWidth(): number { return this.minWidth; }
    getMaxWidth(): number { return this.maxWidth; }
    getMinHeight(): number { return this.minHeight; }
    getMaxHeight(): number { return this.maxHeight; }
}
