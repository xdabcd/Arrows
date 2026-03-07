import { Color } from 'cc';

/** 默认箭头颜色列表，颜色序列号即索引 */
export const DEFAULT_ARROW_COLORS: Readonly<Color[]> = [
    new Color(255, 80, 80, 255),   // 0 红
    new Color(255, 160, 60, 255),  // 1 橙
    new Color(255, 220, 60, 255),  // 2 黄
    new Color(100, 200, 100, 255), // 3 绿
    new Color(60, 180, 220, 255),  // 4 青
    new Color(80, 120, 255, 255),  // 5 蓝
    new Color(180, 100, 220, 255), // 6 紫
];

export function getArrowColor(index: number): Color {
    const colors = DEFAULT_ARROW_COLORS;
    const i = Math.max(0, Math.min(index, colors.length - 1));
    return colors[i].clone();
}
