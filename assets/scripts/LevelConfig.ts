/** 单条箭头配置 */
export interface LevelArrowData {
    points: { col: number; row: number }[];
    colorIndex: number;
}

/** 单个关卡配置 */
export interface LevelConfigData {
    width: number;
    height: number;
    arrows: LevelArrowData[];
}

/** 关卡配置文件结构：所有关卡在一个文件中 */
export interface LevelsConfigFile {
    levels: LevelConfigData[];
}

/** 紧凑格式：l=levels, w=width, h=height, a=arrows, p=points([col,row]), c=colorIndex(可省默认0) */
interface CompactFile { l?: CompactLevel[] }
interface CompactLevel { w: number; h: number; a?: CompactArrow[] }
interface CompactArrow { p: [number, number][]; c?: number }

function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

function toCompact(data: LevelsConfigFile): CompactFile {
    const l: CompactLevel[] = (data.levels || []).map(lev => ({
        w: lev.width,
        h: lev.height,
        a: (lev.arrows || []).map(ar => {
            const p: [number, number][] = (ar.points || []).map(pt => [pt.col, pt.row]);
            const c = ar.colorIndex ?? 0;
            return c === 0 ? { p } : { p, c };
        })
    }));
    return { l };
}

function fromCompact(obj: CompactFile): LevelsConfigFile {
    const levels: LevelConfigData[] = (obj.l || []).map(lev => ({
        width: lev.w,
        height: lev.h,
        arrows: (lev.a || []).map(ar => ({
            points: (ar.p || []).map(([col, row]) => ({ col, row })),
            colorIndex: ar.c ?? 0
        }))
    }));
    return { levels };
}

function isLegacyFormat(obj: any): obj is { levels: LevelConfigData[] } {
    return obj && Array.isArray(obj.levels) && (obj.levels.length === 0 || obj.levels[0].width !== undefined);
}

import { resources } from 'cc';
import { JsonAsset } from 'cc';

/** 关卡配置存储：读写均使用 assets/resources/conf/levels.json（紧凑格式以减小体积） */
export class LevelStorage {

    /** 从 assets/resources/conf/levels.json 读取配置（异步），支持紧凑格式与旧格式 */
    static loadFromLevelsJson(callback: (data: LevelsConfigFile) => void): void {
        resources.load('conf/levels', JsonAsset, (err, asset) => {
            if (err || !asset) {
                callback({ levels: [] });
                return;
            }
            const obj = (asset as JsonAsset).json as any;
            if (!obj) {
                callback({ levels: [] });
                return;
            }
            if (isLegacyFormat(obj)) {
                callback(obj);
            } else if (obj.l && Array.isArray(obj.l)) {
                callback(fromCompact(obj as CompactFile));
            } else {
                callback({ levels: [] });
            }
        });
    }

    /**
     * 保存到项目 assets/resources/conf/levels.json 并覆盖（紧凑格式，无缩进）。
     * 仅在编辑器预览且已安装 level-editor 扩展时生效；否则仅触发下载。
     */
    static saveToProjectFile(data: LevelsConfigFile): void {
        const json = JSON.stringify(toCompact(data));
        const g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : undefined);
        const Editor = g && (g as any).Editor;
        if (Editor && Editor.Message && typeof Editor.Message.send === 'function') {
            try {
                Editor.Message.send('level-editor', 'write-levels', json);
            } catch (_) { }
        }
        if (typeof document !== 'undefined') {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'levels.json';
            a.click();
            URL.revokeObjectURL(url);
        }
    }
}

export { deepClone };
