import { Color } from 'cc';

/** 默认箭头颜色列表，颜色序列号即索引 */
export const DEFAULT_ARROW_COLORS: Readonly<Color[]> = [
    new Color(222, 160, 109, 255), // 0 暖棕
    new Color(214, 139, 134, 255), // 1 豆沙粉
    new Color(127, 171, 76, 255),  // 2 草绿
    new Color(223, 126, 171, 255), // 3 玫粉
    new Color(186, 134, 216, 255), // 4 淡紫
    new Color(138, 204, 156, 255), // 5 薄荷绿
    new Color(149, 142, 222, 255), // 6 丁香蓝
    new Color(129, 173, 220, 255), // 7 天蓝
    new Color(115, 176, 168, 255), // 8 青灰绿
    new Color(247, 198, 79, 255),  // 9 金黄
];

export function getArrowColor(index: number): Color {
    const colors = DEFAULT_ARROW_COLORS;
    const i = Math.max(0, Math.min(index, colors.length - 1));
    return colors[i].clone();
}
