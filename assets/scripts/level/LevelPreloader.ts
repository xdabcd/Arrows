import { _decorator, Component } from 'cc';
import { LevelStorage } from './LevelConfig';
import { PlayerDataManager } from '../game/PlayerDataManager';
const { ccclass, property } = _decorator;

/**
 * 游戏初值预加载：游戏开始时加载关卡配置与玩家数据。
 * 挂在首场景（启动场景）的任意节点上即可，onLoad 时自动执行；
 * - 关卡配置写入缓存，关卡编辑场景直接使用
 * - 玩家数据从 localStorage 读取，若无则初始化
 */
@ccclass('LevelPreloader')
export class LevelPreloader extends Component {

    onLoad() {
        LevelStorage.preloadLevelsJson();
        PlayerDataManager.loadFromStorage();
    }
}
