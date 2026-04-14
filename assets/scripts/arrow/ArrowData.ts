import { Vec3 } from 'cc';

/**
 * 箭头由棋盘上的多个格点组成。
 * 起始点和第二个点决定箭头位置与第一段方向，相邻两点之间用身体连接，距离决定身体长度，箭头头部在最后一个点。
 */

/** 棋盘格点坐标（列 col = 横向，行 row = 纵向），以棋盘中心为 (0,0)，可负值 */
export interface ArrowPoint {
    col: number;
    row: number;
}

/** 一条箭头的数据：按顺序的格点列表，至少需要 2 个点 */
export type ArrowData = ArrowPoint[];

export function isValidArrowData(points: ArrowData): boolean {
    return points != null && points.length >= 2;
}

/**
 * 将格点数据转为位置数组，供 ArrowRenderer.buildArrow(positions) 使用。
 * 编辑器与游戏均可传入各自的 getPosition(col, row) 实现（如 LevelEditorBoard.getPointPosition 或游戏内格子的坐标换算）。
 */
export function arrowDataToPositions(
    points: ArrowData,
    getPosition: (col: number, row: number) => Vec3
): Vec3[] {
    if (!points || points.length === 0) return [];
    return points.map(p => getPosition(p.col, p.row));
}

/** 先去掉连续重复点，再同一条线上的中间点去掉，只保留拐点与首尾 */
export function simplifyPath(points: ArrowData): ArrowData {
    if (!points || points.length === 0) return [];
    const dedup: ArrowPoint[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
        const p = points[i], last = dedup[dedup.length - 1];
        if (p.col !== last.col || p.row !== last.row) dedup.push(p);
    }
    if (dedup.length <= 2) return dedup;
    const list: ArrowPoint[] = [dedup[0]];
    for (let i = 1; i < dedup.length - 1; i++) {
        const prev = dedup[i - 1], curr = dedup[i], next = dedup[i + 1];
        const d1c = curr.col - prev.col, d1r = curr.row - prev.row;
        const d2c = next.col - curr.col, d2r = next.row - curr.row;
        if (d1c * d2r !== d1r * d2c) list.push(curr);
    }
    list.push(dedup[dedup.length - 1]);
    return list;
}
