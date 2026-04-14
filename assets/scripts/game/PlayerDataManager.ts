import { sys } from 'cc';

/** 持久化的玩家数据结构 */
export interface PlayerSaveData {
    /** 金币 */
    coins: number;
    /** 体力 */
    stamina: number;
    /** 当前关卡（0-based，表示已解锁或正在玩的关卡索引） */
    currentLevel: number;
}

const STORAGE_KEY = 'player_data';

const DEFAULT_DATA: PlayerSaveData = {
    coins: 0,
    stamina: 5,
    currentLevel: 0
};

function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * 玩家数据管理：游戏开始时从 localStorage 读取，没有则初始化；
 * 记录金币、体力、当前关卡等，修改后需调用 save() 写入 localStorage。
 */
export class PlayerDataManager {

    private static _data: PlayerSaveData = deepClone(DEFAULT_DATA);
    private static _loaded = false;

    /**
     * 游戏开始时调用：从 localStorage 读取玩家数据，若无则用默认值初始化。
     */
    static loadFromStorage(): PlayerSaveData {
        if (PlayerDataManager._loaded) {
            return deepClone(PlayerDataManager._data);
        }
        PlayerDataManager._loaded = true;
        const json = sys.localStorage.getItem(STORAGE_KEY);
        if (json) {
            try {
                const parsed = JSON.parse(json) as PlayerSaveData;
                if (parsed && typeof parsed.coins === 'number' && typeof parsed.stamina === 'number' && typeof parsed.currentLevel === 'number') {
                    PlayerDataManager._data = {
                        coins: Math.max(0, parsed.coins),
                        stamina: Math.max(0, parsed.stamina),
                        currentLevel: Math.max(0, parsed.currentLevel)
                    };
                    return deepClone(PlayerDataManager._data);
                }
            } catch (_) { }
        }
        PlayerDataManager._data = deepClone(DEFAULT_DATA);
        PlayerDataManager.save();
        return deepClone(PlayerDataManager._data);
    }

    /** 将当前数据写入 localStorage */
    static save(): void {
        sys.localStorage.setItem(STORAGE_KEY, JSON.stringify(PlayerDataManager._data));
    }

    /** 确保已加载（未加载则先 loadFromStorage） */
    private static _ensureLoaded(): void {
        if (!PlayerDataManager._loaded) {
            PlayerDataManager.loadFromStorage();
        }
    }

    static getCoins(): number {
        PlayerDataManager._ensureLoaded();
        return PlayerDataManager._data.coins;
    }

    static setCoins(value: number): void {
        PlayerDataManager._ensureLoaded();
        PlayerDataManager._data.coins = Math.max(0, Math.floor(value));
        PlayerDataManager.save();
    }

    static getStamina(): number {
        PlayerDataManager._ensureLoaded();
        return PlayerDataManager._data.stamina;
    }

    static setStamina(value: number): void {
        PlayerDataManager._ensureLoaded();
        PlayerDataManager._data.stamina = Math.max(0, Math.floor(value));
        PlayerDataManager.save();
    }

    static getCurrentLevel(): number {
        PlayerDataManager._ensureLoaded();
        return PlayerDataManager._data.currentLevel;
    }

    static setCurrentLevel(value: number): void {
        PlayerDataManager._ensureLoaded();
        PlayerDataManager._data.currentLevel = Math.max(0, Math.floor(value));
        PlayerDataManager.save();
    }

    /** 获取当前完整数据（只读副本） */
    static getData(): Readonly<PlayerSaveData> {
        PlayerDataManager._ensureLoaded();
        return deepClone(PlayerDataManager._data);
    }
}
