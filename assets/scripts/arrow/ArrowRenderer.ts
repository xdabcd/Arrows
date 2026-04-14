import { _decorator, Component, Node, Prefab, instantiate, Vec3, UITransform, Color, Sprite } from 'cc';
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

    /**
     * 根据位置列表生成/刷新一条箭头。会先清除当前显示的箭头；身体和头生成在本节点下。
     * @param positions 顺序位置点（至少 2 个），本节点局部空间坐标
     * @param color 可选，箭头颜色；不传则使用默认
     */
    buildArrow(positions: Vec3[], color?: Color): void {
        this.clearArrow();
        if (!positions || positions.length < 2 || !this.arrowBodyPrefab || !this.arrowHeadPrefab) {
            return;
        }

        const container = this.node;

        // 相邻两点之间生成身体：放在起点，朝向终点，长度=两点距离
        for (let i = 0; i < positions.length - 1; i++) {
            const a = positions[i];
            const b = positions[i + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1e-6) continue;

            const bodyNode = instantiate(this.arrowBodyPrefab);
            bodyNode.setParent(container);
            bodyNode.setPosition(a);
            // 预制体锚点 (0.5,1)，身体沿局部 -Y 延伸
            const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
            bodyNode.eulerAngles = new Vec3(0, 0, angleDeg);
            // 用 contentSize 控制长度，九宫格只拉伸中间条、两端圆头保持像素不变，避免 scale 压成方头
            const bodyUi = bodyNode.getComponent(UITransform);
            if (bodyUi) {
                bodyUi.setContentSize(BODY_DESIGN_WIDTH, dist);
            } else {
                const scale = bodyNode.scale;
                bodyNode.setScale(scale.x, dist / BODY_DESIGN_HEIGHT, scale.z);
            }
            this._bodyNodes.push(bodyNode);
        }

        // 最后一个点放箭头头，方向与最后一段一致
        const last = positions.length - 1;
        const headDirX = positions[last].x - positions[last - 1].x;
        const headDirY = positions[last].y - positions[last - 1].y;
        // 箭头头朝向最后一段方向（相对身体反 180° 才与线一致）
        const headAngle = Math.atan2(headDirY, headDirX) * (180 / Math.PI) - 90;

        const headNode = instantiate(this.arrowHeadPrefab);
        headNode.setParent(container);
        headNode.setPosition(positions[last]);
        headNode.eulerAngles = new Vec3(0, 0, headAngle);
        this._headNode = headNode;

        if (color) this.applyColor(color);
    }

    /** 递归设置本节点及子节点上所有 Sprite 的颜色 */
    applyColor(color: Color): void {
        const setColorRec = (n: Node): void => {
            const sp = n.getComponent(Sprite);
            if (sp) sp.color = color.clone();
            for (const c of n.children) setColorRec(c);
        };
        setColorRec(this.node);
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
    }
}
