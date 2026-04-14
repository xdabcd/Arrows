import { _decorator, Component, Node, Prefab, instantiate, Vec3, UITransform, Color, Sprite, Widget } from 'cc';
const { ccclass, property } = _decorator;

/** 身体节点用 contentSize 高度控制长度，避免用 scale 压扁九宫格圆头；此为预制体默认高度，仅作 fallback */
const BODY_DESIGN_HEIGHT = 144;
const BODY_DESIGN_WIDTH = 36;

/**
 * 单条箭头的显示：根据一组顺序位置点，用身体连接相邻点（长度=两点距离），最后一个点放箭头头。
 * 身体和头均在本节点下生成，positions 为本节点局部空间坐标。
 */
@ccclass('ArrowRenderer')
export class ArrowRenderer extends Component {

    @property(Prefab)
    arrowHeadPrefab: Prefab | null = null;

    @property(Prefab)
    arrowBodyPrefab: Prefab | null = null;

    private _bodyNodes: Node[] = [];
    private _headNode: Node | null = null;
    private _lastColor: Color | null = null;
    private _segmentStarts: Vec3[] = [];
    private _segmentDirs: Vec3[] = [];
    private _segmentBaseLengths: number[] = [];

    private _setColorRec(n: Node, color: Color): void {
        const sp = n.getComponent(Sprite);
        if (sp) sp.color = color.clone();
        for (const c of n.children) this._setColorRec(c, color);
    }

    private _syncBodyVisualRec(bodyNode: Node): void {
        const widgets = bodyNode.getComponentsInChildren(Widget);
        for (const w of widgets) w.updateAlignment();
        const sprites = bodyNode.getComponentsInChildren(Sprite);
        for (const sp of sprites) {
            if (sp.sizeMode !== Sprite.SizeMode.CUSTOM) {
                sp.sizeMode = Sprite.SizeMode.CUSTOM;
            }
        }
    }

    private _ensureBodyCount(count: number): void {
        if (!this.arrowBodyPrefab) return;
        while (this._bodyNodes.length < count) {
            const bodyNode = instantiate(this.arrowBodyPrefab);
            bodyNode.setParent(this.node);
            if (this._lastColor) this._setColorRec(bodyNode, this._lastColor);
            this._bodyNodes.push(bodyNode);
        }
        for (let i = 0; i < this._bodyNodes.length; i++) {
            this._bodyNodes[i].active = i < count;
        }
    }

    /**
     * 根据位置列表生成/刷新一条箭头。会先清除当前显示的箭头；身体和头生成在本节点下。
     * @param positions 顺序位置点（至少 2 个），本节点局部空间坐标
     * @param color 可选，箭头颜色；不传则使用默认
     */
    buildArrow(positions: Vec3[], color?: Color): void {
        if (!positions || positions.length < 2 || !this.arrowBodyPrefab || !this.arrowHeadPrefab) {
            for (const n of this._bodyNodes) n.active = false;
            if (this._headNode) this._headNode.active = false;
            return;
        }
        type Segment = { a: Vec3; angleDeg: number; dist: number };
        const segments: Segment[] = [];
        this._segmentStarts = [];
        this._segmentDirs = [];
        this._segmentBaseLengths = [];
        for (let i = 0; i < positions.length - 1; i++) {
            const a = positions[i];
            const b = positions[i + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1e-6) continue;
            const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
            segments.push({ a, angleDeg, dist });
            this._segmentStarts.push(new Vec3(a.x, a.y, a.z));
            this._segmentDirs.push(new Vec3(dx / dist, dy / dist, 0));
            this._segmentBaseLengths.push(dist);
        }

        this._ensureBodyCount(segments.length);
        for (let i = 0; i < segments.length; i++) {
            const bodyNode = this._bodyNodes[i];
            const seg = segments[i];
            bodyNode.active = true;
            bodyNode.setPosition(seg.a);
            bodyNode.eulerAngles = new Vec3(0, 0, seg.angleDeg);
            const bodyUi = bodyNode.getComponent(UITransform);
            if (bodyUi) {
                bodyUi.setContentSize(BODY_DESIGN_WIDTH, seg.dist);
            } else {
                const scale = bodyNode.scale;
                bodyNode.setScale(scale.x, seg.dist / BODY_DESIGN_HEIGHT, scale.z);
            }
            this._syncBodyVisualRec(bodyNode);
        }

        const last = positions.length - 1;
        const headDirX = positions[last].x - positions[last - 1].x;
        const headDirY = positions[last].y - positions[last - 1].y;
        const headAngle = Math.atan2(headDirY, headDirX) * (180 / Math.PI) - 90;
        if (!this._headNode) {
            this._headNode = instantiate(this.arrowHeadPrefab);
            this._headNode.setParent(this.node);
            if (this._lastColor) this._setColorRec(this._headNode, this._lastColor);
        }
        this._headNode.active = true;
        this._headNode.setPosition(positions[last]);
        this._headNode.eulerAngles = new Vec3(0, 0, headAngle);

        if (color) {
            // 构建过程中 body 数量会动态变化，直接刷当前颜色可避免新节点出现默认色（如红线）
            this.applyColor(color);
            this._lastColor = color.clone();
        }
    }

    /**
     * 滑出动画专用：不改各段位置/角度，只改段长。
     * - 尾部段按 distance 逐段缩短（最后一段除外）
     * - 头部最后一段按同样 distance 伸长
     */
    updateSlideByDistance(distance: number): void {
        const n = this._segmentBaseLengths.length;
        if (n <= 0) return;
        const totalAdvance = Math.max(0, distance);
        let remainTail = totalAdvance;
        let totalTailLength = 0;
        for (let i = 0; i < n - 1; i++) totalTailLength += this._segmentBaseLengths[i];
        const tailConsumed = Math.min(totalAdvance, totalTailLength);
        const extraMove = Math.max(0, totalAdvance - totalTailLength);
        const eps = 1e-4;
        for (let i = 0; i < n; i++) {
            let len = this._segmentBaseLengths[i];
            let cut = 0;
            if (i < n - 1) {
                cut = Math.min(len, remainTail);
                len -= cut;
                remainTail -= cut;
            } else {
                // 头部只在尾部缩短时伸长；尾部缩完后最后一段保持固定长度并整体移出
                len += tailConsumed;
            }
            const bodyNode = this._bodyNodes[i];
            if (!bodyNode) continue;
            bodyNode.active = len > eps;
            if (!bodyNode.active) continue;
            const s = this._segmentStarts[i];
            const d = this._segmentDirs[i];
            if (i < n - 1 && cut > 0) {
                // 保持该段“靠头部一端”不动，让缩短发生在尾部一侧
                bodyNode.setPosition(
                    s.x + d.x * cut,
                    s.y + d.y * cut,
                    s.z + d.z * cut
                );
            } else if (i === n - 1 && extraMove > 0) {
                bodyNode.setPosition(
                    s.x + d.x * extraMove,
                    s.y + d.y * extraMove,
                    s.z + d.z * extraMove
                );
            } else {
                bodyNode.setPosition(s);
            }
            const bodyUi = bodyNode.getComponent(UITransform);
            if (bodyUi) {
                bodyUi.setContentSize(BODY_DESIGN_WIDTH, len);
            } else {
                const scale = bodyNode.scale;
                bodyNode.setScale(scale.x, len / BODY_DESIGN_HEIGHT, scale.z);
            }
            this._syncBodyVisualRec(bodyNode);
        }
        if (this._headNode && n > 0) {
            const lastLenNode = this._bodyNodes[n - 1];
            if (lastLenNode && lastLenNode.active) {
                const bodyUi = lastLenNode.getComponent(UITransform);
                const lastLen = bodyUi ? bodyUi.contentSize.y : this._segmentBaseLengths[n - 1] + tailConsumed;
                const s = this._segmentStarts[n - 1];
                const d = this._segmentDirs[n - 1];
                const move = extraMove > 0 ? extraMove : 0;
                this._headNode.setPosition(
                    s.x + d.x * (move + lastLen),
                    s.y + d.y * (move + lastLen),
                    s.z + d.z * (move + lastLen)
                );
            }
        }
    }

    /** 递归设置本节点及子节点上所有 Sprite 的颜色 */
    applyColor(color: Color): void {
        this._setColorRec(this.node, color);
    }

    /** 清除当前显示的箭头 */
    clearArrow(): void {
        for (const n of this._bodyNodes) {
            n.destroy();
        }
        this._bodyNodes = [];
        if (this._headNode) {
            this._headNode.destroy();
            this._headNode = null;
        }
        this._lastColor = null;
        this._segmentStarts = [];
        this._segmentDirs = [];
        this._segmentBaseLengths = [];
    }
}
